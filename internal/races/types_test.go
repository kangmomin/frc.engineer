package races

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/dto"
)

func TestBuildSummaryIncludesDebrief(t *testing.T) {
	tyreSetWear := 73
	tyreLifeSpan := 24
	tyreUsableLife := 20
	summary := BuildSummary(44, &dto.PitwallState{
		PlayerIndex: 0,
		Session: &dto.SessionInfo{
			TrackID:     5,
			TrackName:   "Silverstone",
			SessionType: "R",
			TotalLaps:   29,
			SafetyCar:   "None",
			Weather:     "Clear",
			AirTemp:     23,
			TrackTemp:   31,
		},
		Drivers: []dto.DriverInfo{
			{
				Index:                      0,
				Name:                       "Player",
				TeamID:                     2,
				Position:                   2,
				CurrentLapNum:              29,
				BestLapTime:                91234,
				LastLapTime:                92500,
				NumPitStops:                1,
				Penalties:                  5,
				TotalWarnings:              2,
				CornerCuttingWarnings:      1,
				NumUnservedDriveThroughs:   0,
				NumUnservedStopGoPenalties: 1,
				TireCompound:               "Medium",
				TireAge:                    12,
				TireWear:                   [4]int{58, 62, 65, 61},
				TyreSetWear:                &tyreSetWear,
				TyreLifeSpan:               &tyreLifeSpan,
				TyreUsableLife:             &tyreUsableLife,
				DeltaToRaceLeader:          2845,
				PitLaneTime:                23120,
				MeasuredPitLaneMs:          23120, // 실측 경로 — PitLaneTimeMS로 전달(업로드 대상)
				MeasuredPitStopMs:          2400,
				StintHistory:               []dto.StintInfoDTO{{Compound: "Soft", Laps: 17}, {Compound: "Medium", Laps: 12}},
			},
			{
				Index:         1,
				Name:          "Winner",
				TeamID:        1,
				Position:      1,
				CurrentLapNum: 29,
				BestLapTime:   90500,
				LastLapTime:   92100,
			},
		},
	}, NotificationCounts{Penalty: 1, Warning: 2, Info: 3}, []dto.RaceControlNotification{
		{ID: "rc-1", Category: "info", Message: "Chequered flag", Severity: "info", Timestamp: 10},
		{ID: "rc-2", Category: "info", Message: "[Winner] Race Winner!", Severity: "info", Timestamp: 11},
	}, nil, time.Date(2026, 4, 12, 15, 4, 5, 0, time.UTC))

	if summary.Debrief == nil {
		t.Fatal("expected debrief to be populated")
	}
	if summary.Debrief.WinnerName != "Winner" {
		t.Fatalf("winner name = %q, want Winner", summary.Debrief.WinnerName)
	}
	if summary.Debrief.GapToWinnerMS != 2845 {
		t.Fatalf("gap = %d, want 2845", summary.Debrief.GapToWinnerMS)
	}
	if summary.Debrief.FastestLapDeltaMS != 734 {
		t.Fatalf("fastest lap delta = %d, want 734", summary.Debrief.FastestLapDeltaMS)
	}
	if summary.Debrief.Pit.PitLaneTimeMS != 23120 {
		t.Fatalf("pit lane time = %d, want 23120", summary.Debrief.Pit.PitLaneTimeMS)
	}
	if summary.Debrief.Pit.StationaryTimeMS != 2400 {
		t.Fatalf("stationary time = %d, want 2400", summary.Debrief.Pit.StationaryTimeMS)
	}
	if summary.Debrief.Tyres.AverageWearPct != 61 {
		t.Fatalf("average wear = %d, want 61", summary.Debrief.Tyres.AverageWearPct)
	}
	if summary.Debrief.Tyres.LifeRemainingPct != 50 {
		t.Fatalf("life remaining = %d, want 50", summary.Debrief.Tyres.LifeRemainingPct)
	}
	if len(summary.Debrief.Timeline) != 2 {
		t.Fatalf("timeline len = %d, want 2", len(summary.Debrief.Timeline))
	}
}

