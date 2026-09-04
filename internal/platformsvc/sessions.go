package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"frc.engineer/internal/rbac"
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
	ViewAsSessionTTL = 15 * time.Minute     // fixed read-only child lifetime

	maxSessionsPerScope = 10 // cap active sessions per (account, scope)
)

// ErrBanned is returned when a banned account attempts an authenticated action.
var ErrBanned = errors.New("platformsvc: account banned")

// ErrInvalidSession distinguishes a missing/expired parent credential during
// View As creation from an ineligible subject (ErrNotFound).
var ErrInvalidSession = errors.New("platformsvc: invalid session")

// Principal identifies the authenticated account behind a session token.
// Permissions carries the account's RAW grant nodes (role-assigned, any
// depth — e.g. "pithub" for admin), never an expanded leaf list; check with
// rbac.HasPermission, not slice contains. Re-aggregated on every lookup, so
// a role revocation takes effect on the next request without invalidating
// sessions.
type Principal struct {
	AccountID       string
	Scope           string
	Banned          bool
	Permissions     []string
	ViewAs          bool
	ActorAccountID  string
	ActorPersona    string
	ViewAsSessionID string
	ViewAsExpiresAt time.Time
}

// ViewAsSession is the one-time result of creating a read-only child session.
// Token is returned to the caller and never persisted in raw form.
type ViewAsSession struct {
	Token     string
	ID        string
	ExpiresAt time.Time
	Subject   *Account
	Replaced  bool
}

// ViewAsExit identifies a child deleted by an explicit exit request. It is
// intentionally token-free and is used only for structured audit logging.
type ViewAsExit struct {
	ID             string
	ActorAccountID string
	SubjectID      string
	ExpiresAt      time.Time
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
	if err == nil {
		if p.Permissions == nil { // keep JSON emitting [] rather than null
			p.Permissions = []string{}
		}
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, fmt.Errorf("platformsvc: lookup session: %w", err)
	}

	// Normal miss: resolve a View As child. Both identities and both permission
	// sets are joined afresh on every request. Any broken/revoked relationship
	// deliberately collapses to ErrNotFound so the HTTP boundary returns 401.
	var actorPermissions []string
	err = s.pool.QueryRow(ctx, `
		SELECT v.subject_account_id, parent.scope, false,
		       ARRAY(
		           SELECT DISTINCT rp.permission_name
		           FROM platform.account_roles ar
		           JOIN platform.role_permissions rp ON rp.role_id = ar.role_id
		           WHERE ar.account_id = v.subject_account_id
		           ORDER BY 1
		       ),
		       parent.account_id, actor.persona, v.id, v.expires_at,
		       ARRAY(
		           SELECT DISTINCT rp.permission_name
		           FROM platform.account_roles ar
		           JOIN platform.role_permissions rp ON rp.role_id = ar.role_id
		           WHERE ar.account_id = parent.account_id
		           ORDER BY 1
		       )
		FROM platform.view_as_sessions v
		JOIN platform.sessions parent ON parent.token_hash = v.parent_token_hash
		JOIN platform.accounts actor ON actor.id = parent.account_id
		JOIN platform.accounts subject ON subject.id = v.subject_account_id
		LEFT JOIN platform.account_bans actor_ban ON actor_ban.account_id = actor.id
		LEFT JOIN platform.account_bans subject_ban ON subject_ban.account_id = subject.id
		WHERE v.token_hash = $1
		  AND v.expires_at > now()
		  AND parent.expires_at > now()
		  AND parent.scope = $2
		  AND actor_ban.account_id IS NULL
		  AND subject_ban.account_id IS NULL
		  AND subject.kind = 'user'`,
		hashToken(token), ScopeWeb,
	).Scan(
		&p.AccountID, &p.Scope, &p.Banned, &p.Permissions,
		&p.ActorAccountID, &p.ActorPersona, &p.ViewAsSessionID,
		&p.ViewAsExpiresAt, &actorPermissions,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrNotFound
	}
	if err != nil {
		return Principal{}, fmt.Errorf("platformsvc: lookup view-as session: %w", err)
	}
	if !rbac.HasPermission(actorPermissions, rbac.PermViewAsCreate) {
		return Principal{}, ErrNotFound
	}
	if p.Permissions == nil {
		p.Permissions = []string{}
	}
	p.ViewAs = true
	return p, nil
}

