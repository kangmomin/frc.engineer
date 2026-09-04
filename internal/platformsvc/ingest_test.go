package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/dto"
)

func readRaceAnalysisV2Fixture(t *testing.T) ([]byte, UploadRequest) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "race_analysis_v2.json"))
	if err != nil {
		t.Fatalf("read v2 fixture: %v", err)
	}
	var request UploadRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatalf("decode v2 fixture: %v", err)
	}
	return raw, request
}

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

func TestValidateUploadV2GoldenContract(t *testing.T) {
	raw, request := readRaceAnalysisV2Fixture(t)
	if err := validateUpload(&request); err != nil {
		t.Fatalf("golden v2 request rejected: %v", err)
	}
	if request.Detail == nil || len(request.Detail.Incidents) != 1 {
		t.Fatalf("golden detail = %+v, want one incident", request.Detail)
	}
	participants := request.Detail.Incidents[0].Participants
	if len(participants) != 2 || participants[0].TeamID == nil || *participants[0].TeamID != 0 ||
		participants[1].TeamID == nil || *participants[1].TeamID != 255 {
		t.Fatalf("required nullable team ids lost 0/255: %+v", participants)
	}
	if got := request.Detail.Incidents[0].Frames[0].TelemetryUnavailable; got == nil || len(got) != 0 {
		t.Fatalf("fresh v2 telemetry marker = %#v, want explicit []", got)
	}

	decode := func(t *testing.T, body []byte) UploadRequest {
		t.Helper()
		var got UploadRequest
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("decode mutation: %v", err)
		}
		return got
	}
	rejectJSON := func(name string, body []byte) {
		t.Helper()
		mutated := decode(t, body)
		if err := validateUpload(&mutated); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("%s: validateUpload = %v, want ErrBadUpload", name, err)
		}
	}

	// Omission is distinct from explicit null on the v2 wire. A source that did
	// not have identity may send null, but it may not silently omit the field.
	rejectJSON("missing teamId", []byte(strings.Replace(string(raw), `"teamId": 0, `, "", 1)))
	nullTeam := decode(t, []byte(strings.Replace(string(raw), `"teamId": 255`, `"teamId": null`, 1)))
	if err := validateUpload(&nullTeam); err != nil {
		t.Fatalf("explicit null teamId rejected: %v", err)
	}
	rejectJSON("missing telemetryUnavailable", []byte(strings.Replace(string(raw), `"telemetryUnavailable"`, `"telemetryUnavailableOmitted"`, 1)))
	rejectJSON("duplicate frame timestamp", []byte(strings.Replace(string(raw), `"tMs": 50`, `"tMs": 0`, 1)))
	rejectJSON("missing aggregate count key", []byte(strings.Replace(string(raw), `"capturedCount": null`, `"capturedCountOmitted": null`, 1)))
	rejectJSON("missing debrief tyre key", []byte(strings.Replace(string(raw), `"lifeSpan": null`, `"lifeSpanOmitted": null`, 1)))
	rejectJSON("missing incident completeness key", []byte(strings.Replace(string(raw), `"storedFrameCount": 2`, `"storedFrameCountOmitted": 2`, 1)))
	rejectJSON("missing outline bounds key", []byte(strings.Replace(string(raw), `"maxX": 10, `, `"maxXOmitted": 10, `, 1)))

	badTuple := request
	badTuple.Detail = cloneUploadDetailForTest(request.Detail)
	badTuple.Detail.Incidents[0].Frames[0].Cars[0][10] = 1.01
	if err := validateUpload(&badTuple); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("out-of-range throttle = %v, want ErrBadUpload", err)
	}

	badOutline := request
	badOutline.Detail = cloneUploadDetailForTest(request.Detail)
	badOutline.Detail.TrackOutline.Bounds.MaxX = 5
	if err := validateUpload(&badOutline); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("outline bound excluding point = %v, want ErrBadUpload", err)
	}

	badCounts := request
	badCounts.Detail = cloneUploadDetailForTest(request.Detail)
	*badCounts.Detail.Completeness.Sections.Events.StoredCount = 2
	if err := validateUpload(&badCounts); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("event count mismatch = %v, want ErrBadUpload", err)
	}

	badFreshness := request
	badFreshness.Detail = cloneUploadDetailForTest(request.Detail)
	badFreshness.Detail.Incidents[0].Frames[0].Cars[0] = nil
	badFreshness.Detail.Incidents[0].Frames[0].TelemetryUnavailable = []int{0}
	if err := validateUpload(&badFreshness); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("freshness marker without a car position = %v, want ErrBadUpload", err)
	}

	badAggregate := request
	badAggregate.Detail = cloneUploadDetailForTest(request.Detail)
	badAggregate.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&badAggregate); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("inconsistent aggregate status = %v, want ErrBadUpload", err)
	}

	badCompleteSection := request
	badCompleteSection.Detail = cloneUploadDetailForTest(request.Detail)
	*badCompleteSection.Detail.Completeness.Sections.Events.CapturedCount = 2
	if err := validateUpload(&badCompleteSection); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("complete section with count loss = %v, want ErrBadUpload", err)
	}

	_, countedFixture := readRaceAnalysisV2Fixture(t)
	countedFixture.Detail = cloneUploadDetailForTest(countedFixture.Detail)
	*countedFixture.Detail.Incidents[0].Completeness.CapturedFrameCount = 3
	if err := validateUpload(&countedFixture); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("complete incident with frame loss = %v, want ErrBadUpload", err)
	}

	_, reasonFixture := readRaceAnalysisV2Fixture(t)
	reasonFixture.Detail = cloneUploadDetailForTest(reasonFixture.Detail)
	reasonFixture.Detail.Incidents[0].Completeness.Reasons = []string{string(dto.ReasonSourceMissing)}
	if err := validateUpload(&reasonFixture); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("complete incident with loss reason = %v, want ErrBadUpload", err)
	}

	_, partialFixture := readRaceAnalysisV2Fixture(t)
	partialFixture.Detail = cloneUploadDetailForTest(partialFixture.Detail)
	partialFixture.Detail.Incidents[0].Completeness.Status = string(dto.AvailabilityPartial)
	partialFixture.Detail.Completeness.Sections.Incidents.Status = string(dto.AvailabilityPartial)
	partialFixture.Detail.Completeness.Sections.Incidents.Reasons = []string{string(dto.ReasonSourceMissing)}
	partialFixture.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&partialFixture); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("partial incident without loss evidence = %v, want ErrBadUpload", err)
	}

	_, unavailableFixture := readRaceAnalysisV2Fixture(t)
	unavailableFixture.Detail = cloneUploadDetailForTest(unavailableFixture.Detail)
	unavailableFixture.Detail.Incidents[0].Completeness.Status = string(dto.AvailabilityUnavailable)
	unavailableFixture.Detail.Completeness.Sections.Incidents.Status = string(dto.AvailabilityPartial)
	unavailableFixture.Detail.Completeness.Sections.Incidents.Reasons = []string{string(dto.ReasonSourceMissing)}
	unavailableFixture.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&unavailableFixture); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unavailable incident with stored frames = %v, want ErrBadUpload", err)
	}

	_, unknownFixture := readRaceAnalysisV2Fixture(t)
	unknownFixture.Detail = cloneUploadDetailForTest(unknownFixture.Detail)
	unknownFixture.Detail.Incidents[0].Completeness.Status = string(dto.AvailabilityUnknown)
	unknownFixture.Detail.Completeness.Sections.Incidents.Status = string(dto.AvailabilityPartial)
	unknownFixture.Detail.Completeness.Sections.Incidents.Reasons = []string{string(dto.ReasonSourceMissing)}
	unknownFixture.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&unknownFixture); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unknown incident with stored frames = %v, want ErrBadUpload", err)
	}

	_, unavailableEvent := readRaceAnalysisV2Fixture(t)
	unavailableEvent.Detail = cloneUploadDetailForTest(unavailableEvent.Detail)
	unavailableEvent.Detail.Completeness.Sections.Events.Status = string(dto.AvailabilityUnavailable)
	unavailableEvent.Detail.Completeness.Sections.Events.Reasons = []string{string(dto.ReasonSourceMissing)}
	unavailableEvent.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&unavailableEvent); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unavailable events with stored facts = %v, want ErrBadUpload", err)
	}

	_, unavailableIncidents := readRaceAnalysisV2Fixture(t)
	unavailableIncidents.Detail = cloneUploadDetailForTest(unavailableIncidents.Detail)
	unavailableIncidents.Detail.Completeness.Sections.Incidents.Status = string(dto.AvailabilityUnavailable)
	unavailableIncidents.Detail.Completeness.Sections.Incidents.Reasons = []string{string(dto.ReasonSourceMissing)}
	unavailableIncidents.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&unavailableIncidents); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unavailable incidents with stored facts = %v, want ErrBadUpload", err)
	}

	_, unavailablePlaceholder := readRaceAnalysisV2Fixture(t)
	unavailablePlaceholder.Detail = cloneUploadDetailForTest(unavailablePlaceholder.Detail)
	unavailablePlaceholder.Detail.Completeness.Sections.Penalties.Status = string(dto.AvailabilityUnavailable)
	unavailablePlaceholder.Detail.Completeness.Sections.Penalties.Reasons = []string{string(dto.ReasonSourceMissing)}
	unavailablePlaceholder.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	if err := validateUpload(&unavailablePlaceholder); err != nil {
		t.Fatalf("intentional unavailable debrief placeholder rejected: %v", err)
	}
}

