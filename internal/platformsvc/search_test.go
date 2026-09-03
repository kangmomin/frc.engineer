package platformsvc

import (
	"context"
	"testing"
)

func TestSearchFiltersDedupesAndOrders(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	alpha, _ := store.UpsertSteamAccount(ctx, steamA, "Driver Alpha", "")
	beta, _ := store.UpsertSteamAccount(ctx, steamB, "Driver Beta", "")
	banned, _ := store.UpsertSteamAccount(ctx, steamC, "Driver Banned Monaco", "")

	ingestWithSetup(t, store, alpha, "alpha-old", 3, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, alpha, "alpha-new", 5, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, alpha, "orphaned-listing", 5, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, alpha, "reverse-legacy", 39, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, beta, "beta", 5, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, banned, "banned", 5, setupFixture(), vlap(1, 88000))

	mustList(t, store, alpha, KindSetup, "alpha-new", 100)
	mustList(t, store, alpha, KindSetup, "orphaned-listing", 100)
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.races WHERE source_race_id = 'orphaned-listing'`); err != nil {
		t.Fatalf("delete listing source race: %v", err)
	}
	mustList(t, store, alpha, KindSetup, "reverse-legacy", 100)
	if _, err := store.pool.Exec(ctx, `UPDATE platform.races SET game_format = 'F1 25' WHERE source_race_id = 'reverse-legacy'`); err != nil {
		t.Fatalf("set legacy race format: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.listings SET game_format = 'F1 25' WHERE race_id = (
		SELECT id FROM platform.races WHERE source_race_id = 'reverse-legacy')`); err != nil {
		t.Fatalf("set legacy listing format: %v", err)
	}
	mustList(t, store, banned, KindSetup, "banned", 100)
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, banned); err != nil {
		t.Fatalf("ban: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.races SET uploaded_at = CASE source_race_id
		WHEN 'reverse-legacy' THEN now() - interval '3 hours'
		WHEN 'alpha-old' THEN now() - interval '2 hours'
		WHEN 'alpha-new' THEN now() - interval '1 hour'
		ELSE uploaded_at END`); err != nil {
		t.Fatalf("set upload order: %v", err)
	}

	result, err := store.Search(ctx, "monaco")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(result.Setups) != 2 {
		t.Fatalf("setups = %#v, want two active Driver Alpha setups", result.Setups)
	}
	for _, setup := range result.Setups {
		if setup.SellerPersona != "Driver Alpha" {
			t.Fatalf("setup seller = %q, want unbanned Driver Alpha", setup.SellerPersona)
		}
	}
	orphaned, err := store.Search(ctx, "orphaned")
	if err != nil {
		t.Fatalf("Search orphaned listing: %v", err)
	}
	if len(orphaned.Setups) != 1 || orphaned.Setups[0].Title != "L-orphaned-listing" {
		t.Fatalf("orphaned setup = %#v, want retained active listing", orphaned.Setups)
	}
	legacy, err := store.Search(ctx, "reverse")
	if err != nil {
		t.Fatalf("Search legacy reverse: %v", err)
	}
	if len(legacy.Setups) != 0 {
		t.Fatalf("F1 25 reverse setup = %#v, want excluded", legacy.Setups)
	}

	result, err = store.Search(ctx, "driver")
	if err != nil {
		t.Fatalf("Search drivers: %v", err)
	}
	if len(result.Drivers) != 2 || result.Drivers[0].Persona != "Driver Alpha" || result.Drivers[1].Persona != "Driver Beta" {
		t.Fatalf("drivers = %#v, want Driver Alpha then Driver Beta", result.Drivers)
	}
	if result.Drivers[0].TrackID != 5 || result.Drivers[0].GameFormat != "F1 26" {
		t.Fatalf("latest Alpha context = %#v, want Monaco F1 26", result.Drivers[0])
	}
}

func TestSearchEscapesLikeLiterals(t *testing.T) {
	if got, want := likeEscape(`a\b%_`), `a\\b\%\_`; got != want {
		t.Fatalf("likeEscape = %q, want %q", got, want)
	}
}