// CreateViewAsSession atomically replaces the parent's prior child. The parent
// session row is locked first, making concurrent starts serialize to exactly
// one surviving child. Actor authority and subject eligibility are rechecked
// inside the transaction to close the handler-gate race.
func (s *Store) CreateViewAsSession(ctx context.Context, parentToken, subjectID string) (*ViewAsSession, error) {
	childToken, err := newToken()
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: create view-as begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var actorID, scope string
	var parentExpires time.Time
	var actorBanned bool
	var actorPermissions []string
	err = tx.QueryRow(ctx, `
		SELECT p.account_id, p.scope, p.expires_at,
		       (b.account_id IS NOT NULL),
		       ARRAY(
		           SELECT DISTINCT rp.permission_name
		           FROM platform.account_roles ar
		           JOIN platform.role_permissions rp ON rp.role_id = ar.role_id
		           WHERE ar.account_id = p.account_id
		           ORDER BY 1
		       )
		FROM platform.sessions p
		LEFT JOIN platform.account_bans b ON b.account_id = p.account_id
		WHERE p.token_hash = $1 AND p.expires_at > now()
		FOR UPDATE OF p`,
		hashToken(parentToken),
	).Scan(&actorID, &scope, &parentExpires, &actorBanned, &actorPermissions)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidSession
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: lock view-as parent: %w", err)
	}
	if scope != ScopeWeb || actorBanned || !rbac.HasPermission(actorPermissions, rbac.PermViewAsCreate) {
		return nil, ErrForbidden
	}

	subject := &Account{}
	var steamID64, persona, avatarURL *string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT a.id, a.steam_id64, a.persona, a.avatar_url, a.kind,
		       (a.verified_at IS NOT NULL), false, a.created_at
		FROM platform.accounts a
		LEFT JOIN platform.account_bans b ON b.account_id = a.id
		WHERE a.id = $1 AND a.id <> $2 AND a.kind = 'user'
		  AND b.account_id IS NULL`,
		subjectID, actorID,
	).Scan(
		&subject.ID, &steamID64, &persona, &avatarURL, &subject.Kind,
		&subject.Verified, &subject.Banned, &createdAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: resolve view-as subject: %w", err)
	}
	subject.SteamID64 = deref(steamID64)
	subject.Persona = deref(persona)
	subject.AvatarURL = deref(avatarURL)
	subject.CreatedAt = createdAt.Format(time.RFC3339)

	deleted, err := tx.Exec(ctx,
		`DELETE FROM platform.view_as_sessions WHERE parent_token_hash = $1`,
		hashToken(parentToken),
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: replace view-as child: %w", err)
	}
	result := &ViewAsSession{Token: childToken, Subject: subject, Replaced: deleted.RowsAffected() > 0}
	err = tx.QueryRow(ctx, `
		INSERT INTO platform.view_as_sessions
		    (token_hash, parent_token_hash, subject_account_id, expires_at)
		VALUES ($1, $2, $3, LEAST(now() + make_interval(secs => $4), $5))
		RETURNING id, expires_at`,
		hashToken(childToken), hashToken(parentToken), subjectID,
		ViewAsSessionTTL.Seconds(), parentExpires,
	).Scan(&result.ID, &result.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: insert view-as child: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("platformsvc: create view-as commit: %w", err)
	}
	return result, nil
}

// DeleteSession revokes a session token (logout). Unknown tokens are a no-op.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	if _, err := s.pool.Exec(ctx, `
		WITH deleted_child AS (
		    DELETE FROM platform.view_as_sessions WHERE token_hash = $1
		    RETURNING 1
		)
		DELETE FROM platform.sessions
		WHERE token_hash = $1
		  AND NOT EXISTS (SELECT 1 FROM deleted_child)`, hashToken(token),
	); err != nil {
		return fmt.Errorf("platformsvc: delete session: %w", err)
	}
	return nil
}

// DeleteViewAsSession deletes only a matching child. Unknown, expired, deleted,
// and parent tokens are all successful no-ops at the HTTP boundary.
func (s *Store) DeleteViewAsSession(ctx context.Context, token string) (*ViewAsExit, error) {
	info := &ViewAsExit{}
	err := s.pool.QueryRow(ctx, `
		DELETE FROM platform.view_as_sessions v
		USING platform.sessions parent
		WHERE v.token_hash = $1 AND parent.token_hash = v.parent_token_hash
		RETURNING v.id, parent.account_id, v.subject_account_id, v.expires_at`,
		hashToken(token),
	).Scan(&info.ID, &info.ActorAccountID, &info.SubjectID, &info.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: delete view-as session: %w", err)
	}
	return info, nil
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
