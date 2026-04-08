package signaling

import "strings"

const frcProductPrefix = "product.c6da03fd-4b88-48ac-87af-592776ef8dbf."

// FRCPermissionKeys returns the full FRC permission key list for all 9 feature flags.
func FRCPermissionKeys() []string {
	features := []string{
		"ers_estimate",
		"ers_actual",
		"advanced_strategy",
		"pit",
		"top_speed",
		"player_delta",
		"commentary",
		"quali",
		"combat",
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
		}
	}
	return p
}
