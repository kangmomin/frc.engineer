package races

import (
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
	}, time.Date(2026, 4, 12, 15, 4, 5, 0, time.UTC))

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
