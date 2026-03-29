package signaling

import (
	"path/filepath"
	"testing"
)

func TestPermissionCodeStorePersistsNormalizedCodes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "permission-codes.json")

	store, err := LoadPermissionCodeStore(path, testLogger())
	if err != nil {
		t.Fatalf("LoadPermissionCodeStore failed: %v", err)
	}

	entry, err := store.Upsert("  vip-1  ", "VIP", Permissions{
		ViewERSActual:        true,
		ViewAdvancedStrategy: false,
	})
	if err != nil {
		t.Fatalf("Upsert failed: %v", err)
	}
	if entry.Code != "VIP-1" {
		t.Fatalf("expected normalized code VIP-1, got %q", entry.Code)
	}

	reloaded, err := LoadPermissionCodeStore(path, testLogger())
	if err != nil {
		t.Fatalf("reload failed: %v", err)
	}
	permissions, ok := reloaded.Resolve("vip-1")
	if !ok {
		t.Fatal("expected reloaded store to resolve normalized code")
	}
	if !permissions.ViewERSActual || permissions.ViewAdvancedStrategy {
		t.Fatalf("unexpected permissions: %#v", permissions)
	}
}
