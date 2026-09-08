// Package rbac holds the pure permission-matching and naming rules shared by
// cmd/platform, cmd/sender, and internal/platformsvc. It is the CANONICAL
// source for these rules — the TypeScript mirrors (web/src/hub/data/permissions.ts,
// apps/setup-manager/src/permissions.ts) and the DDL CHECKs in
// internal/platformsvc/migrations/009_rbac.sql copy what is defined here.
//
// Node names are {service}[.{scope}[.{action}]] — kebab-case segments joined
// by '.', depth 1..3, and a depth-3 action is one of the CRUD verbs. Grants
// stored on a role may be nodes at ANY depth: granting a node covers its whole
// subtree (see HasPermission).
//
// Contract for every surface that returns permissions (/me, /permissions,
// sender /api/status): the RAW grant nodes are returned, never an expanded
// leaf list — e.g. an admin holding "pithub" reports ["pithub", ...], not the
// 20 leaves. Consumers must therefore match with HasPermission, never with a
// plain slice contains.
//
// This package must stay dependency-free: cmd/sender links it and must not
// pull platformsvc (pgx) into the sender binary.
package rbac

import "strings"

// Seeded role names. The migration seeds them and the platform refuses to
// delete them ('user' backs the default-grant machinery, 'admin' the env
// bootstrap).
const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// Seeded leaf permissions. Gate wiring must use these constants, not string
// literals, so the compiler catches drift against the seeded catalog.
const (
	PermDeviceCreate      = "pithub.device.create"
	PermRaceCreate        = "pithub.race.create"
	PermRaceRead          = "pithub.race.read"
	PermRaceUpdate        = "pithub.race.update"
	PermAnalyzeCreate     = "pithub.race-analyze.create"
	PermAnalyzeRead       = "pithub.race-analyze.read"
	PermAnalyzeDelete     = "pithub.race-analyze.delete"
	PermMarketCreate      = "pithub.market.create"
	PermMarketRead        = "pithub.market.read"
	PermMarketUpdate      = "pithub.market.update"
	PermWalletRead        = "pithub.wallet.read"
	PermPurchaseCreate    = "pithub.purchase.create"
	PermReviewCreate      = "pithub.review.create"
	PermFeedbackCreate    = "pithub.feedback.create"
	PermFeedbackRead      = "pithub.feedback.read"
	PermFeedbackInboxRead = "pithub.feedback-inbox.read"
	PermUpdateLogCreate   = "pithub.update-log.create"
	PermViewAsCreate      = "pithub.view-as.create"
	PermRBACCreate        = "pithub.rbac.create"
	PermRBACRead          = "pithub.rbac.read"
	PermRBACUpdate        = "pithub.rbac.update"
	PermRBACDelete        = "pithub.rbac.delete"
	PermBroadcastCreate   = "pitwall.broadcast.create"
	PermSetupRead         = "sender.setup.read"
)

// maxNodeLen mirrors permissions_name_format_chk in 009_rbac.sql.
const maxNodeLen = 64

// crudActions is the closed set of depth-3 segments (permissions_action_chk).
var crudActions = map[string]bool{
	"create": true, "read": true, "update": true, "delete": true,
}

// seedRoots/seedMids/seedLeaves together are the full catalog seeded by the
// RBAC migrations. Three-way pinned: this list ↔ the migration INSERTs ↔ the
// testStore seed-grant restore; the integration test checks the DB side.
var seedRoots = []string{"pithub", "pitwall", "sender"}

var seedMids = []string{
	"pithub.device", "pithub.race", "pithub.race-analyze", "pithub.market",
	"pithub.wallet", "pithub.purchase", "pithub.review", "pithub.feedback",
	"pithub.feedback-inbox", "pithub.view-as", "pithub.rbac", "pitwall.broadcast", "sender.setup",
	"pithub.update-log",
}

