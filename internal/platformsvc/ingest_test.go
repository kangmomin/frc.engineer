package platformsvc

import (
	"context"
	"errors"
	"math"
	"strings"
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
	// Lap ms in (2^31, 2^32): JSON-legal uint32 but overflows the int4 column.
	// Must be a clean 400, not a 500 at INSERT time.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r3", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{{LapNumber: 1, LapMs: 3_000_000_000, Valid: true}}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("overflow lapMs err = %v, want ErrBadUpload", err)
	}
	// Sector ms overflowing int4.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r4", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{{LapNumber: 1, LapMs: 88000, S1Ms: 3_000_000_000, Valid: true}}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("overflow sector err = %v, want ErrBadUpload", err)
	}
	// Huge-but-JSON-legal setup float rounds to +Inf and would fail json.Marshal
	// (→ 500). Must be a clean 400 before any DB work.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "r5", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000)}, Setup: &UploadSetup{FuelLoad: 1.7e308}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("non-finite setup err = %v, want ErrBadUpload", err)
	}
	// Pit: stationary > lane dwell is physically impossible — clean 400 before INSERT.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "rp1", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000)}, Pit: &UploadPit{PitLaneTimeMs: 5000, StationaryMs: 9000}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("pit stationary>lane err = %v, want ErrBadUpload", err)
	}
	// Pit: lane over the int4/CHECK ceiling (600000) — clean 400, not a 500 at INSERT.
	_, err = store.IngestRace(ctx, id, UploadRequest{SourceRaceID: "rp2", TrackID: 99, GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000)}, Pit: &UploadPit{PitLaneTimeMs: 700000}})
	if !errors.Is(err, ErrBadUpload) {
		t.Fatalf("pit lane over ceiling err = %v, want ErrBadUpload", err)
	}
}

// TestValidateLapBoundsSectors covers the per-sector magnitude gate: a single
// garbage sector paired with a zero sector must invalidate the lap (it would
// otherwise skip the sum gate and reach the public leaderboard raw), while
// legitimate partial telemetry (one non-zero sector) stays valid.
func TestValidateLapBoundsSectors(t *testing.T) {
	garbage := UploadLap{LapNumber: 1, LapMs: 90000, S1Ms: 2_000_000_000, S2Ms: 0, S3Ms: 0, Valid: true}
	if validateLap(garbage, genericMinLapMs, genericMaxLapMs) {
		t.Fatal("lap with a 2e9 sector should be invalid")
	}
	partial := UploadLap{LapNumber: 1, LapMs: 90000, S1Ms: 30000, S2Ms: 0, S3Ms: 0, Valid: true}
	if !validateLap(partial, genericMinLapMs, genericMaxLapMs) {
		t.Fatal("partial-telemetry lap should stay valid")
	}
}