// TestBuildSummaryRichDetail is the rich-path golden: it asserts the version stamp,
// the game-format partition key, the synthesized final (in-progress) stint, the
// per-lap tyre derived from stint ranges, and that the player setup + events flow
// into Detail.
func TestBuildSummaryRichDetail(t *testing.T) {
	state := &dto.PitwallState{
		PlayerIndex: 0,
		GameFormat:  2026,
		Session: &dto.SessionInfo{
			TrackID: 5, TrackName: "Silverstone", SessionType: "R", TotalLaps: 29,
		},
		Drivers: []dto.DriverInfo{
			{
				Index: 0, Name: "Player", Position: 1, CurrentLapNum: 29,
				BestLapTime: 91234, LastLapTime: 92500, NumPitStops: 1,
				TireCompound: "medium", TireAge: 12, TireWear: [4]int{40, 42, 45, 41},
				// One closed Soft stint (laps 1-17), enriched by the StrategyManager.
				StintHistory: []dto.StintInfoDTO{
					{Compound: "soft", Laps: 17, StartLap: 1, EndLap: 17, TireWearPct: 55},
				},
				Dynamics: []dto.DynamicsLapDTO{
					{LapNum: 1, UndersteerPct: 12.5, OversteerPct: 3.2, LockupCount: 1},
					{LapNum: 18, UndersteerPct: 8.1, OversteerPct: 5.5, SpinCount: 1},
				},
			},
		},
	}
	detail := &dto.RaceDetailInput{
		PlayerLaps: []dto.LapTimingDTO{
			{LapNumber: 1, LapMs: 92000, S1Ms: 30000, S2Ms: 31000, S3Ms: 31000, Valid: true},
			{LapNumber: 17, LapMs: 91500, S1Ms: 30000, S2Ms: 30500, S3Ms: 31000, Valid: true},
			{LapNumber: 18, LapMs: 91800, S1Ms: 30000, S2Ms: 30800, S3Ms: 31000, Valid: true},
			{LapNumber: 29, LapMs: 92500, S1Ms: 30000, S2Ms: 31500, S3Ms: 31000, Valid: false},
		},
		PlayerSetup: &dto.CarSetupDTO{FrontWing: 7, RearWing: 9, FuelLoad: 10.5, BrakeBias: 54},
		RichEvents: []dto.RaceControlNotification{
			{ID: "e1", Category: "penalty", Message: "[Player] 5s penalty", Severity: "warning", Lap: 12},
		},
	}

	summary := BuildSummary(44, state, NotificationCounts{Penalty: 1}, nil, detail, time.Date(2026, 4, 12, 15, 4, 5, 0, time.UTC))

	if summary.SchemaVersion != RaceSummarySchemaVersion {
		t.Fatalf("SchemaVersion = %d, want %d", summary.SchemaVersion, RaceSummarySchemaVersion)
	}
	if summary.GameFormat != "F1 26" {
		t.Fatalf("GameFormat = %q, want \"F1 26\"", summary.GameFormat)
	}

	// The last, in-progress Medium stint must be synthesized (StintHistory only
	// closes on a compound change) and continue from the closed Soft stint.
	if n := len(summary.Player.Stints); n != 2 {
		t.Fatalf("player stints = %d, want 2 (closed soft + synthesized medium)", n)
	}
	last := summary.Player.Stints[1]
	if last.Compound != "medium" || last.StartLap != 18 || last.EndLap != 29 || last.Laps != 12 {
		t.Fatalf("synthesized stint = %+v, want medium L18-29 (12 laps)", last)
	}
	if last.TireWearPct != 42 { // rounded mean of {40,42,45,41}
		t.Fatalf("synthesized stint wear = %d, want 42", last.TireWearPct)
	}

	if summary.Detail == nil {
		t.Fatal("Detail must be populated on the rich path")
	}
	if summary.Detail.Setup == nil || summary.Detail.Setup.FrontWing != 7 || summary.Detail.Setup.FuelLoad != 10.5 {
		t.Fatalf("Detail.Setup = %+v, want front wing 7 / fuel 10.5", summary.Detail.Setup)
	}
	if len(summary.Detail.Events) != 1 || summary.Detail.Events[0].Lap != 12 {
		t.Fatalf("Detail.Events = %+v, want the single lap-12 penalty", summary.Detail.Events)
	}
	if len(summary.Detail.Dynamics) != 2 {
		t.Fatalf("Detail.Dynamics len = %d, want 2 (from the player driver)", len(summary.Detail.Dynamics))
	}

	// Per-lap tyre is derived by joining the lap number against the stint ranges.
	wantTyre := map[int]string{1: "Soft", 17: "Soft", 18: "Medium", 29: "Medium"}
	if len(summary.Detail.Laps) != len(detail.PlayerLaps) {
		t.Fatalf("Detail.Laps len = %d, want %d", len(summary.Detail.Laps), len(detail.PlayerLaps))
	}
	for _, l := range summary.Detail.Laps {
		if got := l.Tyre; got != wantTyre[l.LapNumber] {
			t.Fatalf("lap %d tyre = %q, want %q", l.LapNumber, got, wantTyre[l.LapNumber])
		}
	}
}

