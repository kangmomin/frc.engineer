package platformsvc

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/rbac"
)

func viewAsAccounts(t *testing.T, store *Store) (string, string) {
	t.Helper()
	ctx := context.Background()
	actor, err := store.UpsertSteamAccount(ctx, "76561197960287931", "Operator", "")
	if err != nil {
		t.Fatalf("create actor: %v", err)
	}
	subject, err := store.UpsertSteamAccount(ctx, "76561197960287932", "Subject", "")
	if err != nil {
		t.Fatalf("create subject: %v", err)
	}
	if err := store.SetAccountRoles(ctx, actor, []string{rbac.RoleAdmin}); err != nil {
		t.Fatalf("grant actor admin: %v", err)
	}
	return actor, subject
}

func TestViewAsSessionLifecycleAndSubjectPermissions(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	actor, subject := viewAsAccounts(t, store)
	parent, err := store.CreateSession(ctx, actor, ScopeWeb, 2*time.Minute)
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if err := store.SetAccountRoles(ctx, subject, nil); err != nil {
		t.Fatalf("clear subject roles: %v", err)
	}

	child, err := store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if child.Token == "" || child.ID == "" || child.Subject.ID != subject || child.Replaced {
		t.Fatalf("child = %+v", child)
	}
	if child.ExpiresAt.After(time.Now().Add(2*time.Minute + time.Second)) {
		t.Fatalf("child expiry %s exceeds parent cap", child.ExpiresAt)
	}
	var rawStored int
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM platform.view_as_sessions
		WHERE token_hash = $1 OR parent_token_hash = $2`, child.Token, parent).Scan(&rawStored); err != nil {
		t.Fatalf("check raw token storage: %v", err)
	}
	if rawStored != 0 {
		t.Fatal("raw parent or child token was persisted")
	}
	var hashedStored int
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM platform.view_as_sessions
		WHERE token_hash = $1 AND parent_token_hash = $2`, hashToken(child.Token), hashToken(parent)).Scan(&hashedStored); err != nil {
		t.Fatalf("check token hashes: %v", err)
	}
	if hashedStored != 1 {
		t.Fatalf("stored hash rows = %d, want 1", hashedStored)
	}

	p, err := store.LookupSession(ctx, child.Token)
	if err != nil {
		t.Fatalf("lookup child: %v", err)
	}
	if !p.ViewAs || p.AccountID != subject || p.ActorAccountID != actor || p.ActorPersona != "Operator" || p.ViewAsSessionID != child.ID {
		t.Fatalf("child principal = %+v", p)
	}
	if len(p.Permissions) != 0 || rbac.HasPermission(p.Permissions, rbac.PermViewAsCreate) {
		t.Fatalf("child inherited actor permissions: %v", p.Permissions)
	}

	if err := store.DeleteSession(ctx, child.Token); err != nil {
		t.Fatalf("logout child: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("child after logout = %v, want ErrNotFound", err)
	}
	if _, err := store.LookupSession(ctx, parent); err != nil {
		t.Fatalf("child logout deleted parent: %v", err)
	}

	child, err = store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("recreate child: %v", err)
	}
	if err := store.DeleteSession(ctx, parent); err != nil {
		t.Fatalf("logout parent: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("child after parent logout = %v, want ErrNotFound", err)
	}
}

func TestViewAsSessionAtomicReplacement(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	actor, subject := viewAsAccounts(t, store)
	other, err := store.UpsertSteamAccount(ctx, "76561197960287933", "Other", "")
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	parent, err := store.CreateSession(ctx, actor, ScopeWeb, time.Hour)
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}

	ids := []string{subject, other}
	children := make([]*ViewAsSession, len(ids))
	errs := make([]error, len(ids))
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			children[i], errs[i] = store.CreateViewAsSession(ctx, parent, ids[i])
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent create %d: %v", i, err)
		}
	}
	var rows int
	if err := store.pool.QueryRow(ctx,
		`SELECT count(*) FROM platform.view_as_sessions WHERE parent_token_hash = $1`, hashToken(parent),
	).Scan(&rows); err != nil {
		t.Fatalf("count children: %v", err)
	}
	if rows != 1 {
		t.Fatalf("surviving children = %d, want 1", rows)
	}
	var live int
	for _, child := range children {
		if _, err := store.LookupSession(ctx, child.Token); err == nil {
			live++
		} else if !errors.Is(err, ErrNotFound) {
			t.Fatalf("lookup child: %v", err)
		}
	}
	if live != 1 || (!children[0].Replaced && !children[1].Replaced) {
		t.Fatalf("live=%d replaced=(%v,%v), want one live and one replacement", live, children[0].Replaced, children[1].Replaced)
	}
}

