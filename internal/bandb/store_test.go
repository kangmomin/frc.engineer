package bandb

import (
	"context"
	"os"
	"testing"
)

// TestStoreIntegration exercises the real Postgres store. It is skipped unless
// TEST_DATABASE_URL is set (no DB in normal unit-test runs).
func TestStoreIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping Postgres integration test")
	}
	ctx := context.Background()
	db, err := Open(ctx, dsn, os.Getenv("TEST_DB_SCHEMA"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	if err := db.EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}

	const ip = "203.0.113.42"
	if err := db.AddIP(ctx, ip, "baddriver", "test"); err != nil {
		t.Fatalf("AddIP: %v", err)
	}
	// Idempotent: second insert must not error.
	if err := db.AddIP(ctx, ip, "baddriver", "test"); err != nil {
		t.Fatalf("AddIP (duplicate): %v", err)
	}

	ips, err := db.ListIPs(ctx)
	if err != nil {
		t.Fatalf("ListIPs: %v", err)
	}
	found := false
	for _, got := range ips {
		if got == ip {
			found = true
		}
	}
	if !found {
		t.Errorf("ListIPs did not contain %q: %v", ip, ips)
	}
}