// TestValidateUploadDetail exercises the versioned-detail acceptance gates directly
// (no DB): schema_version range, the Detail count caps, and the version floor that a
// Detail block requires. It mirrors the int4/setup-finite guards — a bad payload must
// be a clean 400 (ErrBadUpload), never a 500 at INSERT time.
func TestValidateUploadDetail(t *testing.T) {
	base := func() *UploadRequest {
		return &UploadRequest{
			SourceRaceID: "r1", TrackID: 99, GameFormat: "F1 26",
			Laps: []UploadLap{vlap(1, 88000)},
		}
	}

	// A well-formed v1 request with a small Detail passes.
	ok := base()
	ok.SchemaVersion = 1
	ok.Detail = &UploadDetail{
		Stints:   []UploadStint{{Compound: "Soft", Laps: 25, StartLap: 1, EndLap: 25, TireWearPct: 60}},
		Dynamics: []UploadDynamic{{LapNum: 1, UndersteerPct: 5}},
		Events:   []UploadEvent{{Lap: 3, Category: "penalty", Message: "x", Severity: "warning"}},
	}
	if err := validateUpload(ok); err != nil {
		t.Fatalf("valid v1 detail rejected: %v", err)
	}

	// schema_version past the SMALLINT ceiling → 400 (would overflow the column).
	over := base()
	over.SchemaVersion = maxSchemaVersion + 1
	if err := validateUpload(over); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-range schema_version err = %v, want ErrBadUpload", err)
	}

	// A Detail block with no real version (v0) → 400.
	noVer := base()
	noVer.Detail = &UploadDetail{Events: []UploadEvent{{Category: "info", Message: "x", Severity: "info"}}}
	if err := validateUpload(noVer); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("v0 detail err = %v, want ErrBadUpload", err)
	}

	// Over the event cap → 400.
	fatEvents := base()
	fatEvents.SchemaVersion = 1
	events := make([]UploadEvent, maxDetailEvents+1)
	for i := range events {
		events[i] = UploadEvent{Category: "info", Message: "x", Severity: "info"}
	}
	fatEvents.Detail = &UploadDetail{Events: events}
	if err := validateUpload(fatEvents); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-cap events err = %v, want ErrBadUpload", err)
	}

	// Over the dynamics cap → 400.
	fatDyn := base()
	fatDyn.SchemaVersion = 1
	fatDyn.Detail = &UploadDetail{Dynamics: make([]UploadDynamic, maxDetailDynamics+1)}
	if err := validateUpload(fatDyn); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-cap dynamics err = %v, want ErrBadUpload", err)
	}

	// Over the stint cap → 400.
	fatStints := base()
	fatStints.SchemaVersion = 1
	fatStints.Detail = &UploadDetail{Stints: make([]UploadStint, maxDetailStints+1)}
	if err := validateUpload(fatStints); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-cap stints err = %v, want ErrBadUpload", err)
	}

	// Capture-provenance 필드: 정상 범위 통과, 범위 밖/과장 문자열은 400.
	capOK := base()
	capOK.SchemaVersion = 1
	capOK.Detail = &UploadDetail{CaptureStartLap: 3, FinalizeTrigger: "session-switch"}
	if err := validateUpload(capOK); err != nil {
		t.Fatalf("valid capture fields rejected: %v", err)
	}
	capNeg := base()
	capNeg.SchemaVersion = 1
	capNeg.Detail = &UploadDetail{CaptureStartLap: -1}
	if err := validateUpload(capNeg); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("negative captureStartLap err = %v, want ErrBadUpload", err)
	}
	capOver := base()
	capOver.SchemaVersion = 1
	capOver.Detail = &UploadDetail{CaptureStartLap: maxLapNumber + 1}
	if err := validateUpload(capOver); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-range captureStartLap err = %v, want ErrBadUpload", err)
	}
	trigLong := base()
	trigLong.SchemaVersion = 1
	trigLong.Detail = &UploadDetail{FinalizeTrigger: strings.Repeat("x", maxFinalizeTriggerLen+1)}
	if err := validateUpload(trigLong); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-length finalizeTrigger err = %v, want ErrBadUpload", err)
	}
}

// validIncidentClip builds a minimal clip that passes every validIncident bound:
// two participants (48-rune name at the cap), one collision pair, one frame with
// a full 14-value car row plus a nil (missed-tick) column.
func validIncidentClip() UploadIncident {
	car := make([]float64, incidentCarFrameValues)
	car[9] = 287.4 // 임의 유한값 (speedKmh 자리)
	return UploadIncident{
		SessionTimeMs:   512_340,
		WindowStartMs:   511_340,
		FrameIntervalMs: 50,
		Lap:             3,
		Collisions:      [][2]int{{4, 11}},
		Participants: []UploadIncidentParticipant{
			{Idx: 4, Name: strings.Repeat("가", maxIncidentNameLen), IsPlayer: true},
			{Idx: 11, MinDistM: 0.4},
		},
		Frames: []UploadIncidentFrame{{TMs: 511_340, Cars: [][]float64{car, nil}}},
	}
}

