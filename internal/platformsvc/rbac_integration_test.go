package platformsvc

import (
	"context"
	"errors"
	"slices"
	"testing"

	"frc.engineer/internal/rbac"
)

const zeroUUID = "00000000-0000-0000-0000-000000000000"

// TestRBACSeedMatchesCatalog pins the 009 seed against internal/rbac —
// bidirectionally, so adding a node to either side without the other fails.
func TestRBACSeedMatchesCatalog(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	names, err := store.ListPermissionNames(ctx)
	if err != nil {
		t.Fatalf("list permissions: %v", err)
	}
	want := rbac.AllSeededNodes()
	slices.Sort(want)
	if !slices.Equal(names, want) {
		t.Fatalf("catalog drift:\n db  = %v\n go  = %v", names, want)
	}

	roles, err := store.ListRoles(ctx)
	if err != nil {
		t.Fatalf("list roles: %v", err)
	}
	byName := map[string][]string{}
	for _, r := range roles {
		byName[r.Name] = r.Permissions
	}
	wantUser := rbac.SeedUserGrants()
	slices.Sort(wantUser)
	if !slices.Equal(byName[rbac.RoleUser], wantUser) {
		t.Errorf("user grants = %v, want %v", byName[rbac.RoleUser], wantUser)
	}
	wantAdmin := rbac.SeedAdminGrants()
	slices.Sort(wantAdmin)
	if !slices.Equal(byName[rbac.RoleAdmin], wantAdmin) {
		t.Errorf("admin grants = %v, want %v", byName[rbac.RoleAdmin], wantAdmin)
	}
}

func TestRoleCRUD(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	id, err := store.CreateRole(ctx, "race-director", "레이스 운영")
	if err != nil || id == "" {
		t.Fatalf("create role = (%q, %v)", id, err)
	}
	if _, err := store.CreateRole(ctx, "race-director", ""); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate create = %v, want ErrDuplicate", err)
	}
	for _, bad := range []string{"", "Race", "race_director", "-x"} {
		if _, err := store.CreateRole(ctx, bad, ""); !errors.Is(err, ErrBadUpload) {
			t.Errorf("create %q = %v, want ErrBadUpload", bad, err)
		}
	}

	// Grant, then delete: cascade must clear the grants and assignments.
	if err := store.SetRolePermissions(ctx, "race-director", []string{"pithub.race", rbac.PermAnalyzeRead}); err != nil {
		t.Fatalf("set role permissions: %v", err)
	}
	accID, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")
	if err := store.SetAccountRoles(ctx, accID, []string{rbac.RoleUser, "race-director"}); err != nil {
		t.Fatalf("set account roles: %v", err)
	}
	if err := store.DeleteRole(ctx, "race-director"); err != nil {
		t.Fatalf("delete role: %v", err)
	}
	roles, err := store.GetAccountRoles(ctx, accID)
	if err != nil || !slices.Equal(roles, []string{rbac.RoleUser}) {
		t.Fatalf("roles after cascade = (%v, %v), want ([user], nil)", roles, err)
	}
	if err := store.DeleteRole(ctx, "race-director"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("re-delete = %v, want ErrNotFound", err)
	}
	// Seed roles are protected.
	if err := store.DeleteRole(ctx, rbac.RoleUser); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delete user = %v, want ErrForbidden", err)
	}
	if err := store.DeleteRole(ctx, rbac.RoleAdmin); !errors.Is(err, ErrForbidden) {
		t.Fatalf("delete admin = %v, want ErrForbidden", err)
	}
}