func TestValidateUploadV2CompletenessRejectsUnknownAndUntruthfulOutline(t *testing.T) {
	reject := func(t *testing.T, name string, mutate func(*UploadRequest)) {
		t.Helper()
		_, request := readRaceAnalysisV2Fixture(t)
		request.Detail = cloneUploadDetailForTest(request.Detail)
		mutate(&request)
		if err := validateUpload(&request); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("%s: validateUpload = %v, want ErrBadUpload", name, err)
		}
	}

	// Unknown is a read-normalization state only. A supported v2 producer must
	// state a concrete availability for every completeness object.
	for _, test := range []struct {
		name              string
		section           func(*UploadCompletenessSections) *UploadSectionCompleteness
		aggregateExpected string
	}{
		{"laps", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Laps }, string(dto.AvailabilityPartial)},
		{"sectors", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Sectors }, string(dto.AvailabilityPartial)},
		{"stints", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Stints }, string(dto.AvailabilityPartial)},
		{"tyres", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Tyres }, string(dto.AvailabilityPartial)},
		{"dynamics", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Dynamics }, string(dto.AvailabilityPartial)},
		{"penalties", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Penalties }, string(dto.AvailabilityPartial)},
		{"events", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Events }, string(dto.AvailabilityPartial)},
		{"pit", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Pit }, string(dto.AvailabilityPartial)},
		{"track outline", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.TrackOutline }, string(dto.AvailabilityComplete)},
		{"incidents", func(s *UploadCompletenessSections) *UploadSectionCompleteness { return &s.Incidents }, string(dto.AvailabilityPartial)},
	} {
		t.Run("unknown "+test.name, func(t *testing.T) {
			reject(t, test.name, func(request *UploadRequest) {
				section := test.section(&request.Detail.Completeness.Sections)
				section.Status = string(dto.AvailabilityUnknown)
				request.Detail.Completeness.Analysis.Status = test.aggregateExpected
			})
		})
	}

	// The aggregate itself can otherwise truthfully resolve to unknown when all
	// core sections are unknown, so exercise that distinct v2 rejection path.
	reject(t, "unknown aggregate", func(request *UploadRequest) {
		for _, section := range []*UploadSectionCompleteness{
			&request.Detail.Completeness.Sections.Laps,
			&request.Detail.Completeness.Sections.Sectors,
			&request.Detail.Completeness.Sections.Stints,
			&request.Detail.Completeness.Sections.Tyres,
			&request.Detail.Completeness.Sections.Dynamics,
			&request.Detail.Completeness.Sections.Penalties,
			&request.Detail.Completeness.Sections.Events,
			&request.Detail.Completeness.Sections.Pit,
			&request.Detail.Completeness.Sections.Incidents,
		} {
			section.Status = string(dto.AvailabilityUnknown)
		}
		request.Detail.Completeness.Analysis.Status = string(dto.AvailabilityUnknown)
	})

	// An omitted optional outline has one precise unavailable shape.
	reject(t, "absent outline marked complete", func(request *UploadRequest) {
		request.Detail.TrackOutline = nil
	})
	reject(t, "absent outline with nonzero captured count", func(request *UploadRequest) {
		request.Detail.TrackOutline = nil
		section := &request.Detail.Completeness.Sections.TrackOutline
		section.Status = string(dto.AvailabilityUnavailable)
		section.Reasons = []string{string(dto.ReasonTrackOutlineUnavailable)}
		*section.CapturedCount = 1
		*section.StoredCount = 0
	})
	reject(t, "absent outline without unavailable reason", func(request *UploadRequest) {
		request.Detail.TrackOutline = nil
		section := &request.Detail.Completeness.Sections.TrackOutline
		section.Status = string(dto.AvailabilityUnavailable)
		section.Reasons = []string{string(dto.ReasonSourceMissing)}
		*section.CapturedCount = 0
		*section.StoredCount = 0
	})
	reject(t, "present outline marked unknown", func(request *UploadRequest) {
		request.Detail.Completeness.Sections.TrackOutline.Status = string(dto.AvailabilityUnknown)
	})
	reject(t, "partial outline without downsample evidence", func(request *UploadRequest) {
		section := &request.Detail.Completeness.Sections.TrackOutline
		section.Status = string(dto.AvailabilityPartial)
		section.Reasons = []string{string(dto.ReasonSourceMissing)}
		*section.CapturedCount = 3
	})
	reject(t, "partial outline without count loss", func(request *UploadRequest) {
		section := &request.Detail.Completeness.Sections.TrackOutline
		section.Status = string(dto.AvailabilityPartial)
		section.Reasons = []string{string(dto.ReasonTrackOutlineDownsampled)}
	})

	// A no-data array must explain why it is unavailable; otherwise the producer
	// has silently converted a potentially meaningful absence into a fact.
	reject(t, "unavailable event array without reason", func(request *UploadRequest) {
		request.Detail.Events = nil
		section := &request.Detail.Completeness.Sections.Events
		section.Status = string(dto.AvailabilityUnavailable)
		section.Reasons = []string{}
		*section.CapturedCount = 0
		*section.StoredCount = 0
		request.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	})

	// The positive boundary: source points lost to the <=256 cap are represented
	// by captured>stored plus the frozen downsample reason.
	_, downsampled := readRaceAnalysisV2Fixture(t)
	downsampled.Detail = cloneUploadDetailForTest(downsampled.Detail)
	section := &downsampled.Detail.Completeness.Sections.TrackOutline
	section.Status = string(dto.AvailabilityPartial)
	section.Reasons = []string{string(dto.ReasonTrackOutlineDownsampled)}
	*section.CapturedCount = 3
	if err := validateUpload(&downsampled); err != nil {
		t.Fatalf("truthful downsampled outline rejected: %v", err)
	}
}