var seedLeaves = []string{
	PermDeviceCreate, PermRaceCreate, PermRaceRead, PermRaceUpdate,
	PermAnalyzeCreate, PermAnalyzeRead, PermAnalyzeDelete,
	PermMarketCreate, PermMarketRead, PermMarketUpdate,
	PermWalletRead, PermPurchaseCreate, PermReviewCreate,
	PermFeedbackCreate, PermFeedbackRead,
	PermFeedbackInboxRead,
	PermUpdateLogCreate,
	PermViewAsCreate,
	PermRBACCreate, PermRBACRead, PermRBACUpdate, PermRBACDelete,
	PermBroadcastCreate, PermSetupRead,
}

// AllSeededNodes returns the complete seeded permission catalog (roots, mid
// nodes, and leaves) in a fresh slice.
func AllSeededNodes() []string {
	nodes := make([]string, 0, len(seedRoots)+len(seedMids)+len(seedLeaves))
	nodes = append(nodes, seedRoots...)
	nodes = append(nodes, seedMids...)
	nodes = append(nodes, seedLeaves...)
	return nodes
}

// SeedUserGrants returns the grants seeded on the 'user' role: leaves only,
// as a seed principle (not a runtime invariant) — future actions added under
// a scope must not leak to all users implicitly.
func SeedUserGrants() []string {
	return []string{
		PermDeviceCreate, PermRaceCreate, PermRaceRead, PermRaceUpdate,
		PermMarketCreate, PermMarketRead, PermMarketUpdate,
		PermWalletRead, PermPurchaseCreate, PermReviewCreate,
		PermFeedbackCreate, PermFeedbackRead,
		PermBroadcastCreate, PermSetupRead,
	}
}

// SeedAdminGrants returns the grants seeded on the 'admin' role: the three
// service roots — subtree inheritance deliberately includes future nodes.
func SeedAdminGrants() []string {
	return []string{"pithub", "pitwall", "sender"}
}

// HasPermission reports whether grants contains node exactly or contains one
// of its dot-separated ancestors. Dot-boundary strict: a "pithub.race" grant
// covers "pithub.race.read" but never "pithub.race-analyze.read" (the catalog
// really has such sibling scopes — a plain prefix check would be a privilege
// escalation).
func HasPermission(grants []string, node string) bool {
	for _, g := range grants {
		if g == node {
			return true
		}
		// g == node was handled above, so a true HasPrefix implies
		// len(node) > len(g) and node[len(g)] is in bounds.
		if len(g) > 0 && strings.HasPrefix(node, g) && node[len(g)] == '.' {
			return true
		}
	}
	return false
}

// validSegment reports whether s matches ^[a-z0-9]+(-[a-z0-9]+)*$ — kebab-case
// with single dashes, no leading/trailing/consecutive dashes.
func validSegment(s string) bool {
	if s == "" || s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	prevDash := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '-':
			if prevDash {
				return false
			}
			prevDash = true
		case (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
			prevDash = false
		default:
			return false
		}
	}
	return true
}

// ValidNode reports whether name is a well-formed permission node:
// 1..3 kebab-case segments joined by '.', ≤64 bytes, and — when a third
// segment (action) is present — one of create/read/update/delete.
// Mirrors permissions_name_format_chk + permissions_action_chk in 009_rbac.sql.
func ValidNode(name string) bool {
	if name == "" || len(name) > maxNodeLen {
		return false
	}
	segs := strings.Split(name, ".")
	if len(segs) > 3 {
		return false
	}
	for _, s := range segs {
		if !validSegment(s) {
			return false
		}
	}
	if len(segs) == 3 && !crudActions[segs[2]] {
		return false
	}
	return true
}

// maxRoleNameLen mirrors roles_name_format_chk in 009_rbac.sql.
const maxRoleNameLen = 32

// ValidRoleName reports whether name is a well-formed role name: one
// kebab-case segment, 1..32 bytes. Mirrors roles_name_format_chk.
func ValidRoleName(name string) bool {
	return len(name) <= maxRoleNameLen && validSegment(name)
}
