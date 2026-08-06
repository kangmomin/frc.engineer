package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Session scopes.
const (
	ScopeWeb    = "web"    // browser login: full account actions
	ScopeUpload = "upload" // device token: telemetry upload only
)

// Token lifetimes and limits.
const (
	WebSessionTTL    = 30 * 24 * time.Hour  // browser login
	UploadSessionTTL = 180 * 24 * time.Hour // desktop device token (long-lived)
	PairingTTL       = 10 * time.Minute     // pairing code exchange window

	maxSessionsPerScope = 10 // cap active sessions per (account, scope)
)

// ErrBanned is returned when a banned account attempts an authenticated action.
var ErrBanned = errors.New("platformsvc: account banned")

// Principal identifies the authenticated account behind a session token.
// Permissions carries the account's RAW grant nodes (role-assigned, any
// depth — e.g. "pithub" for admin), never an expanded leaf list; check with
// rbac.HasPermission, not slice contains. Re-aggregated on every lookup, so
// a role revocation takes effect on the next request without invalidating
// sessions.
type Principal struct {
	AccountID   string
	Scope       string
	Banned      bool
	Permissions []string
}

// CreateSession issues a new session token for the account and stores only its
// hash. The raw token is returned once. Active tokens for the same
// (account, scope) are capped: the oldest beyond the cap are pruned.
func (s *Store) CreateSession(ctx context.Context, accountID, scope string, ttl time.Duration) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO platform.sessions (token_hash, account_id, scope, expires_at)
		VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
		hashToken(token), accountID, scope, ttl.Seconds(),
	); err != nil {
		return "", fmt.Errorf("platformsvc: create session: %w", err)
	}
	// Prune expired plus any beyond the newest maxSessionsPerScope for this
	// (account, scope). Bounds token accumulation without a background sweep.
	if _, err := s.pool.Exec(ctx, `
		DELETE FROM platform.sessions
		WHERE account_id = $1 AND scope = $2
		  AND (expires_at <= now() OR token_hash NOT IN (
		      SELECT token_hash FROM platform.sessions
		      WHERE account_id = $1 AND scope = $2 AND expires_at > now()
		      ORDER BY created_at DESC
		      LIMIT $3))`,
		accountID, scope, maxSessionsPerScope,
	); err != nil {
		return "", fmt.Errorf("platformsvc: prune sessions: %w", err)
	}
	return token, nil
}

// LookupSession resolves a raw token to its Principal, enforcing expiry in SQL.
// A missing or expired token yields ErrNotFound. The ban flag is resolved but
// not enforced here — callers reject Banned principals on action routes.
func (s *Store) LookupSession(ctx context.Context, token string) (Principal, error) {
	var p Principal
	// ARRAY(subquery) yields '{}' (not NULL) for zero roles, so accounts with
	// every role revoked scan cleanly into an empty slice.
	err := s.pool.QueryRow(ctx, `
		SELECT s.account_id, s.scope, (b.account_id IS NOT NULL),
		       ARRAY(
		           SELECT DISTINCT rp.permission_name
		           FROM platform.account_roles ar
		           JOIN platform.role_permissions rp ON rp.role_id = ar.role_id
		           WHERE ar.account_id = s.account_id
		           ORDER BY 1
		       )
		FROM platform.sessions s
		LEFT JOIN platform.account_bans b ON b.account_id = s.account_id
		WHERE s.token_hash = $1 AND s.expires_at > now()`,
		hashToken(token),
	).Scan(&p.AccountID, &p.Scope, &p.Banned, &p.Permissions)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrNotFound
	}
	if err != nil {
		return Principal{}, fmt.Errorf("platformsvc: lookup session: %w", err)
	}
	if p.Permissions == nil { // keep JSON emitting [] rather than null
		p.Permissions = []string{}
	}
	return p, nil
}

// DeleteSession revokes a session token (logout). Unknown tokens are a no-op.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM platform.sessions WHERE token_hash = $1`, hashToken(token),
	); err != nil {
		return fmt.Errorf("platformsvc: delete session: %w", err)
	}
	return nil
}

// CreatePairing issues a short-lived, single-use pairing code for a logged-in
// account. The desktop server exchanges it for an upload-scope token. Only the
// code's hash is stored.
func (s *Store) CreatePairing(ctx context.Context, accountID string) (string, error) {
	code, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO platform.device_pairings (code_hash, account_id, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))`,
		hashToken(code), accountID, PairingTTL.Seconds(),
	); err != nil {
		return "", fmt.Errorf("platformsvc: create pairing: %w", err)
	}
	return code, nil
}

// ExchangePairing atomically consumes a pairing code and issues an upload-scope
// session token, returned once. Expired, consumed, or unknown codes yield
// ErrNotFound; a banned account yields ErrBanned.
func (s *Store) ExchangePairing(ctx context.Context, code string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("platformsvc: exchange pairing begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var accountID string
	var banned bool
	err = tx.QueryRow(ctx, `
		SELECT p.account_id, (b.account_id IS NOT NULL)
		FROM platform.device_pairings p
		LEFT JOIN platform.account_bans b ON b.account_id = p.account_id
		WHERE p.code_hash = $1 AND p.expires_at > now() AND p.consumed_at IS NULL
		FOR UPDATE OF p`,
		hashToken(code),
	).Scan(&accountID, &banned)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("platformsvc: exchange pairing lookup: %w", err)
	}
	if banned {
		return "", ErrBanned
	}

	if _, err := tx.Exec(ctx,
		`UPDATE platform.device_pairings SET consumed_at = now() WHERE code_hash = $1`,
		hashToken(code),
	); err != nil {
		return "", fmt.Errorf("platformsvc: consume pairing: %w", err)
	}

	token, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO platform.sessions (token_hash, account_id, scope, expires_at)
		VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
		hashToken(token), accountID, ScopeUpload, UploadSessionTTL.Seconds(),
	); err != nil {
		return "", fmt.Errorf("platformsvc: issue upload token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("platformsvc: exchange pairing commit: %w", err)
	}
	return token, nil
}