func TestValidateUploadV2PitCoPresence(t *testing.T) {
	_, request := readRaceAnalysisV2Fixture(t)
	lane, stationary := uint32(12_000), uint32(2_000)
	request.Detail.Debrief.Pit.Stops = 1
	request.Detail.Debrief.Pit.PitLaneTimeMs = &lane
	request.Detail.Debrief.Pit.StationaryTimeMs = &stationary
	request.Pit = &UploadPit{Stops: 1, PitLaneTimeMs: lane, StationaryMs: stationary}
	if err := validateUpload(&request); err != nil {
		t.Fatalf("matching measured pit facts rejected: %v", err)
	}
	badMeasuredCompleteness := request
	badMeasuredCompleteness.Detail = cloneUploadDetailForTest(request.Detail)
	badMeasuredCompleteness.Detail.Completeness.Sections.Pit.Status = string(dto.AvailabilityUnavailable)
	if err := validateUpload(&badMeasuredCompleteness); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("measured pit marked unavailable = %v, want ErrBadUpload", err)
	}

	request.Pit.StationaryMs++
	if err := validateUpload(&request); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("mismatched top-level pit = %v, want ErrBadUpload", err)
	}

	request.Pit = nil
	if err := validateUpload(&request); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("missing top-level measured pit = %v, want ErrBadUpload", err)
	}

	_, missingMeasurement := readRaceAnalysisV2Fixture(t)
	missingMeasurement.Detail.Debrief.Pit.Stops = 1
	if err := validateUpload(&missingMeasurement); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("known stop without partial pit completeness = %v, want ErrBadUpload", err)
	}
}