// worstIncidentClip builds one maximal merged clip — 10 participants × 101
// frames × 20 collisions — with every value at the full post-rounding JSON
// width the recorder emits, so the budget math sees the true worst case.
func worstIncidentClip(t0MS int64) dto.IncidentClip {
	clip := dto.IncidentClip{
		SessionTimeMS:   t0MS,
		WindowStartMS:   t0MS - 1000,
		FrameIntervalMS: 50,
		Lap:             78,
	}
	for i := range 20 {
		clip.Collisions = append(clip.Collisions, [2]int{0, (i % 23) + 1})
	}
	for j := range 10 {
		clip.Participants = append(clip.Participants, dto.IncidentParticipant{
			Idx: j, Name: strings.Repeat("D", 32), IsPlayer: j == 0, MinDistM: 39.97,
		})
	}
	for f := range 101 {
		cars := make([][]float64, 10)
		for j := range cars {
			cars[j] = []float64{
				-2345.67, -102.34, -1987.65, // pos (2dp)
				-88.25, -12.75, -91.5, // vel (2dp)
				-3.142,       // yaw (3dp)
				-4.85, -5.12, // gLat, gLong
				351.75,         // speedKmh
				1, 0.85, -0.75, // throttle, brake, steer
				8, // gear
			}
		}
		clip.Frames = append(clip.Frames, dto.IncidentFrame{TMS: clip.WindowStartMS + int64(f*50), Cars: cars})
	}
	return clip
}

