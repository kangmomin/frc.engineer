package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"frc.engineer/internal/rbac"
)

// RBAC storage: roles, role→permission grants, account→role assignments.
// The permission catalog (platform.permissions) is migration-seeded and
// append-only — this layer never inserts or deletes catalog rows, it only
// validates grants against them. Authorization checks themselves live in the
// handler gate (cmd/platform) via Principal.Permissions + rbac.HasPermission.

// Caps for the management API (mirrored nowhere in DDL — request-shape
// limits, not data invariants).
const (
	maxRolePermissions = 64
	maxAccountRoles    = 16
	// maxAccountSearch caps one account-picker page. The picker is a search
	// box, not a directory: past this the operator narrows the query.
	maxAccountSearch = 50
	// maxAccountQuery bounds the search term so a pathological pattern can't
	// be handed to ILIKE.
	maxAccountQuery = 64
)

// Role is a named permission set as returned by the management API.
// Permissions holds the raw grant nodes (any depth), sorted.
type Role struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
	CreatedAt   string   `json:"createdAt"`
}

// ListPermissionNames returns the full seeded permission catalog, sorted.
func (s *Store) ListPermissionNames(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT name FROM platform.permissions ORDER BY name COLLATE "C"`)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list permissions: %w", err)
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("platformsvc: list permissions: %w", err)
		}
		names = append(names, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: list permissions: %w", err)
	}
	return names, nil
}

// ListRoles returns all roles with their grants, oldest first.
func (s *Store) ListRoles(ctx context.Context) ([]Role, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.name, r.description, r.created_at,
		       ARRAY(
		           SELECT rp.permission_name FROM platform.role_permissions rp
		           WHERE rp.role_id = r.id ORDER BY rp.permission_name
		       )
		FROM platform.roles r
		ORDER BY r.created_at, r.name`)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list roles: %w", err)
	}
	defer rows.Close()
	roles := []Role{}
	for rows.Next() {
		var r Role
		var createdAt time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &createdAt, &r.Permissions); err != nil {
			return nil, fmt.Errorf("platformsvc: list roles: %w", err)
		}
		if r.Permissions == nil {
			r.Permissions = []string{}
		}
		r.CreatedAt = createdAt.Format(time.RFC3339)
		roles = append(roles, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: list roles: %w", err)
	}
	return roles, nil
}

