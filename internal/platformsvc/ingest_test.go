package platformsvc

import (
	"context"
	"errors"
	"testing"
)

const (
	steamA = "76561197960287930"
	steamB = "76561197960287931"
	steamC = "76561197960287932"
)

// vlap builds a lap whose sectors sum exactly to lap_ms (passes the sector
// check) and is client-valid.
func vlap(n int, ms uint32) UploadLap {
	s := ms / 3
	return UploadLap{LapNumber: n, LapMs: ms, S1Ms: s, S2Ms: s, S3Ms: ms - 2*s, Tyre: "Soft", Valid: true}
}

func ingest(t *testing.T, store *Store, accountID, source string, trackID int, laps ...UploadLap) *UploadResult {
	t.Helper()
	res, err := store.IngestRace(context.Background(), accountID, UploadRequest{
		SourceRaceID: source, TrackID: trackID, TrackName: "X",
		SessionType: "Time Trial", GameFormat: "F1 26", Laps: laps,
	})
	if err != nil {
		t.Fatalf("ingest(%s): %v", source, err)
	}
	return res
}

func TestIngestPlausibleRace(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	res := ingest(t, store, id, "r1", 99, vlap(1, 90000), vlap(2, 88000), vlap(3, 89000))
	if !res.Plausible || res.BestLapMS != 88000 || res.ValidLaps != 3 || res.StoredLaps != 3 || res.Duplicate {
		t.Fatalf("result = %+v", res)
	}
	acc, _ := store.GetAccount(ctx, id)
	if !acc.Verified {
		t.Fatal("account should be verified (proof-of-play) after a plausible race")
	}
	var best *int
	if err := store.pool.QueryRow(ctx, `SELECT best_lap_ms FROM platform.races WHERE id=$1`, res.RaceID).Scan(&best); err != nil {
		t.Fatalf("query best: %v", err)
	}
	if best == nil || *best != 88000 {
		t.Fatalf("stored best_lap_ms = %v, want 88000", best)
	}
}

func TestIngestOutOfBoundsNotPlausible(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	// Track 99 is unseeded → generic min 45s. A 30s "lap" is below the floor.
	res := ingest(t, store, id, "r1", 99, vlap(1, 30000))
	if res.Plausible || res.ValidLaps != 0 || res.BestLapMS != 0 {
		t.Fatalf("out-of-bounds result = %+v", res)
	}
	var best *int
	_ = store.pool.QueryRow(ctx, `SELECT best_lap_ms FROM platform.races WHERE id=$1`, res.RaceID).Scan(&best)
	if best != nil {
		t.Fatalf("best_lap_ms = %v, want NULL when no valid lap", *best)
	}
	acc, _ := store.GetAccount(ctx, id)
	if acc.Verified {
		t.Fatal("account must not be verified from an implausible race")
	}
}

func TestIngestPerTrackBounds(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	// Track 5 (Monaco) is seeded with min 60s. 50s rejected, 70s accepted.
	res := ingest(t, store, id, "r1", 5, vlap(1, 50000), vlap(2, 70000))
	if !res.Plausible || res.ValidLaps != 1 || res.BestLapMS != 70000 {
		t.Fatalf("per-track result = %+v", res)
	}
}

func TestIngestSectorMismatch(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	// Sectors sum to 30000 but lap claims 90000 → inconsistent → invalid.
	bad := UploadLap{LapNumber: 1, LapMs: 90000, S1Ms: 10000, S2Ms: 10000, S3Ms: 10000, Tyre: "Soft", Valid: true}
	res := ingest(t, store, id, "r1", 99, bad)
	if res.Plausible || res.ValidLaps != 0 {
		t.Fatalf("sector-mismatch result = %+v", res)
	}
}

func TestIngestDuplicateIdempotent(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	first := ingest(t, store, id, "r1", 99, vlap(1, 88000))
	second := ingest(t, store, id, "r1", 99, vlap(1, 88000))
	if !second.Duplicate || second.RaceID != first.RaceID {
		t.Fatalf("re-upload not idempotent: first=%+v second=%+v", first, second)
	}
	var n int
	_ = store.pool.QueryRow(ctx, `SELECT count(*) FROM platform.races WHERE account_id=$1`, id).Scan(&n)
	if n != 1 {
		t.Fatalf("race count = %d, want 1 (no duplicate row)", n)
	}
}

func TestIngestBadUpload(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	// Duplicate lap number.
	_, err := store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r1", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000), vlap(1, 89000)}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("dup lap number err = %v, want ErrBadUpload", err)
	}
	// Empty source id.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "", TrackID: 99, Laps: []UploadLap{vlap(1, 88000)}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("empty source err = %v, want ErrBadUpload", err)
	}
	// No laps.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r2", TrackID: 99})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("no laps err = %v, want ErrBadUpload", err)
	}
}

func TestIngestTyreNormalized(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	hax := UploadLap{LapNumber: 1, LapMs: 88000, Tyre: "'; DROP TABLE--", Valid: true}
	res := ingest(t, store, id, "r1", 99, hax, vlap(2, 89000))
	var tyres []string
	rows, _ := store.pool.Query(ctx, `SELECT tyre FROM platform.laps WHERE race_id=$1 ORDER BY lap_number`, res.RaceID)
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		tyres = append(tyres, s)
	}
	rows.Close()
	if len(tyres) != 2 || tyres[0] != "" || tyres[1] != "Soft" {
		t.Fatalf("tyres = %v, want [\"\" \"Soft\"]", tyres)
	}
}

