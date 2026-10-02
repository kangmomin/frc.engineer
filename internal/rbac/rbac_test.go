package rbac

import (
	"strings"
	"testing"
)

func TestHasPermission(t *testing.T) {
	cases := []struct {
		name   string
		grants []string
		node   string
		want   bool
	}{
		{"exact leaf", []string{PermMarketCreate}, PermMarketCreate, true},
		{"new setup metadata leaf", []string{PermRaceUpdate}, PermRaceUpdate, true},
		{"root covers leaf", []string{"pithub"}, PermRaceRead, true},
		{"root covers mid", []string{"pithub"}, "pithub.race", true},
		{"mid covers leaf", []string{"pithub.race"}, PermRaceRead, true},
		// The catalog has sibling scopes sharing a prefix — the dot boundary
		// is what prevents a "race" grant from leaking into "race-analyze".
		{"race grant must not cover race-analyze", []string{"pithub.race"}, PermAnalyzeRead, false},
		{"race-analyze grant must not cover race", []string{"pithub.race-analyze"}, PermRaceRead, false},
		{"leaf does not cover ancestor", []string{PermRaceRead}, "pithub.race", false},
		{"leaf does not cover sibling", []string{PermRaceRead}, PermRaceCreate, false},
		{"other service", []string{"pitwall"}, PermSetupRead, false},
		{"empty grants", []string{}, PermRaceRead, false},
		{"nil grants", nil, PermRaceRead, false},
		{"empty-string grant matches nothing", []string{""}, PermRaceRead, false},
		{"node shorter than grant", []string{PermRaceRead}, "pithub", false},
		{"admin seed covers everything wired", SeedAdminGrants(), PermRBACDelete, true},
	}
	for _, c := range cases {
		if got := HasPermission(c.grants, c.node); got != c.want {
			t.Errorf("%s: HasPermission(%v, %q) = %v, want %v", c.name, c.grants, c.node, got, c.want)
		}
	}
}

func TestValidNode(t *testing.T) {
	valid := []string{
		"pithub", "pitwall.broadcast", "pithub.race-analyze.read",
		"a.b.create", "a1-b2.c3.delete",
	}
	for _, n := range valid {
		if !ValidNode(n) {
			t.Errorf("ValidNode(%q) = false, want true", n)
		}
	}
	invalid := []string{
		"",
		"Pithub",                 // uppercase
		"pithub..read",           // empty segment
		"pithub.race.read.extra", // depth 4
		"pithub.race.list",       // non-CRUD action
		"pithub.race.Read",       // uppercase action
		"pit_hub",                // underscore
		"-pithub",                // leading dash
		"pithub-",                // trailing dash
		"pit--hub",               // consecutive dashes
		".pithub",                // leading dot
		"pithub.",                // trailing dot
		strings.Repeat("a", 65),  // over max length
		"pithub.race read",       // space
	}
	for _, n := range invalid {
		if ValidNode(n) {
			t.Errorf("ValidNode(%q) = true, want false", n)
		}
	}
	// Exact boundary: 64 bytes is allowed.
	exact := strings.Repeat("a", 64)
	if !ValidNode(exact) {
		t.Errorf("ValidNode(64-byte name) = false, want true")
	}
}

func TestValidRoleName(t *testing.T) {
	for _, n := range []string{"user", "admin", "race-director", "a", strings.Repeat("a", 32)} {
		if !ValidRoleName(n) {
			t.Errorf("ValidRoleName(%q) = false, want true", n)
		}
	}
	for _, n := range []string{"", "User", "role.name", "role_name", "-role", strings.Repeat("a", 33)} {
		if ValidRoleName(n) {
			t.Errorf("ValidRoleName(%q) = true, want false", n)
		}
	}
}

// TestSeedCatalogIntegrity pins the seeded catalog's internal consistency:
// every node is well-formed, unique, and every non-root node's ancestors are
// themselves in the catalog (grantable at any level).
func TestSeedCatalogIntegrity(t *testing.T) {
	nodes := AllSeededNodes()
	if len(nodes) != 45 {
		t.Fatalf("AllSeededNodes() has %d nodes, want 45", len(nodes))
	}
	seen := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		if !ValidNode(n) {
			t.Errorf("seeded node %q is not a valid node", n)
		}
		if seen[n] {
			t.Errorf("seeded node %q duplicated", n)
		}
		seen[n] = true
	}
	for _, n := range nodes {
		for i := 0; i < len(n); i++ {
			if n[i] == '.' {
				if ancestor := n[:i]; !seen[ancestor] {
					t.Errorf("node %q has ancestor %q missing from catalog", n, ancestor)
				}
			}
		}
	}
	// Role seeds must be drawn from the catalog.
	for _, g := range append(SeedUserGrants(), SeedAdminGrants()...) {
		if !seen[g] {
			t.Errorf("seed grant %q is not in the catalog", g)
		}
	}
	if len(SeedUserGrants()) != 14 {
		t.Errorf("SeedUserGrants() has %d grants, want 14", len(SeedUserGrants()))
	}
	if HasPermission(SeedUserGrants(), PermStrategyRead) {
		t.Error("strategy read must not be granted to ordinary users by default")
	}
	if HasPermission(SeedUserGrants(), PermEngineerDecisionCreate) {
		t.Error("the platform decision relay must not be granted to ordinary users by default")
	}
	if !HasPermission(SeedAdminGrants(), PermEngineerDecisionCreate) {
		t.Error("admins must inherit the platform decision relay through the sender root")
	}
	if !HasPermission(SeedUserGrants(), PermRaceUpdate) {
		t.Error("default user grants must include setup metadata update access")
	}
	if HasPermission(SeedUserGrants(), PermFeedbackInboxRead) {
		t.Error("default user grants must not include feedback inbox access")
	}
	if HasPermission(SeedUserGrants(), PermUpdateLogCreate) || !HasPermission(SeedAdminGrants(), PermUpdateLogCreate) {
		t.Error("update-log publication must be operator-only")
	}
	if HasPermission(SeedUserGrants(), PermViewAsCreate) {
		t.Error("default user grants must not include view-as access")
	}
	if !HasPermission(SeedAdminGrants(), PermViewAsCreate) {
		t.Error("admin root grants must inherit view-as access")
	}
	if !HasPermission(SeedAdminGrants(), PermFeedbackInboxRead) {
		t.Error("admin root grants must inherit feedback inbox access")
	}
}