// TestRaceSummarySerializationSizeUnderBudget guards the size double-constraint: a
// worst-case rich summary (broadcast strips Replay and Incidents) must fit the
// Chrome SCTP receive buffer (256KB, DataChannel), and the upload form — summary
// plus TrimIncidentsForUpload output — must fit the platform HTTP cap (512KiB).
// JSON is a conservative upper bound for the msgpack wire form.
func TestRaceSummarySerializationSizeUnderBudget(t *testing.T) {
	const (
		sctpBudget = 256 * 1024
		httpBudget = 512 * 1024
	)
	// Worst-case event message: the emit format is "[driverName] Penalty:
	// Infringement (Ns)" — pad to ~250 bytes to stress the timeline.
	longMsg := "[" + strings.Repeat("D", 40) + "] Penalty: " + strings.Repeat("Infringement ", 15)

	summary := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		SessionUID:    99,
		GameFormat:    "F1 26",
		Track:         TrackInfo{TrackID: 5, TrackName: "Silverstone Grand Prix Circuit"},
		Session:       SessionSummary{SessionType: "Race", TotalLaps: 78},
		Player:        PlayerSummary{Name: strings.Repeat("P", 32), FinalPosition: 1, CompletedLaps: 78},
	}
	// 24-car field (F1 26 Season Pack) each with a couple of stints and long names.
	for i := range 24 {
		summary.Drivers = append(summary.Drivers, DriverSummary{
			DriverIndex: i, Name: fmt.Sprintf("%s-%02d", strings.Repeat("Driver", 4), i),
			Position: i + 1, CompletedLaps: 78,
			Stints: []RaceStint{
				{Compound: "soft", Laps: 25, StartLap: 1, EndLap: 25, TireWearPct: 60},
				{Compound: "hard", Laps: 53, StartLap: 26, EndLap: 78, TireWearPct: 55},
			},
		})
	}
	detail := &RaceDetail{Setup: &dto.CarSetupDTO{FrontWing: 7, FuelLoad: 10.5}}
	for lap := 1; lap <= 78; lap++ {
		detail.Laps = append(detail.Laps, dto.LapTimingDTO{
			LapNumber: lap, LapMs: 91234, S1Ms: 30000, S2Ms: 30500, S3Ms: 30734, Tyre: "Soft", Valid: true,
		})
		detail.Dynamics = append(detail.Dynamics, dto.DynamicsLapDTO{
			LapNum: lap, UndersteerPct: 12.345, OversteerPct: 6.789, LockupCount: 2, SpinCount: 1,
		})
	}
	for i := range 150 {
		detail.Events = append(detail.Events, dto.RaceControlNotification{
			ID: fmt.Sprintf("evt-%03d", i), Category: "penalty", Message: longMsg,
			Severity: "warning", DriverName: strings.Repeat("D", 40), Lap: (i % 78) + 1, Timestamp: 1_700_000_000 + int64(i),
		})
	}
	// The analysis outline is sent with rich detail, not as a separate live
	// payload. Include the full 256-point bound in the same 24-car budget guard.
	detail.TrackOutline = &dto.TrackOutlineDTO{
		Points: make([][2]float64, 0, 256),
		Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 255, MinZ: -255, MaxZ: 0},
	}
	for i := range 256 {
		detail.TrackOutline.Points = append(detail.TrackOutline.Points, [2]float64{float64(i), -float64(i)})
	}
	summary.Detail = detail

	// 브로드캐스트(SCTP) 형태: Incidents nil — 세 strip 지점과 동일 조건.
	data, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(data) >= sctpBudget {
		t.Fatalf("worst-case summary = %d bytes, exceeds SCTP budget %d", len(data), sctpBudget)
	}
	t.Logf("worst-case rich summary JSON = %d bytes (SCTP budget %d)", len(data), sctpBudget)

	// 업로드(HTTP) 형태: 워스트 incidents(20클립 × 10대 × 101프레임, raw ~2MB)를
	// 업로드 경로와 동일하게 트리밍해 부착한다. 트리밍 블록이 자체 예산(300KB)을
	// 지키면 요청 전체도 512KiB 안에 남아야 한다.
	var clips []dto.IncidentClip
	for i := range 20 {
		clips = append(clips, worstIncidentClip(600_000+int64(i)*30_000))
	}
	trimmed, _ := TrimIncidentsForUpload(clips)
	if len(trimmed) == 0 {
		t.Fatal("trimming dropped every clip — budget check vacuous")
	}
	if size := serializedIncidentsSize(trimmed); size > incidentUploadBudgetBytes {
		t.Fatalf("trimmed incidents = %d bytes, exceeds upload budget %d", size, incidentUploadBudgetBytes)
	}
	summary.Incidents = trimmed
	withIncidents, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal with incidents: %v", err)
	}
	if len(withIncidents) >= httpBudget {
		t.Fatalf("summary + trimmed incidents = %d bytes, exceeds HTTP budget %d", len(withIncidents), httpBudget)
	}
	t.Logf("summary + trimmed incidents JSON = %d bytes (HTTP budget %d)", len(withIncidents), httpBudget)
}