func TestSetRolePermissionsValidation(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	if _, err := store.CreateRole(ctx, "helper", ""); err != nil {
		t.Fatalf("create: %v", err)
	}

	// The setup metadata update leaf is catalogued and grantable. Keep a
	// separate unknown-but-well-formed leaf pin so catalog validation remains
	// a clean 400 rather than an FK-backed 500.
	if err := store.SetRolePermissions(ctx, "helper", []string{rbac.PermRaceUpdate}); err != nil {
		t.Fatalf("race.update grant = %v, want nil", err)
	}
	if err := store.SetRolePermissions(ctx, "helper", []string{"pithub.race.delete"}); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unknown node = %v, want ErrBadUpload", err)
	}
	if err := store.SetRolePermissions(ctx, "helper", []string{"pithub.race.list"}); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("malformed node = %v, want ErrBadUpload", err)
	}
	if err := store.SetRolePermissions(ctx, "missing", []string{rbac.PermRaceRead}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing role = %v, want ErrNotFound", err)
	}
	// Duplicates collapse; replace semantics drop previous grants.
	if err := store.SetRolePermissions(ctx, "helper", []string{rbac.PermRaceRead, rbac.PermRaceRead, "pithub.wallet"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if err := store.SetRolePermissions(ctx, "helper", []string{rbac.PermSetupRead}); err != nil {
		t.Fatalf("replace: %v", err)
	}
	roles, err := store.ListRoles(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, r := range roles {
		if r.Name == "helper" && !slices.Equal(r.Permissions, []string{rbac.PermSetupRead}) {
			t.Fatalf("helper grants = %v, want [sender.setup.read]", r.Permissions)
		}
	}
	// Empty replacement is allowed (role with zero grants).
	if err := store.SetRolePermissions(ctx, "helper", nil); err != nil {
		t.Fatalf("clear: %v", err)
	}
}

func TestAccountRolesAndAssign(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	accID, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")

	// Fresh account has the default role.
	roles, err := store.GetAccountRoles(ctx, accID)
	if err != nil || !slices.Equal(roles, []string{rbac.RoleUser}) {
		t.Fatalf("fresh roles = (%v, %v), want ([user], nil)", roles, err)
	}
	if _, err := store.GetAccountRoles(ctx, zeroUUID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing account = %v, want ErrNotFound", err)
	}

	if err := store.SetAccountRoles(ctx, accID, []string{"ghost-role"}); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unknown role = %v, want ErrBadUpload", err)
	}
	if err := store.SetAccountRoles(ctx, zeroUUID, []string{rbac.RoleUser}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing account set = %v, want ErrNotFound", err)
	}
	// Replace with admin+user, then clear entirely.
	if err := store.SetAccountRoles(ctx, accID, []string{rbac.RoleAdmin, rbac.RoleUser}); err != nil {
		t.Fatalf("set: %v", err)
	}
	roles, _ = store.GetAccountRoles(ctx, accID)
	if !slices.Equal(roles, []string{rbac.RoleAdmin, rbac.RoleUser}) {
		t.Fatalf("roles = %v, want [admin user]", roles)
	}
	if err := store.SetAccountRoles(ctx, accID, nil); err != nil {
		t.Fatalf("clear: %v", err)
	}
	roles, err = store.GetAccountRoles(ctx, accID)
	if err != nil || roles == nil || len(roles) != 0 {
		t.Fatalf("cleared roles = (%v, %v), want empty non-nil", roles, err)
	}

	// AssignRole: idempotent grant.
	granted, err := store.AssignRole(ctx, accID, rbac.RoleAdmin)
	if err != nil || !granted {
		t.Fatalf("assign = (%v, %v), want (true, nil)", granted, err)
	}
	granted, err = store.AssignRole(ctx, accID, rbac.RoleAdmin)
	if err != nil || granted {
		t.Fatalf("re-assign = (%v, %v), want (false, nil)", granted, err)
	}
	if _, err := store.AssignRole(ctx, accID, "ghost-role"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("assign unknown role = %v, want ErrNotFound", err)
	}
	if _, err := store.AssignRole(ctx, zeroUUID, rbac.RoleAdmin); !errors.Is(err, ErrNotFound) {
		t.Fatalf("assign to missing account = %v, want ErrNotFound", err)
	}
}

// TestLookupSessionPermissions pins the per-request aggregation: raw grant
// nodes, sorted, empty-non-nil for roleless accounts, hierarchy preserved.
func TestLookupSessionPermissions(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	accID, _ := store.UpsertSteamAccount(ctx, testSteamID, "P", "")
	tok, _ := store.CreateSession(ctx, accID, ScopeWeb, WebSessionTTL)

	p, err := store.LookupSession(ctx, tok)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	want := rbac.SeedUserGrants()
	slices.Sort(want)
	if !slices.Equal(p.Permissions, want) {
		t.Fatalf("permissions = %v, want sorted user seed %v", p.Permissions, want)
	}
	if !rbac.HasPermission(p.Permissions, rbac.PermRaceCreate) {
		t.Fatal("user principal must cover race.create")
	}
	if rbac.HasPermission(p.Permissions, rbac.PermAnalyzeRead) {
		t.Fatal("user principal must not cover race-analyze.read")
	}

	// Revoke everything → empty, non-nil.
	if err := store.SetAccountRoles(ctx, accID, nil); err != nil {
		t.Fatalf("clear roles: %v", err)
	}
	p, err = store.LookupSession(ctx, tok)
	if err != nil {
		t.Fatalf("lookup after revoke: %v", err)
	}
	if p.Permissions == nil || len(p.Permissions) != 0 {
		t.Fatalf("permissions after revoke = %#v, want empty non-nil", p.Permissions)
	}

	// Hierarchy grant arrives raw ("pithub"), not expanded, and matches leaves.
	if err := store.SetAccountRoles(ctx, accID, []string{rbac.RoleAdmin}); err != nil {
		t.Fatalf("assign admin: %v", err)
	}
	p, _ = store.LookupSession(ctx, tok)
	if !slices.Contains(p.Permissions, "pithub") {
		t.Fatalf("admin permissions = %v, want raw root node", p.Permissions)
	}
	if !rbac.HasPermission(p.Permissions, rbac.PermMarketCreate) || !rbac.HasPermission(p.Permissions, rbac.PermRBACDelete) {
		t.Fatal("root grant must cover all pithub leaves")
	}
}

// TestUpsertDefaultRoleNoResurrect pins the xmax=0 CTE behavior: the default
// role is granted exactly once at creation and never resurrected by re-login
// after an operator revoked it.
func TestUpsertDefaultRoleNoResurrect(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	id1, err := store.UpsertSteamAccount(ctx, testSteamID, "Ayrton", "")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	roles, _ := store.GetAccountRoles(ctx, id1)
	if !slices.Equal(roles, []string{rbac.RoleUser}) {
		t.Fatalf("new account roles = %v, want [user]", roles)
	}

	// Operator revokes; a later login must NOT bring the role back.
	if err := store.SetAccountRoles(ctx, id1, nil); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	id2, err := store.UpsertSteamAccount(ctx, testSteamID, "Senna", "")
	if err != nil || id1 != id2 {
		t.Fatalf("re-upsert = (%v, %v)", id2, err)
	}
	roles, err = store.GetAccountRoles(ctx, id1)
	if err != nil || len(roles) != 0 {
		t.Fatalf("roles after re-login = (%v, %v), want empty", roles, err)
	}
	// Display-field refresh (existing upsert behavior) must survive the CTE.
	acc, _ := store.GetAccount(ctx, id1)
	if acc.Persona != "Senna" {
		t.Fatalf("persona = %q, want refreshed", acc.Persona)
	}
}
