package platformsvc

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"frc.engineer/internal/rbac"
)

// testStore opens the store against PLATFORM_TEST_DATABASE_URL, migrates, and
// truncates all tables for isolation. Skips when the env var is unset so
// `go test ./...` stays green in environments without Postgres.
func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("PLATFORM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PLATFORM_TEST_DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	store, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	// Truncate all data tables but PRESERVE the migration-seeded system accounts
	// (treasury/fee_sink); TRUNCATE ... CASCADE on the children never reaches the
	// accounts root, and TRUNCATE bypasses the ledger's append-only row trigger.
	// Only user accounts are then removed.
	_, err = store.pool.Exec(ctx, `TRUNCATE platform.view_as_sessions, platform.sessions,
		platform.openid_nonces, platform.device_pairings, platform.rate_limits,
		platform.account_bans, platform.races, platform.race_setup, platform.setup_groups, platform.laps,
		platform.snapshots, platform.listings, platform.wallets,
		platform.ledger_entries, platform.purchases, platform.reviews, platform.feedback,
		platform.race_analysis, platform.account_roles
		RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if _, err = store.pool.Exec(ctx, `DELETE FROM platform.accounts WHERE kind = 'user'`); err != nil {
		t.Fatalf("delete user accounts: %v", err)
	}
	// RBAC: drop test-created roles and restore the seed roles' grants to the
	// canonical lists so tests that mutate 'user'/'admin' grants cannot leak
	// into later tests. platform.permissions/platform.roles themselves are
	// never truncated (migration-seed preservation, same principle as the
	// system accounts). The restore lists are the internal/rbac constants —
	// the third pin alongside the 009 seed and AllSeededNodes.
	if _, err = store.pool.Exec(ctx, `DELETE FROM platform.roles WHERE name NOT IN ('user','admin')`); err != nil {
		t.Fatalf("delete custom roles: %v", err)
	}
	if _, err = store.pool.Exec(ctx, `DELETE FROM platform.role_permissions`); err != nil {
		t.Fatalf("clear role grants: %v", err)
	}
	for role, grants := range map[string][]string{
		rbac.RoleUser:  rbac.SeedUserGrants(),
		rbac.RoleAdmin: rbac.SeedAdminGrants(),
	} {
		if _, err = store.pool.Exec(ctx, `
			INSERT INTO platform.role_permissions (role_id, permission_name)
			SELECT r.id, p FROM platform.roles r, unnest($1::text[]) AS p
			WHERE r.name = $2`, grants, role); err != nil {
			t.Fatalf("restore %s grants: %v", role, err)
		}
	}
	return store
}

const testSteamID = "76561197960287930"

func TestMigrateIdempotent(t *testing.T) {
	store := testStore(t)
	// A second Migrate must be a no-op (all migrations already applied).
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	var n int
	if err := store.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM platform.schema_migrations`).Scan(&n); err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if n < 1 {
		t.Fatalf("schema_migrations rows = %d, want >=1", n)
	}
}

func TestUpsertAndGetAccount(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	id1, err := store.UpsertSteamAccount(ctx, testSteamID, "Ayrton", "http://a/x.jpg")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	// Re-upsert refreshes display fields, same id.
	id2, err := store.UpsertSteamAccount(ctx, testSteamID, "Senna", "http://a/y.jpg")
	if err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("upsert produced two ids: %s != %s", id1, id2)
	}
	acc, err := store.GetAccount(ctx, id1)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if acc.Persona != "Senna" || acc.SteamID64 != testSteamID || acc.Kind != "user" {
		t.Fatalf("account = %+v", acc)
	}
	if acc.Verified || acc.Banned {
		t.Fatalf("fresh account should be unverified/unbanned: %+v", acc)
	}
	if _, err := store.GetAccount(ctx, "00000000-0000-0000-0000-000000000000"); err != ErrNotFound {
		t.Fatalf("missing account err = %v, want ErrNotFound", err)
	}
}

func TestSessionLifecycle(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")

	tok, err := store.CreateSession(ctx, id, ScopeWeb, WebSessionTTL)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	p, err := store.LookupSession(ctx, tok)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if p.AccountID != id || p.Scope != ScopeWeb || p.Banned {
		t.Fatalf("principal = %+v", p)
	}
	if err := store.DeleteSession(ctx, tok); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := store.LookupSession(ctx, tok); err != ErrNotFound {
		t.Fatalf("post-delete lookup = %v, want ErrNotFound", err)
	}

	// Expired token is rejected (expiry enforced in SQL).
	expired, _ := store.CreateSession(ctx, id, ScopeWeb, -time.Minute)
	if _, err := store.LookupSession(ctx, expired); err != ErrNotFound {
		t.Fatalf("expired lookup = %v, want ErrNotFound", err)
	}
}

func TestSessionCapPrunesOldest(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")

	var tokens []string
	for range maxSessionsPerScope + 5 {
		tok, err := store.CreateSession(ctx, id, ScopeWeb, WebSessionTTL)
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		tokens = append(tokens, tok)
	}
	var live int
	if err := store.pool.QueryRow(ctx,
		`SELECT count(*) FROM platform.sessions WHERE account_id=$1 AND scope=$2`,
		id, ScopeWeb).Scan(&live); err != nil {
		t.Fatalf("count: %v", err)
	}
	if live > maxSessionsPerScope {
		t.Fatalf("live sessions = %d, want <= %d", live, maxSessionsPerScope)
	}
	// The most recent token must still resolve.
	if _, err := store.LookupSession(ctx, tokens[len(tokens)-1]); err != nil {
		t.Fatalf("newest token lookup: %v", err)
	}
}