func TestDeriveUploadCompletenessV2CountsAndCheckpoint(t *testing.T) {
	trackOutline := &dto.TrackOutlineDTO{
		Points: [][2]float64{{0, 0}, {10, 10}},
		Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 10, MinZ: 0, MaxZ: 10},
	}
	summary := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Player:        PlayerSummary{Stints: []RaceStint{{Compound: "soft", Laps: 1, StartLap: 1, EndLap: 1}}},
		Debrief:       &RaceDebrief{Pit: RacePitSummary{Stops: 0}},
		Detail: &RaceDetail{
			Laps:            []dto.LapTimingDTO{{LapNumber: 1, LapMs: 90_000, S1Ms: 30_000, S2Ms: 30_000, S3Ms: 30_000, Valid: true}},
			Dynamics:        []dto.DynamicsLapDTO{{LapNum: 1}},
			Events:          []dto.RaceControlNotification{{Timestamp: 1, Message: "start"}},
			CaptureStartLap: 1,
			TrackOutline:    trackOutline,
		},
		PrivateCapture: &dto.RacePrivateCapture{Provenance: dto.RaceCaptureProvenance{
			LapDataObserved: true, SessionHistoryObserved: true, CarStatusObserved: true,
			CarDamageObserved: true, TyreSetsObserved: true, EventsCaptureActive: true,
			EventsSeen: 1, IncidentsCaptureActive: true, NormalFinalize: true,
		}},
	}
	completeness := DeriveUploadCompleteness(summary, UploadCompletenessFacts{EventsStored: 1})
	if completeness == nil || completeness.Analysis.Status != dto.AvailabilityComplete {
		t.Fatalf("complete v2 analysis = %+v, want complete", completeness)
	}
	for _, section := range []dto.SectionCompleteness{
		completeness.Sections.Laps, completeness.Sections.Sectors, completeness.Sections.Stints,
		completeness.Sections.Tyres, completeness.Sections.Dynamics, completeness.Sections.Penalties,
		completeness.Sections.Events, completeness.Sections.Pit, completeness.Sections.Incidents,
	} {
		if section.CapturedCount == nil || section.StoredCount == nil || *section.CapturedCount != *section.StoredCount {
			t.Fatalf("section counts = %+v, want equal explicit values", section)
		}
	}
	if got := *completeness.Sections.TrackOutline.StoredCount; got != 2 {
		t.Fatalf("track outline stored count = %d, want 2", got)
	}

	summary.PrivateCapture.Provenance.CheckpointFinalize = true
	checkpoint := DeriveUploadCompleteness(summary, UploadCompletenessFacts{EventsStored: 1})
	if checkpoint.Analysis.Status != dto.AvailabilityPartial || checkpoint.Sections.Laps.Status != dto.AvailabilityPartial ||
		!containsCompletenessReason(checkpoint.Sections.Laps.Reasons, dto.ReasonCheckpointFinalize) {
		t.Fatalf("checkpoint completeness = %+v, want partial with checkpoint reason", checkpoint)
	}

	// The v2 debrief object is always present on the upload wire even when a
	// local summary lacks a player debrief source. Its fixed object-unit counts
	// must stay explicit rather than creating an invalid 0-count v2 request.
	summary.Debrief = nil
	summary.PrivateCapture.Provenance.CheckpointFinalize = false
	withoutLocalDebrief := DeriveUploadCompleteness(summary, UploadCompletenessFacts{EventsStored: 1})
	for _, section := range []dto.SectionCompleteness{
		withoutLocalDebrief.Sections.Tyres, withoutLocalDebrief.Sections.Penalties, withoutLocalDebrief.Sections.Pit,
	} {
		if section.CapturedCount == nil || section.StoredCount == nil || *section.CapturedCount != 1 || *section.StoredCount != 1 {
			t.Fatalf("v2 debrief section count = %+v, want 1/1", section)
		}
	}
}

func TestDeriveUploadCompletenessPreservesOriginalTrackOutlineCount(t *testing.T) {
	points := make([][2]float64, 256)
	for i := range points {
		points[i] = [2]float64{float64(i), -float64(i)}
	}
	summary := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail: &RaceDetail{TrackOutline: &dto.TrackOutlineDTO{
			Points: points,
			Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 255, MinZ: -255, MaxZ: 0},
		}},
		PrivateCapture: &dto.RacePrivateCapture{Provenance: dto.RaceCaptureProvenance{TrackOutlineSourcePoints: 336}},
	}

	section := DeriveUploadCompleteness(summary, UploadCompletenessFacts{}).Sections.TrackOutline
	if section.Status != dto.AvailabilityPartial || section.CapturedCount == nil || section.StoredCount == nil ||
		*section.CapturedCount != 336 || *section.StoredCount != len(points) ||
		!containsCompletenessReason(section.Reasons, dto.ReasonTrackOutlineDownsampled) {
		t.Fatalf("downsampled outline completeness = %+v, want partial 336/%d with reason", section, len(points))
	}
}

