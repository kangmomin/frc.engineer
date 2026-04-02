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
		ViewERSEstimate:      true,
		ViewERSActual:        true,
		ViewAdvancedStrategy: false,
		ViewPitStatus:        true,
		ViewTopSpeed:         true,
		ViewPlayerDelta:      false,
		ViewCommentary:       true,
		ViewQualifying:       false,
		ViewCombat:           false,
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
	permissions, ok, err := reloaded.Resolve("vip-1")
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	if !ok {
		t.Fatal("expected reloaded store to resolve normalized code")
	}
	if !permissions.ViewERSEstimate || !permissions.ViewERSActual || permissions.ViewAdvancedStrategy || !permissions.ViewPitStatus || !permissions.ViewTopSpeed || permissions.ViewPlayerDelta || !permissions.ViewCommentary || permissions.ViewQualifying || permissions.ViewCombat {
		t.Fatalf("unexpected permissions: %#v", permissions)
	}
}

func TestOpenPermissionCodeStoreFallsBackToFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "permission-codes.json")

	store, err := OpenPermissionCodeStore("", path, testLogger())
	if err != nil {
		t.Fatalf("OpenPermissionCodeStore failed: %v", err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	}()

	if store.Backend() != "file" {
		t.Fatalf("expected file backend, got %q", store.Backend())
	}
	if store.Location() != path {
		t.Fatalf("expected location %q, got %q", path, store.Location())
	}
}
