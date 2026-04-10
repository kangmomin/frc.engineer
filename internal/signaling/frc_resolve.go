package signaling

import "strings"

const frcProductPrefix = "product.c6da03fd-4b88-48ac-87af-592776ef8dbf."

// FRCPermissionKeys returns the full FRC permission key list for all supported feature flags.
func FRCPermissionKeys() []string {
	features := []string{
		"ers",
		"ers_estimate",
		"ers_actual",
		"advanced_strategy",
		"pit",
		"top_speed",
		"player_delta",
		"commentary",
		"quali",
		"combat",
		"pitwall",
		"overlay",
		"setup_support",
	}
	keys := make([]string, len(features))
	for i, f := range features {
		keys[i] = frcProductPrefix + f
	}
	return keys
}

// MapFRCPermissions converts FRC API permission results to a Permissions struct.
func MapFRCPermissions(m map[string]bool) Permissions {
	var p Permissions
	if granted, ok := m[frcProductPrefix+"ers"]; ok {
		p.ViewERSEstimate = granted
		p.ViewERSActual = granted
	}
	for key, granted := range m {
		feature := strings.TrimPrefix(key, frcProductPrefix)
		switch feature {
		case "ers_estimate":
			p.ViewERSEstimate = granted
		case "ers_actual":
			p.ViewERSActual = granted
		case "advanced_strategy":
			p.ViewAdvancedStrategy = granted
		case "pit":
			p.ViewPitStatus = granted
		case "top_speed":
			p.ViewTopSpeed = granted
		case "player_delta":
			p.ViewPlayerDelta = granted
		case "commentary":
			p.ViewCommentary = granted
		case "quali":
			p.ViewQualifying = granted
		case "combat":
			p.ViewCombat = granted
		case "pitwall":
			p.Pitwall = granted
		case "overlay":
			p.Overlay = granted
		case "setup_support":
			p.SetupSupport = granted
		}
	}
	return p
}

// DriverPermissions is a lightweight subset used by the sender to gate driver-side features.
type DriverPermissions struct {
	Pitwall      bool `json:"pitwall"`
	Overlay      bool `json:"overlay"`
	SetupSupport bool `json:"setupSupport"`
}

// FRCDriverPermissionKeys returns only the 3 driver-level permission keys.
func FRCDriverPermissionKeys() []string {
	features := []string{"pitwall", "overlay", "setup_support"}
	keys := make([]string, len(features))
	for i, f := range features {
		keys[i] = frcProductPrefix + f
	}
	return keys
}

// MapFRCDriverPermissions converts FRC API results to DriverPermissions.
func MapFRCDriverPermissions(m map[string]bool) DriverPermissions {
	var p DriverPermissions
	for key, granted := range m {
		feature := strings.TrimPrefix(key, frcProductPrefix)
		switch feature {
		case "pitwall":
			p.Pitwall = granted
		case "overlay":
			p.Overlay = granted
		case "setup_support":
			p.SetupSupport = granted
		}
	}
	return p
}