func TestDeriveUploadCompletenessDistinguishesMissingDebriefSourcesFromConfirmedZero(t *testing.T) {
	summary := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Debrief:        &RaceDebrief{Pit: RacePitSummary{Stops: 0}},
		Detail:         &RaceDetail{Laps: []dto.LapTimingDTO{{LapNumber: 1, LapMs: 90_000}}},
		PrivateCapture: &dto.RacePrivateCapture{},
	}

	missing := DeriveUploadCompleteness(summary, UploadCompletenessFacts{})
	for name, section := range map[string]dto.SectionCompleteness{
		"tyres":     summarySection(missing, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Tyres }),
		"penalties": summarySection(missing, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Penalties }),
		"pit":       summarySection(missing, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Pit }),
	} {
		if section.Status != dto.AvailabilityUnavailable || section.StoredCount == nil || *section.StoredCount != 1 ||
			!containsCompletenessReason(section.Reasons, dto.ReasonSourceMissing) {
			t.Fatalf("missing %s source = %+v, want unavailable object fact with source-missing", name, section)
		}
	}

	summary.PrivateCapture.Provenance = dto.RaceCaptureProvenance{
		LapDataObserved: true, CarStatusObserved: true, CarDamageObserved: true, TyreSetsObserved: true,
	}
	confirmedZero := DeriveUploadCompleteness(summary, UploadCompletenessFacts{})
	for name, section := range map[string]dto.SectionCompleteness{
		"tyres":     summarySection(confirmedZero, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Tyres }),
		"penalties": summarySection(confirmedZero, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Penalties }),
		"pit":       summarySection(confirmedZero, func(sections dto.DetailSections) dto.SectionCompleteness { return sections.Pit }),
	} {
		if section.Status != dto.AvailabilityComplete {
			t.Fatalf("confirmed-zero %s = %+v, want complete", name, section)
		}
	}

	summary.PrivateCapture.Provenance.CarDamageObserved = false
	partialTyres := DeriveUploadCompleteness(summary, UploadCompletenessFacts{}).Sections.Tyres
	if partialTyres.Status != dto.AvailabilityPartial || !containsCompletenessReason(partialTyres.Reasons, dto.ReasonSourceMissing) {
		t.Fatalf("partially observed tyre sources = %+v, want partial source-missing", partialTyres)
	}
}

func TestDeriveUploadCompletenessUsesExplicitRecorderClipCapFact(t *testing.T) {
	clips := make([]dto.IncidentClip, incidentStoredCap)
	keys := make([]dto.IncidentCaptureKey, incidentStoredCap+1)
	for i := range clips {
		clips[i].SessionTimeMS = int64(i + 1)
		clips[i].Collisions = [][2]int{{0, 1}}
	}
	for i := range keys {
		keys[i].SessionTimeMS = int64(i + 1)
		keys[i].Collisions = [][2]int{{0, 1}}
	}
	newSummary := func(limitReached bool) *RaceSummary {
		return &RaceSummary{
			SchemaVersion: RaceSummarySchemaVersion,
			Detail:        &RaceDetail{},
			PrivateCapture: &dto.RacePrivateCapture{EligibleIncidentKeys: keys, Provenance: dto.RaceCaptureProvenance{
				IncidentsCaptureActive: true, IncidentClipLimitReached: limitReached,
			}},
		}
	}

	trimmed := DeriveUploadCompleteness(newSummary(false), UploadCompletenessFacts{Incidents: clips, DroppedClips: 1}).Sections.Incidents
	if !hasOnlyCompletenessReasons(trimmed.Reasons, dto.ReasonUploadClipsDropped) {
		t.Fatalf("300KiB trim reasons = %v, want only upload-clips-dropped", trimmed.Reasons)
	}
	budget := DeriveUploadCompleteness(newSummary(false), UploadCompletenessFacts{RequestBudgetDropped: true}).Sections.Incidents
	if !hasOnlyCompletenessReasons(budget.Reasons, dto.ReasonRequestBudgetDropped) || budget.Status != dto.AvailabilityUnavailable {
		t.Fatalf("480KiB budget reasons/status = %+v, want unavailable request-budget-dropped only", budget)
	}
	cap := DeriveUploadCompleteness(newSummary(true), UploadCompletenessFacts{Incidents: clips}).Sections.Incidents
	if !hasOnlyCompletenessReasons(cap.Reasons, dto.ReasonIncidentClipLimit) {
		t.Fatalf("recorder cap reasons = %v, want only incident-clip-limit", cap.Reasons)
	}
	localLoss := DeriveUploadCompleteness(newSummary(false), UploadCompletenessFacts{Incidents: clips}).Sections.Incidents
	if !hasOnlyCompletenessReasons(localLoss.Reasons, dto.ReasonSourceMissing) || localLoss.Status != dto.AvailabilityPartial {
		t.Fatalf("unexplained local clip loss = %+v, want partial source-missing", localLoss)
	}
	noStoredClip := DeriveUploadCompleteness(newSummary(false), UploadCompletenessFacts{}).Sections.Incidents
	if !hasOnlyCompletenessReasons(noStoredClip.Reasons, dto.ReasonSourceMissing) || noStoredClip.Status != dto.AvailabilityUnavailable {
		t.Fatalf("unexplained zero-stored clip loss = %+v, want unavailable source-missing", noStoredClip)
	}
}