// TestValidateUploadIncidents exercises the incident-clip structural bounds (no
// DB): count caps at Detail level and per-clip index ranges, name rune length,
// frame-array shape and float finiteness. Sender-side clamps enforce the same
// numbers at the source, so any rejection here means a hand-crafted payload.
func TestValidateUploadIncidents(t *testing.T) {
	base := func(clips ...UploadIncident) *UploadRequest {
		return &UploadRequest{
			SourceRaceID: "r1", TrackID: 99, GameFormat: "F1 26", SchemaVersion: 1,
			Laps:   []UploadLap{vlap(1, 88000)},
			Detail: &UploadDetail{Incidents: clips},
		}
	}

	if err := validateUpload(base(validIncidentClip())); err != nil {
		t.Fatalf("valid incident rejected: %v", err)
	}

	// Detail 레벨 개수 상한 (클립 자체는 전부 유효).
	fat := make([]UploadIncident, maxDetailIncidents+1)
	for i := range fat {
		fat[i] = validIncidentClip()
	}
	if err := validateUpload(base(fat...)); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("over-cap incidents err = %v, want ErrBadUpload", err)
	}

	// 클립별 구조 검증: 유효한 클립에서 한 필드씩만 망가뜨려 400을 확인한다.
	reject := func(name string, mutate func(*UploadIncident)) {
		t.Helper()
		clip := validIncidentClip()
		mutate(&clip)
		if err := validateUpload(base(clip)); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("%s: err = %v, want ErrBadUpload", name, err)
		}
	}
	reject("negative session time", func(c *UploadIncident) { c.SessionTimeMs = -1 })
	reject("window start after t0", func(c *UploadIncident) { c.WindowStartMs = c.SessionTimeMs + 1 })
	reject("zero frame interval", func(c *UploadIncident) { c.FrameIntervalMs = 0 })
	reject("lap over cap", func(c *UploadIncident) { c.Lap = maxLapNumber + 1 })
	reject("no collisions", func(c *UploadIncident) { c.Collisions = nil })
	reject("over-cap collisions", func(c *UploadIncident) {
		c.Collisions = make([][2]int, maxIncidentCollisions+1)
		for i := range c.Collisions {
			c.Collisions[i] = [2]int{4, 11}
		}
	})
	reject("collision self-pair", func(c *UploadIncident) { c.Collisions = [][2]int{{4, 4}} })
	reject("collision idx past grid", func(c *UploadIncident) {
		c.Collisions = [][2]int{{4, maxIncidentVehicleIdx + 1}}
	})
	reject("no participants", func(c *UploadIncident) { c.Participants = nil })
	reject("over-cap participants", func(c *UploadIncident) {
		// zero-value 참가자는 개별 검사를 통과하므로 개수 상한만 격리된다.
		c.Participants = make([]UploadIncidentParticipant, maxIncidentParticipants+1)
	})
	reject("participant idx past grid", func(c *UploadIncident) {
		c.Participants[1].Idx = maxIncidentVehicleIdx + 1
	})
	reject("participant name over rune cap", func(c *UploadIncident) {
		c.Participants[0].Name = strings.Repeat("가", maxIncidentNameLen+1)
	})
	reject("negative min distance", func(c *UploadIncident) { c.Participants[1].MinDistM = -0.1 })
	reject("NaN min distance", func(c *UploadIncident) { c.Participants[1].MinDistM = math.NaN() })
	reject("no frames", func(c *UploadIncident) { c.Frames = nil })
	reject("over-cap frames", func(c *UploadIncident) {
		frame := c.Frames[0]
		c.Frames = make([]UploadIncidentFrame, maxIncidentFrames+1)
		for i := range c.Frames {
			c.Frames[i] = frame
		}
	})
	reject("negative frame time", func(c *UploadIncident) { c.Frames[0].TMs = -1 })
	reject("more car columns than participants", func(c *UploadIncident) {
		c.Frames[0].Cars = append(c.Frames[0].Cars, nil)
	})
	reject("car row wrong arity", func(c *UploadIncident) {
		c.Frames[0].Cars[0] = c.Frames[0].Cars[0][:incidentCarFrameValues-1]
	})
	reject("non-finite car value", func(c *UploadIncident) { c.Frames[0].Cars[0][3] = math.Inf(1) })
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

// TestIngestRaceDetailIdempotent verifies the versioned Detail lands in
// platform.race_detail exactly once and a re-upload does not write a second row
// (the Detail INSERT is on the new-race path only).
func TestIngestRaceDetailIdempotent(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	id, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")

	req := UploadRequest{
		SourceRaceID: "rd1", TrackID: 99, TrackName: "X", SessionType: "Race", GameFormat: "F1 26",
		Laps: []UploadLap{vlap(1, 88000), vlap(2, 89000)}, SchemaVersion: 1,
		Detail: &UploadDetail{
			Stints:   []UploadStint{{Compound: "Soft", Laps: 2, StartLap: 1, EndLap: 2, TireWearPct: 40}},
			Dynamics: []UploadDynamic{{LapNum: 1, UndersteerPct: 5.5}},
			Events:   []UploadEvent{{Lap: 1, Category: "penalty", Message: "5s", Severity: "warning"}},
		},
	}
	first, err := store.IngestRace(ctx, id, req)
	if err != nil {
		t.Fatalf("ingest first: %v", err)
	}

	var version int
	var payload string
	if err := store.pool.QueryRow(ctx,
		`SELECT schema_version, payload::text FROM platform.race_detail WHERE race_id=$1`, first.RaceID,
	).Scan(&version, &payload); err != nil {
		t.Fatalf("query race_detail: %v", err)
	}
	if version != 1 {
		t.Fatalf("race_detail.schema_version = %d, want 1", version)
	}
	if !strings.Contains(payload, "understeerPct") || !strings.Contains(payload, "stints") {
		t.Fatalf("race_detail.payload missing rich keys: %s", payload)
	}

	// Re-upload the same source race: idempotent, and no second detail row.
	second, err := store.IngestRace(ctx, id, req)
	if err != nil {
		t.Fatalf("ingest second: %v", err)
	}
	if !second.Duplicate || second.RaceID != first.RaceID {
		t.Fatalf("re-upload not idempotent: %+v", second)
	}
	var n int
	if err := store.pool.QueryRow(ctx,
		`SELECT count(*) FROM platform.race_detail WHERE race_id=$1`, first.RaceID).Scan(&n); err != nil {
		t.Fatalf("count race_detail: %v", err)
	}
	if n != 1 {
		t.Fatalf("race_detail rows = %d, want 1 (no duplicate)", n)
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
