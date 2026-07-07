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

// TestRaceSummarySerializationSizeUnderBudget guards the size double-constraint: a
// worst-case rich summary (broadcast strips Replay) must fit both the Chrome SCTP
// receive buffer (256KB, DataChannel) and the platform HTTP cap (512KiB). JSON is a
// conservative upper bound for the msgpack wire form, so JSON < 256KB proves both.
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
	summary.Detail = detail

	data, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(data) >= sctpBudget {
		t.Fatalf("worst-case summary = %d bytes, exceeds SCTP budget %d", len(data), sctpBudget)
	}
	if len(data) >= httpBudget {
		t.Fatalf("worst-case summary = %d bytes, exceeds HTTP budget %d", len(data), httpBudget)
	}
	t.Logf("worst-case rich summary JSON = %d bytes (SCTP budget %d, HTTP budget %d)", len(data), sctpBudget, httpBudget)
}