func TestDeriveUploadCompletenessDoesNotMarkUnexplainedEventCountLossComplete(t *testing.T) {
	summary := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{Events: []dto.RaceControlNotification{{Timestamp: 1, Message: "kept"}}},
		PrivateCapture: &dto.RacePrivateCapture{Provenance: dto.RaceCaptureProvenance{
			EventsCaptureActive: true, EventsSeen: 2,
		}},
	}
	section := DeriveUploadCompleteness(summary, UploadCompletenessFacts{EventsStored: 1}).Sections.Events
	if section.Status != dto.AvailabilityPartial || !hasOnlyCompletenessReasons(section.Reasons, dto.ReasonSourceMissing) {
		t.Fatalf("unexplained event count loss = %+v, want partial source-missing", section)
	}
}

func TestAggregateCompletenessTruthTable(t *testing.T) {
	section := func(status dto.Availability) dto.SectionCompleteness { return dto.SectionCompleteness{Status: status} }
	all := func(status dto.Availability) []dto.SectionCompleteness {
		return []dto.SectionCompleteness{section(status), section(status), section(status)}
	}
	for name, testCase := range map[string]struct {
		sections []dto.SectionCompleteness
		want     dto.Availability
	}{
		"all complete":    {all(dto.AvailabilityComplete), dto.AvailabilityComplete},
		"all unknown":     {all(dto.AvailabilityUnknown), dto.AvailabilityUnknown},
		"all unavailable": {all(dto.AvailabilityUnavailable), dto.AvailabilityUnavailable},
		"mixed":           {[]dto.SectionCompleteness{section(dto.AvailabilityComplete), section(dto.AvailabilityUnknown)}, dto.AvailabilityPartial},
	} {
		t.Run(name, func(t *testing.T) {
			if got := aggregateCompleteness(testCase.sections); got.Status != testCase.want {
				t.Fatalf("aggregate status = %q, want %q", got.Status, testCase.want)
			}
		})
	}
}

func summarySection(completeness *dto.RaceDetailCompleteness, selectSection func(dto.DetailSections) dto.SectionCompleteness) dto.SectionCompleteness {
	if completeness == nil {
		return dto.SectionCompleteness{}
	}
	return selectSection(completeness.Sections)
}

func containsCompletenessReason(reasons []dto.CompletenessReason, wanted dto.CompletenessReason) bool {
	for _, reason := range reasons {
		if reason == wanted {
			return true
		}
	}
	return false
}

func hasOnlyCompletenessReasons(got []dto.CompletenessReason, want ...dto.CompletenessReason) bool {
	if len(got) != len(want) {
		return false
	}
	for _, reason := range want {
		if !containsCompletenessReason(got, reason) {
			return false
		}
	}
	return true
}