func TestClaimNonceSingleUse(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	n := freshNonce()
	if ok, err := store.claimNonce(ctx, n); err != nil || !ok {
		t.Fatalf("first claim = (%v, %v), want (true, nil)", ok, err)
	}
	if ok, err := store.claimNonce(ctx, n); err != nil || ok {
		t.Fatalf("replay claim = (%v, %v), want (false, nil)", ok, err)
	}
}

func TestPairingExchange(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")

	code, err := store.CreatePairing(ctx, id)
	if err != nil {
		t.Fatalf("create pairing: %v", err)
	}
	tok, err := store.ExchangePairing(ctx, code)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	p, err := store.LookupSession(ctx, tok)
	if err != nil {
		t.Fatalf("lookup upload token: %v", err)
	}
	if p.Scope != ScopeUpload || p.AccountID != id {
		t.Fatalf("upload principal = %+v", p)
	}
	// Single-use: second exchange fails.
	if _, err := store.ExchangePairing(ctx, code); err != ErrNotFound {
		t.Fatalf("second exchange = %v, want ErrNotFound", err)
	}
	// Unknown code fails.
	if _, err := store.ExchangePairing(ctx, "nope"); err != ErrNotFound {
		t.Fatalf("unknown exchange = %v, want ErrNotFound", err)
	}
}

func TestBanBlocks(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")
	tok, _ := store.CreateSession(ctx, id, ScopeWeb, WebSessionTTL)
	code, _ := store.CreatePairing(ctx, id)

	if _, err := store.pool.Exec(ctx,
		`INSERT INTO platform.account_bans (account_id, reason) VALUES ($1,'cheating')`, id); err != nil {
		t.Fatalf("ban: %v", err)
	}
	banned, err := store.IsBanned(ctx, id)
	if err != nil || !banned {
		t.Fatalf("IsBanned = (%v,%v), want (true,nil)", banned, err)
	}
	p, err := store.LookupSession(ctx, tok)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !p.Banned {
		t.Fatal("principal.Banned = false, want true")
	}
	if _, err := store.ExchangePairing(ctx, code); err != ErrBanned {
		t.Fatalf("banned exchange = %v, want ErrBanned", err)
	}
}

// fakeOP returns a Steam-like OpenID verifier that always confirms.
func fakeOP(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")
	}))
}

func idResValues(opEndpoint, claimedID, nonce string) url.Values {
	return url.Values{
		"openid.mode":           {"id_res"},
		"openid.op_endpoint":    {opEndpoint},
		"openid.claimed_id":     {claimedID},
		"openid.identity":       {claimedID},
		"openid.response_nonce": {nonce},
		"openid.sig":            {"c2ln"},
		"openid.signed":         {"signed,op_endpoint,claimed_id,identity,response_nonce"},
	}
}

func TestAuthenticateAndReplay(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	op := fakeOP(t)
	defer op.Close()

	a := NewSteamAuth(store, "", "https://p/", "https://p/cb", slog.Default())
	a.endpoint = op.URL
	claimed := "https://steamcommunity.com/openid/id/" + testSteamID
	nonce := freshNonce()

	acc, err := a.Authenticate(ctx, idResValues(op.URL, claimed, nonce))
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if acc.SteamID64 != testSteamID {
		t.Fatalf("account steamid = %q", acc.SteamID64)
	}
	// Replay the same nonce → rejected.
	if _, err := a.Authenticate(ctx, idResValues(op.URL, claimed, nonce)); err == nil {
		t.Fatal("replayed nonce accepted, want error")
	}
}

func TestAuthenticateRejects(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	op := fakeOP(t)
	defer op.Close()
	a := NewSteamAuth(store, "", "https://p/", "https://p/cb", slog.Default())
	a.endpoint = op.URL
	claimed := "https://steamcommunity.com/openid/id/" + testSteamID

	// Wrong op_endpoint (not the pinned one).
	if _, err := a.Authenticate(ctx, idResValues("https://evil/openid", claimed, freshNonce())); err == nil {
		t.Error("bad op_endpoint accepted")
	}
	// Malformed claimed_id.
	if _, err := a.Authenticate(ctx, idResValues(op.URL, "https://evil/id/1", freshNonce())); err == nil {
		t.Error("bad claimed_id accepted")
	}
	// Stale nonce.
	stale := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339) + "salt"
	if _, err := a.Authenticate(ctx, idResValues(op.URL, claimed, stale)); err == nil {
		t.Error("stale nonce accepted")
	}

	// Steam says invalid.
	badOP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "is_valid:false\n")
	}))
	defer badOP.Close()
	a2 := NewSteamAuth(store, "", "https://p/", "https://p/cb", slog.Default())
	a2.endpoint = badOP.URL
	if _, err := a2.Authenticate(ctx, idResValues(badOP.URL, claimed, freshNonce())); err == nil {
		t.Error("is_valid:false accepted")
	}
}
