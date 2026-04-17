package signaling

import "testing"

func TestMapFRCPermissionsERSFallback(t *testing.T) {
	perms := MapFRCPermissions(map[string]bool{
		frcProductPrefix + "ers": true,
	})

	if !perms.ViewERSActual {
		t.Fatal("expected ers permission to enable actual ERS")
	}
	if !perms.ViewERSEstimate {
		t.Fatal("expected ers permission to enable estimated ERS")
	}
}

func TestMapFRCPermissionsERSExplicitOverride(t *testing.T) {
	perms := MapFRCPermissions(map[string]bool{
		frcProductPrefix + "ers":          true,
		frcProductPrefix + "ers_estimate": false,
	})

	if !perms.ViewERSActual {
		t.Fatal("expected ers permission to keep actual ERS enabled")
	}
	if perms.ViewERSEstimate {
		t.Fatal("expected explicit ers_estimate permission to override ers fallback")
	}
}

func TestFullPermissionsEnablesEverything(t *testing.T) {
	perms := FullPermissions()
	if !perms.ViewERSEstimate ||
		!perms.ViewERSActual ||
		!perms.ViewAdvancedStrategy ||
		!perms.ViewPitStatus ||
		!perms.ViewTopSpeed ||
		!perms.ViewPlayerDelta ||
		!perms.ViewQualifying ||
		!perms.Pitwall ||
		!perms.Overlay ||
		!perms.SetupSupport {
		t.Fatal("expected full permissions to enable every feature")
	}
}

func TestFullDriverPermissionsEnablesEverything(t *testing.T) {
	perms := FullDriverPermissions()
	if !perms.Pitwall || !perms.Overlay || !perms.SetupSupport {
		t.Fatal("expected full driver permissions to enable every feature")
	}
}