func TestValidateUploadV2MeasuredPitRequiresAllWireFields(t *testing.T) {
	raw, _ := readRaceAnalysisV2Fixture(t)
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	detail := body["detail"].(map[string]any)
	debrief := detail["debrief"].(map[string]any)
	debriefPit := debrief["pit"].(map[string]any)
	debriefPit["stops"] = 1
	debriefPit["pitLaneTimeMs"] = 12_000
	debriefPit["stationaryTimeMs"] = 0
	body["pit"] = map[string]any{"stops": 1, "pitLaneTimeMs": 12_000, "stationaryMs": 0}

	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode measured pit: %v", err)
	}
	var matching UploadRequest
	if err := json.Unmarshal(encoded, &matching); err != nil {
		t.Fatalf("decode measured pit: %v", err)
	}
	if err := validateUpload(&matching); err != nil {
		t.Fatalf("matching measured pit rejected: %v", err)
	}

	body["pit"].(map[string]any)["stationaryMs"] = nil
	encoded, err = json.Marshal(body)
	if err != nil {
		t.Fatalf("encode null stationary: %v", err)
	}
	var nullStationary UploadRequest
	if err := json.Unmarshal(encoded, &nullStationary); err != nil {
		t.Fatalf("decode null stationary: %v", err)
	}
	if err := validateUpload(&nullStationary); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("null top-level stationary measurement = %v, want ErrBadUpload", err)
	}

	delete(body["pit"].(map[string]any), "stationaryMs")
	encoded, err = json.Marshal(body)
	if err != nil {
		t.Fatalf("encode missing stationary: %v", err)
	}
	var missingStationary UploadRequest
	if err := json.Unmarshal(encoded, &missingStationary); err != nil {
		t.Fatalf("decode missing stationary: %v", err)
	}
	if err := validateUpload(&missingStationary); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("missing top-level stationary measurement = %v, want ErrBadUpload", err)
	}
}