func TestViewAsSessionEligibilityAndCurrentValidation(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	actor, subject := viewAsAccounts(t, store)
	parent, _ := store.CreateSession(ctx, actor, ScopeWeb, time.Hour)

	for name, target := range map[string]string{
		"self":    actor,
		"missing": "00000000-0000-4000-8000-000000000000",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := store.CreateViewAsSession(ctx, parent, target); !errors.Is(err, ErrNotFound) {
				t.Fatalf("create = %v, want ErrNotFound", err)
			}
		})
	}
	var systemID string
	if err := store.pool.QueryRow(ctx, `SELECT id FROM platform.accounts WHERE kind = 'treasury'`).Scan(&systemID); err != nil {
		t.Fatalf("system account: %v", err)
	}
	if _, err := store.CreateViewAsSession(ctx, parent, systemID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("system target = %v, want ErrNotFound", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, subject); err != nil {
		t.Fatalf("ban subject: %v", err)
	}
	if _, err := store.CreateViewAsSession(ctx, parent, subject); !errors.Is(err, ErrNotFound) {
		t.Fatalf("banned target = %v, want ErrNotFound", err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.account_bans WHERE account_id = $1`, subject); err != nil {
		t.Fatalf("unban subject: %v", err)
	}
	child, err := store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}

	if err := store.SetAccountRoles(ctx, actor, []string{rbac.RoleUser}); err != nil {
		t.Fatalf("revoke actor permission: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("lookup after actor revoke = %v, want ErrNotFound", err)
	}
	if _, err := store.CreateViewAsSession(ctx, parent, subject); !errors.Is(err, ErrForbidden) {
		t.Fatalf("create after actor revoke = %v, want ErrForbidden", err)
	}

	if err := store.SetAccountRoles(ctx, actor, []string{rbac.RoleAdmin}); err != nil {
		t.Fatalf("restore actor admin: %v", err)
	}
	child, err = store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("recreate child: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, actor); err != nil {
		t.Fatalf("ban actor: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("lookup after actor ban = %v, want ErrNotFound", err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.account_bans WHERE account_id = $1`, actor); err != nil {
		t.Fatalf("unban actor: %v", err)
	}
	child, err = store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("recreate child after actor unban: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, subject); err != nil {
		t.Fatalf("ban subject after create: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("lookup after subject ban = %v, want ErrNotFound", err)
	}
	accounts, err := store.SearchAccounts(ctx, "Subject")
	if err != nil || len(accounts) != 1 || accounts[0].ID != subject || !accounts[0].Banned {
		t.Fatalf("banned account search = (%+v,%v)", accounts, err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.account_bans WHERE account_id = $1`, subject); err != nil {
		t.Fatalf("unban subject after validation: %v", err)
	}
	child, err = store.CreateViewAsSession(ctx, parent, subject)
	if err != nil {
		t.Fatalf("recreate child before subject delete: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.accounts WHERE id = $1`, subject); err != nil {
		t.Fatalf("delete subject: %v", err)
	}
	if _, err := store.LookupSession(ctx, child.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("lookup after subject delete = %v, want ErrNotFound", err)
	}

	if _, err := store.DeleteViewAsSession(ctx, "unknown"); err != nil {
		t.Fatalf("delete unknown child: %v", err)
	}
}

func TestPeekWalletHasNoSideEffects(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	_, subject := viewAsAccounts(t, store)
	balance, initialized, err := store.PeekWallet(ctx, subject)
	if err != nil || balance != 0 || initialized {
		t.Fatalf("peek = (%d,%v,%v), want (0,false,nil)", balance, initialized, err)
	}
	var wallets, ledger int
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM platform.wallets WHERE account_id = $1`, subject).Scan(&wallets); err != nil {
		t.Fatalf("count wallets: %v", err)
	}
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM platform.ledger_entries WHERE account_id = $1`, subject).Scan(&ledger); err != nil {
		t.Fatalf("count ledger: %v", err)
	}
	if wallets != 0 || ledger != 0 {
		t.Fatalf("peek created wallet=%d ledger=%d", wallets, ledger)
	}
	if _, err := store.GetWallet(ctx, subject); err != nil {
		t.Fatalf("normal wallet: %v", err)
	}
	if balance, initialized, err = store.PeekWallet(ctx, subject); err != nil || balance != signupGrant || !initialized {
		t.Fatalf("peek initialized = (%d,%v,%v)", balance, initialized, err)
	}
}
