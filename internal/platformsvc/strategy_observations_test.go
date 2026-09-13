package platformsvc

import (
	"context"
	"fmt"
	"math"
	"testing"

	"frc.engineer/internal/strategy/strategytest"
)

func TestStrategyObservationsIncludeHistoricalTimingsWithoutInventedFuel(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	first := UploadRequest{SourceRaceID: "legacy-one", TrackID: 10, GameFormat: "F1 26", SessionType: "Race",
		Laps: []UploadLap{vlap(1, 90000), vlap(2, 92000), vlap(3, 94000), vlap(4, 96000), vlap(5, 88000)}}
	first.Laps[2].Tyre = "Hard"
	first.Laps[3].Tyre = "unknown-attacker-label"
	first.Laps[4].Valid = false
	second := UploadRequest{SourceRaceID: "legacy-two", TrackID: 10, GameFormat: "F1 26", SessionType: "Race", Laps: []UploadLap{vlap(1, 98000)}}
	for _, req := range []UploadRequest{first, second} {
		if result, err := s.IngestRace(ctx, owner, req); err != nil || !result.Plausible {
			t.Fatalf("legacy ingest: %+v %v", result, err)
		}
	}
	rows, err := s.LoadStrategyObservations(ctx, 10, "F1 26")
	if err != nil || len(rows) != 3 {
		t.Fatalf("legacy observations: %+v %v", rows, err)
	}
	for _, row := range rows {
		if row.MedianFuelKg != nil || row.FuelLaps != 0 {
			t.Fatal("timings were converted into fabricated fuel measurements")
		}
		switch row.Tyre {
		case "Soft":
			if row.Uploads != 2 || row.Laps != 3 || row.MedianLapMs != 92000 || row.MinLapMs != 90000 || row.MaxLapMs != 98000 {
				t.Fatalf("wrong valid timing statistics: %+v", row)
			}
		case "Hard":
			if row.Laps != 1 || row.MedianLapMs != 94000 {
				t.Fatalf("tyre groups mixed: %+v", row)
			}
		case "":
			if row.Laps != 1 || row.MedianLapMs != 96000 {
				t.Fatalf("unknown tyre timing lost: %+v", row)
			}
		default:
			t.Fatalf("unnormalized tyre exposed: %q", row.Tyre)
		}
	}
}

func TestStrategyObservationsScopeRaceFormatTrackAndBan(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	banned, err := s.UpsertSteamAccount(ctx, steamB, "Banned", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, banned); err != nil {
		t.Fatal(err)
	}
	for i, sample := range []struct {
		owner, format, session string
		track                  int
	}{
		{owner, "F1 26", "Race", 10}, {owner, "F1 26", "Race 2", 10}, {owner, "F1 26", "Race 3", 10},
		{owner, "F1 26", "Race", 7}, {owner, "F1 25", "Race", 10},
		{owner, "F1 26", "Time Trial", 10}, {owner, "F1 26", "Qualifying", 10}, {banned, "F1 26", "Race", 10},
	} {
		req := UploadRequest{SourceRaceID: fmt.Sprintf("scope-%d", i), TrackID: sample.track, GameFormat: sample.format, SessionType: sample.session,
			Laps: []UploadLap{vlap(1, 90000+uint32(i)*1000)}}
		if _, err := s.IngestRace(ctx, sample.owner, req); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.LoadStrategyObservations(ctx, 10, "F1 26")
	if err != nil || len(rows) != 1 || rows[0].Uploads != 3 || rows[0].Laps != 3 || rows[0].MedianLapMs != 91000 {
		t.Fatalf("race scope leaked: %+v %v", rows, err)
	}
	rows, err = s.LoadStrategyObservations(ctx, AllStrategyTracks, "F1 26")
	if err != nil || len(rows) != 2 || rows[0].TrackID != 7 || rows[1].TrackID != 10 {
		t.Fatalf("all tracks merged: %+v %v", rows, err)
	}
	rows, err = s.LoadStrategyObservations(ctx, 10, "F1 25")
	if err != nil || len(rows) != 1 || rows[0].Laps != 1 || rows[0].MedianLapMs != 94000 {
		t.Fatalf("game scope leaked: %+v %v", rows, err)
	}
	rows, err = s.LoadStrategyObservations(ctx, 99, "F1 26")
	if err != nil || len(rows) != 0 || rows == nil {
		t.Fatalf("missing observations must be an empty list: %+v %v", rows, err)
	}
}

func TestStrategyObservedFuelNeedsMatchingCleanMeasurements(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	record := strategytest.Records()[0]
	req := strategyUpload(record)
	for i, lap := range record.Evidence.Laps {
		req.Laps[i].Tyre = lap.Tyre
	}
	req.Strategy.Laps[1].FuelKg = nil
	req.Strategy.Laps[2].Flags = []string{"traffic"}
	req.Strategy.Laps[3].FuelEndKg = strategytest.Float(*req.Strategy.Laps[3].FuelKg + 1)
	req.Laps[4].Tyre = "Hard" // Valid upload timing has a different tyre than the fuel sample.
	req.Laps[5].Valid = false
	if _, err := s.IngestRace(ctx, owner, req); err != nil {
		t.Fatal(err)
	}
	global := strategyUpload(strategytest.Records()[1])
	for i, lap := range global.Strategy.Laps {
		global.Laps[i].Tyre = lap.Tyre
	}
	global.Strategy.Reasons = []string{"flashback"}
	if _, err := s.IngestRace(ctx, owner, global); err != nil {
		t.Fatal(err)
	}
	rows, err := s.LoadStrategyObservations(ctx, 10, "F1 26")
	if err != nil || len(rows) != 2 {
		t.Fatalf("observed fuel: %+v %v", rows, err)
	}
	var fuelLaps, timingLaps int
	for _, row := range rows {
		fuelLaps += row.FuelLaps
		timingLaps += row.Laps
		if row.MedianFuelKg == nil || math.Abs(*row.MedianFuelKg-1.5) > .00001 {
			t.Fatalf("unclean/unmatched consumption changed the median: %+v", row)
		}
	}
	if fuelLaps != 22 || timingLaps != 59 {
		t.Fatalf("fuel/valid-timing sample counts = %d/%d, want 22/59", fuelLaps, timingLaps)
	}
}

func TestStrategyObservationExpansionIsBoundedBeforeAggregating(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	// Test the full ingestion bound without spending time on 301 HTTP uploads.
	if _, err := s.pool.Exec(ctx, `WITH inserted AS (
		INSERT INTO platform.races(account_id,source_race_id,track_id,game_format,session_type,plausible,uploaded_at)
		SELECT $1,'observation-cap-'||n,10,'F1 26','Race',true,now()-n*interval '1 second' FROM generate_series(1,301) n
		RETURNING id
	) INSERT INTO platform.laps(race_id,lap_number,lap_ms,tyre,valid)
	SELECT id,n,90000,'Soft',true FROM inserted CROSS JOIN generate_series(1,500) n`, owner); err != nil {
		t.Fatal(err)
	}
	rows, err := s.LoadStrategyObservations(ctx, AllStrategyTracks, "F1 26")
	if err != nil || len(rows) != 1 || rows[0].Uploads != StrategyRecordLimit || rows[0].Laps != 150000 || rows[0].FuelLaps != 0 || rows[0].MedianFuelKg != nil {
		t.Fatalf("unbounded archive expansion: %+v %v", rows, err)
	}
}