// cloneUploadDetailForTest copies the few nested fields mutators touch while
// preserving the JSON presence bits established by the golden fixture decode.
func cloneUploadDetailForTest(source *UploadDetail) *UploadDetail {
	copyDetail := *source
	copyDetail.Incidents = append([]UploadIncident(nil), source.Incidents...)
	for i := range copyDetail.Incidents {
		copyIncident := copyDetail.Incidents[i]
		copyIncident.Participants = append([]UploadIncidentParticipant(nil), source.Incidents[i].Participants...)
		copyIncident.Frames = append([]UploadIncidentFrame(nil), source.Incidents[i].Frames...)
		for frameIndex := range copyIncident.Frames {
			copyIncident.Frames[frameIndex].Cars = append([][]float64(nil), source.Incidents[i].Frames[frameIndex].Cars...)
			for carIndex := range copyIncident.Frames[frameIndex].Cars {
				copyIncident.Frames[frameIndex].Cars[carIndex] = append([]float64(nil), source.Incidents[i].Frames[frameIndex].Cars[carIndex]...)
			}
		}
		copyDetail.Incidents[i] = copyIncident
	}
	if source.TrackOutline != nil {
		outline := *source.TrackOutline
		outline.Points = append([][2]float64(nil), source.TrackOutline.Points...)
		copyDetail.TrackOutline = &outline
	}
	if source.Completeness != nil {
		completeness := *source.Completeness
		copyDetail.Completeness = &completeness
	}
	return &copyDetail
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

func TestIngestStoresMySetupRaceFields(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	accountID, _ := store.UpsertSteamAccount(ctx, steamA, "P", "")
	recordedAt := time.Date(2026, time.September, 4, 19, 23, 45, 0, time.FixedZone("KST", 9*60*60))
	finishPosition := 24 // F1 26's 24-car grid is valid.

	res, err := store.IngestRace(ctx, accountID, UploadRequest{
		SourceRaceID: "my-setup-fields", TrackID: 99, TrackName: "Monza",
		SessionType: "Race 3", GameFormat: "F1 26", Laps: []UploadLap{vlap(1, 88000), vlap(2, 89000)},
		RecordedAt: &recordedAt, FinishPosition: &finishPosition,
		Detail: &UploadDetail{FinalizeTrigger: "SEND"}, SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("IngestRace: %v", err)
	}
	var gotRecordedAt *time.Time
	var gotFinish, gotLaps *int
	if err := store.pool.QueryRow(ctx, `
		SELECT recorded_at, finish_position, completed_laps
		FROM platform.races WHERE id = $1`, res.RaceID,
	).Scan(&gotRecordedAt, &gotFinish, &gotLaps); err != nil {
		t.Fatalf("query stored fields: %v", err)
	}
	if gotRecordedAt == nil || !gotRecordedAt.Equal(recordedAt) || gotFinish == nil || *gotFinish != 24 || gotLaps == nil || *gotLaps != 2 {
		t.Fatalf("stored fields = %v/%v/%v, want %v/24/2", gotRecordedAt, gotFinish, gotLaps, recordedAt)
	}

	for _, tc := range []struct {
		name string
		req  UploadRequest
	}{
		{
			name: "finish without SEND",
			req:  UploadRequest{SourceRaceID: "bad-no-send", TrackID: 99, SessionType: "Race", Laps: []UploadLap{vlap(1, 88000)}, FinishPosition: &finishPosition},
		},
		{
			name: "finish on non-race session",
			req:  UploadRequest{SourceRaceID: "bad-session", TrackID: 99, SessionType: "Time Trial", Laps: []UploadLap{vlap(1, 88000)}, FinishPosition: &finishPosition, Detail: &UploadDetail{FinalizeTrigger: "SEND"}, SchemaVersion: 1},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := store.IngestRace(ctx, accountID, tc.req); !errors.Is(err, ErrBadUpload) {
				t.Fatalf("IngestRace err = %v, want ErrBadUpload", err)
			}
		})
	}
}

func TestValidateUploadAcceptsZeroRFC3339RecordedAt(t *testing.T) {
	var req UploadRequest
	if err := json.Unmarshal([]byte(`{"recordedAt":"0001-01-01T00:00:00Z"}`), &req); err != nil {
		t.Fatalf("decode zero RFC3339 recordedAt: %v", err)
	}
	if req.RecordedAt == nil || !req.RecordedAt.IsZero() {
		t.Fatalf("decoded recordedAt = %v, want non-nil zero time", req.RecordedAt)
	}
	req.SourceRaceID = "zero-rfc3339-recorded-at"
	req.TrackID = 99
	req.GameFormat = "F1 26"
	req.SessionType = "Race"
	req.Laps = []UploadLap{vlap(1, 88000)}
	if err := validateUpload(&req); err != nil {
		t.Fatalf("validateUpload zero RFC3339 recordedAt: %v", err)
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