// CreateRole creates an empty role. Invalid shapes yield ErrBadUpload, a
// name collision ErrDuplicate.
func (s *Store) CreateRole(ctx context.Context, name, description string) (string, error) {
	if !rbac.ValidRoleName(name) || len([]rune(description)) > 200 || hasControlChar(description) {
		return "", ErrBadUpload
	}
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.roles (name, description) VALUES ($1, $2)
		ON CONFLICT (name) DO NOTHING
		RETURNING id`,
		name, description,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrDuplicate
	}
	if err != nil {
		return "", fmt.Errorf("platformsvc: create role: %w", err)
	}
	return id, nil
}

// DeleteRole removes a role; grants and assignments cascade. The seed roles
// are refused (ErrForbidden): 'user' backs the default-grant machinery and
// the 009 backfill, 'admin' the env bootstrap. Missing roles yield ErrNotFound.
func (s *Store) DeleteRole(ctx context.Context, name string) error {
	if name == rbac.RoleUser || name == rbac.RoleAdmin {
		return ErrForbidden
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM platform.roles WHERE name = $1`, name)
	if err != nil {
		return fmt.Errorf("platformsvc: delete role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// dedupStrings returns values with duplicates removed, order preserved.
func dedupStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// SetRolePermissions replaces the role's grants with perms (any-depth nodes).
// Unknown or malformed nodes yield ErrBadUpload (catalog pre-checked so a
// typo is a 400, not an FK 500); a missing role yields ErrNotFound.
func (s *Store) SetRolePermissions(ctx context.Context, name string, perms []string) error {
	perms = dedupStrings(perms)
	if len(perms) > maxRolePermissions {
		return ErrBadUpload
	}
	for _, p := range perms {
		if !rbac.ValidNode(p) {
			return ErrBadUpload
		}
	}
	var known int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM platform.permissions WHERE name = ANY($1)`, perms,
	).Scan(&known); err != nil {
		return fmt.Errorf("platformsvc: check permissions: %w", err)
	}
	if known != len(perms) {
		return ErrBadUpload
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("platformsvc: set role permissions: %w", err)
	}
	defer tx.Rollback(ctx)

	var roleID string
	err = tx.QueryRow(ctx, `SELECT id FROM platform.roles WHERE name = $1`, name).Scan(&roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("platformsvc: set role permissions: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM platform.role_permissions WHERE role_id = $1`, roleID); err != nil {
		return fmt.Errorf("platformsvc: set role permissions: %w", err)
	}
	if len(perms) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO platform.role_permissions (role_id, permission_name)
			SELECT $1, p FROM unnest($2::text[]) AS p`, roleID, perms); err != nil {
			return fmt.Errorf("platformsvc: set role permissions: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("platformsvc: set role permissions: %w", err)
	}
	return nil
}

// AccountRoles is one account with its role assignments — the management UI's
// account picker row. Deliberately not the full account shape: the picker needs
// identity and roles, nothing else.
type AccountRoles struct {
	ID        string   `json:"id"`
	Persona   string   `json:"persona"`
	AvatarURL string   `json:"avatarUrl,omitempty"`
	Kind      string   `json:"kind"`
	Roles     []string `json:"roles"`
}

// likeEscape neutralizes LIKE wildcards so a persona containing % or _ matches
// literally. Pairs with `ESCAPE '\'` at the call site.
func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// SearchAccounts returns accounts whose persona contains q (case-insensitive),
// each with its assigned roles, capped at maxAccountSearch. An empty q returns
// the first page so the picker opens on real rows rather than a blank box.
// System accounts (treasury, fee sink) are included: they are assignable rows
// in the same table, and hiding them would misrepresent who holds what.
func (s *Store) SearchAccounts(ctx context.Context, q string) ([]AccountRoles, error) {
	q = strings.TrimSpace(q)
	if len([]rune(q)) > maxAccountQuery {
		q = string([]rune(q)[:maxAccountQuery])
	}
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.persona, a.avatar_url, a.kind,
		       ARRAY(
		           SELECT r.name FROM platform.account_roles ar
		           JOIN platform.roles r ON r.id = ar.role_id
		           WHERE ar.account_id = a.id ORDER BY r.name
		       )
		FROM platform.accounts a
		WHERE $1 = '' OR a.persona ILIKE '%' || $2 || '%' ESCAPE '\'
		ORDER BY a.persona, a.created_at
		LIMIT $3`,
		q, likeEscape(q), maxAccountSearch)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: search accounts: %w", err)
	}
	defer rows.Close()
	out := []AccountRoles{}
	for rows.Next() {
		var a AccountRoles
		if err := rows.Scan(&a.ID, &a.Persona, &a.AvatarURL, &a.Kind, &a.Roles); err != nil {
			return nil, fmt.Errorf("platformsvc: search accounts: %w", err)
		}
		if a.Roles == nil {
			a.Roles = []string{}
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: search accounts: %w", err)
	}
	return out, nil
}

// GetAccountRoles returns the role names assigned to the account, sorted.
// A missing account yields ErrNotFound (distinguishing "no roles" from
// "no account").
func (s *Store) GetAccountRoles(ctx context.Context, accountID string) ([]string, error) {
	var roles []string
	err := s.pool.QueryRow(ctx, `
		SELECT ARRAY(
		    SELECT r.name FROM platform.account_roles ar
		    JOIN platform.roles r ON r.id = ar.role_id
		    WHERE ar.account_id = a.id ORDER BY r.name
		)
		FROM platform.accounts a WHERE a.id = $1`,
		accountID,
	).Scan(&roles)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: get account roles: %w", err)
	}
	if roles == nil {
		roles = []string{}
	}
	return roles, nil
}

// SetAccountRoles replaces the account's role assignments. Unknown role
// names yield ErrBadUpload, a missing account ErrNotFound.
func (s *Store) SetAccountRoles(ctx context.Context, accountID string, roleNames []string) error {
	roleNames = dedupStrings(roleNames)
	if len(roleNames) > maxAccountRoles {
		return ErrBadUpload
	}
	for _, n := range roleNames {
		if !rbac.ValidRoleName(n) {
			return ErrBadUpload
		}
	}
	var known int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM platform.roles WHERE name = ANY($1)`, roleNames,
	).Scan(&known); err != nil {
		return fmt.Errorf("platformsvc: check roles: %w", err)
	}
	if known != len(roleNames) {
		return ErrBadUpload
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("platformsvc: set account roles: %w", err)
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM platform.accounts WHERE id = $1)`, accountID,
	).Scan(&exists); err != nil {
		return fmt.Errorf("platformsvc: set account roles: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM platform.account_roles WHERE account_id = $1`, accountID); err != nil {
		return fmt.Errorf("platformsvc: set account roles: %w", err)
	}
	if len(roleNames) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO platform.account_roles (account_id, role_id)
			SELECT $1, r.id FROM platform.roles r WHERE r.name = ANY($2)`,
			accountID, roleNames); err != nil {
			return fmt.Errorf("platformsvc: set account roles: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("platformsvc: set account roles: %w", err)
	}
	return nil
}

// AssignRole grants roleName to the account, idempotently: (true, nil) when
// newly granted, (false, nil) when already held, ErrNotFound when the account
// or role does not exist. Used by the env admin bootstrap — it never revokes.
func (s *Store) AssignRole(ctx context.Context, accountID, roleName string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO platform.account_roles (account_id, role_id)
		SELECT a.id, r.id FROM platform.accounts a
		JOIN platform.roles r ON r.name = $2
		WHERE a.id = $1
		ON CONFLICT DO NOTHING`,
		accountID, roleName)
	if err != nil {
		return false, fmt.Errorf("platformsvc: assign role: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return true, nil
	}
	// Zero rows: either already held, or the account/role doesn't exist.
	var held bool
	err = s.pool.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM platform.account_roles ar
		    JOIN platform.roles r ON r.id = ar.role_id
		    WHERE ar.account_id = $1 AND r.name = $2
		)`, accountID, roleName).Scan(&held)
	if err != nil {
		return false, fmt.Errorf("platformsvc: assign role: %w", err)
	}
	if !held {
		return false, ErrNotFound
	}
	return false, nil
}