func TestIngestSetupHashDeterministic(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")
	setup := &UploadSetup{FrontWing: 5, RearWing: 7, FrontCamber: -3.1234, FuelLoad: 10.5006}

	r1, err := store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r1", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000)}, Setup: setup})
	if err != nil {
		t.Fatalf("ingest r1: %v", err)
	}
	r2, err := store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r2", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000)}, Setup: setup})
	if err != nil {
		t.Fatalf("ingest r2: %v", err)
	}
	var h1, h2 string
	_ = store.pool.QueryRow(ctx, `SELECT content_hash FROM platform.race_setup WHERE race_id=$1`, r1.RaceID).Scan(&h1)
	_ = store.pool.QueryRow(ctx, `SELECT content_hash FROM platform.race_setup WHERE race_id=$1`, r2.RaceID).Scan(&h2)
	if h1 == "" || h1 != h2 {
		t.Fatalf("content_hash not deterministic: %q vs %q", h1, h2)
	}
}

// TestIngestTouchesNoEconomyTables is a no-faucet tripwire: a plausible race
// must never write to wallet/ledger tables. They do not exist until 3D1; once
// they do, this asserts ingestion leaves them empty.
func TestIngestTouchesNoEconomyTables(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")
	ingest(t, store, id, "r1", 99, vlap(1, 88000))

	for _, tbl := range []string{"platform.ledger_entries", "platform.wallets"} {
		var reg *string
		if err := store.pool.QueryRow(ctx, `SELECT to_regclass($1)::text`, tbl).Scan(&reg); err != nil {
			t.Fatalf("to_regclass(%s): %v", tbl, err)
		}
		if reg == nil {
			continue // table not created yet (pre-3D1)
		}
		var n int
		if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM `+tbl).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", tbl, err)
		}
		if n != 0 {
			t.Fatalf("ingestion wrote %d rows to %s — no-faucet invariant broken", n, tbl)
		}
	}
}

func TestTimeTrialLeaderboard(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	a1, _ := store.UpsertSteamAccount(ctx, steamA, "Alice", "")
	a2, _ := store.UpsertSteamAccount(ctx, steamB, "Bob", "")
	a3, _ := store.UpsertSteamAccount(ctx, steamC, "Cara", "")
	ingest(t, store, a1, "r1", 99, vlap(1, 88000))
	ingest(t, store, a2, "r2", 99, vlap(1, 86000))
	ingest(t, store, a3, "r3", 99, vlap(1, 90000))

	rows, err := store.TimeTrialLeaderboard(ctx, 99, "F1 26", a1)
	if err != nil {
		t.Fatalf("tt: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	if rows[0].AccountID != a2 || rows[0].LapMs != 86000 || rows[0].Rank != 1 {
		t.Fatalf("row0 = %+v, want Bob 86000 rank1", rows[0])
	}
	if rows[1].AccountID != a1 || !rows[1].You {
		t.Fatalf("row1 = %+v, want Alice You=true", rows[1])
	}
	if rows[0].S1Ms == 0 {
		t.Fatal("expected sectors populated")
	}
}

func TestTimeTrialBestPerAccount(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	a1, _ := store.UpsertSteamAccount(ctx, steamA, "Alice", "")
	ingest(t, store, a1, "r1", 99, vlap(1, 92000))
	ingest(t, store, a1, "r2", 99, vlap(1, 87000)) // faster, different race

	rows, _ := store.TimeTrialLeaderboard(ctx, 99, "F1 26", "")
	if len(rows) != 1 || rows[0].LapMs != 87000 {
		t.Fatalf("rows = %+v, want single best 87000", rows)
	}
}

func TestPaceLeaderboardMinLaps(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	a1, _ := store.UpsertSteamAccount(ctx, steamA, "Alice", "")
	a2, _ := store.UpsertSteamAccount(ctx, steamB, "Bob", "")

	// a1: 5 valid laps → qualifies. a2: 3 valid laps → excluded.
	ingest(t, store, a1, "r1", 99, vlap(1, 90000), vlap(2, 91000), vlap(3, 90500), vlap(4, 90200), vlap(5, 90800))
	ingest(t, store, a2, "r2", 99, vlap(1, 88000), vlap(2, 88500), vlap(3, 88200))

	rows, err := store.PaceLeaderboard(ctx, 99, "F1 26", "")
	if err != nil {
		t.Fatalf("pace: %v", err)
	}
	if len(rows) != 1 || rows[0].AccountID != a1 {
		t.Fatalf("rows = %+v, want only Alice (>=5 laps)", rows)
	}
	if rows[0].Laps != 5 || rows[0].Consistency <= 0 || rows[0].Consistency > 1 {
		t.Fatalf("pace row = %+v", rows[0])
	}
}

func TestLeaderboardExcludesBanned(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	a1, _ := store.UpsertSteamAccount(ctx, steamA, "Alice", "")
	a2, _ := store.UpsertSteamAccount(ctx, steamB, "Bob", "")
	ingest(t, store, a1, "r1", 99, vlap(1, 80000)) // fastest
	ingest(t, store, a2, "r2", 99, vlap(1, 88000))

	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1,'cheat')`, a1); err != nil {
		t.Fatalf("ban: %v", err)
	}
	rows, _ := store.TimeTrialLeaderboard(ctx, 99, "F1 26", "")
	if len(rows) != 1 || rows[0].AccountID != a2 {
		t.Fatalf("banned account leaked onto leaderboard: %+v", rows)
	}
}
