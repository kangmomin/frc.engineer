package strategydata

import "testing"

func TestNormalizeTrackParsesMixedFormats(t *testing.T) {
	raw := &RawTrackFile{
		Track: "bahrain",
		TrackInfo: RawTrackInfo{
			LapCount:      57.0,
			Laps50Pct:     29,
			CircuitLength: "5.412 km",
			LapRecord:     "1:31.447",
			DRSZones:      3,
			PolePosition:  "Left Side",
			PitLimit:      "80kph / 49mph",
		},
		TyreStrategy: RawTyreStrategy{
			Compounds: map[string]string{
				"soft":   "C3",
				"medium": "C2",
				"hard":   "C1",
			},
			WearPerLap: map[string]RawValueDescription{
				"soft": {Value: "3.5-4.5%", Description: "wear"},
			},
			TyreLife50Pct: map[string]RawLapsDescription{
				"soft": {Laps: 11, Description: "life"},
			},
		},
		QualiStrategy: RawQualiStrategy{
			FuelAmount:        RawValueDescription{Value: "5kg"},
			OutlapTime:        RawValueDescription{Value: "2:30"},
			StartingTyreTemps: RawValueDescription{Value: "85°C"},
			EnableERS:         RawValueDescription{Value: "Before Turn 13"},
		},
		RaceStrategy: RawRaceStrategy{
			Laps50Pct:         29,
			StartingFuel50Pct: &RawValueDescription{Value: "55.0kg"},
			PlanA:             &RawRacePlan{Tyres: []string{"medium", "hard"}, PitWindow: "Lap 12-14 & 20-22", Description: "fastest"},
			PitStopTimeLost:   &RawValueDescription{Value: "18.9 Seconds"},
			Notes:             "test note",
		},
		SetupTypeDescriptions: map[string]string{
			"safe":         "Stable setup",
			"intermediate": "",
		},
		Setups: RawSetups{
			Dry: []RawSetup{
				{
					Name:                    "Safe Race Setup",
					ID:                      "safe-race-setup",
					FrontWing:               10,
					RearWing:                5,
					OnThrottleDifferential:  90,
					OffThrottleDifferential: 30,
					FrontCamber:             -3.5,
					RearCamber:              -2,
					FrontToe:                0,
					RearToe:                 0.1,
					FrontSuspension:         41,
					RearSuspension:          1,
					FrontAntiRollBar:        1,
					RearAntiRollBar:         1,
					FrontRideHeight:         22,
					RearRideHeight:          42,
					BrakeBias:               54,
					BrakePressure:           100,
					FrontRightPressure:      29.5,
					FrontLeftPressure:       29.5,
					RearRightPressure:       26.5,
					RearLeftPressure:        26.5,
					Updated:                 stringPtr("20/09/2025"),
					Notes:                   nil,
				},
			},
		},
		ERSGuide:    RawERSGuide{TrackMapURL: "https://example.com/map.svg"},
		HotlapVideo: "https://youtu.be/example",
		ScrapedAt:   "2026-03-21T03:50:17.905655+00:00",
		URL:         "https://example.com/bahrain",
	}

	normalized, err := NormalizeTrack(raw)
	if err != nil {
		t.Fatalf("NormalizeTrack returned error: %v", err)
	}

	if normalized.TrackInfo.CircuitLengthKM != 5.412 {
		t.Fatalf("circuit_length_km = %.3f, want 5.412", normalized.TrackInfo.CircuitLengthKM)
	}
	if normalized.TyreStrategy.WearPerLap["soft"].MaxPct != 4.5 {
		t.Fatalf("wear_per_lap.soft.max_pct = %.1f, want 4.5", normalized.TyreStrategy.WearPerLap["soft"].MaxPct)
	}
	if normalized.TrackInfo.LapRecordMS != 91447 {
		t.Fatalf("lap_record_ms = %d, want 91447", normalized.TrackInfo.LapRecordMS)
	}
	if normalized.TrackInfo.PitLimitKPH != 80 || normalized.TrackInfo.PitLimitMPH != 49 {
		t.Fatalf("pit limit = %d/%d, want 80/49", normalized.TrackInfo.PitLimitKPH, normalized.TrackInfo.PitLimitMPH)
	}
	if normalized.QualiStrategy == nil || normalized.QualiStrategy.EnableERSTurn != 13 {
		t.Fatalf("enable_ers_turn = %+v, want 13", normalized.QualiStrategy)
	}
	if normalized.RaceStrategy == nil || normalized.RaceStrategy.PitStopTimeLostS != 18.9 {
		t.Fatalf("pit_stop_time_lost_s = %+v, want 18.9", normalized.RaceStrategy)
	}
	if normalized.RaceStrategy == nil || len(normalized.RaceStrategy.PlanA.PitWindows) != 2 {
		t.Fatalf("pit windows = %+v, want 2 ranges", normalized.RaceStrategy)
	}
	if normalized.SetupTypeDescriptions["intermediate"] != nil {
		t.Fatal("blank setup description should normalize to nil")
	}
	if normalized.Setups.Dry[0].UpdatedDate == nil || *normalized.Setups.Dry[0].UpdatedDate != "2025-09-20" {
		t.Fatalf("updated_date = %+v, want 2025-09-20", normalized.Setups.Dry[0].UpdatedDate)
	}
}

func TestNormalizeTrackHandlesMissingRaceStrategy(t *testing.T) {
	raw := &RawTrackFile{
		Track: "australia",
		TrackInfo: RawTrackInfo{
			LapCount:      "N/A",
			Laps50Pct:     29,
			CircuitLength: "5.278km",
			LapRecord:     "1:19.813",
			DRSZones:      4,
			PolePosition:  "Left Side",
			PitLimit:      "80kph / 49mph",
		},
		TyreStrategy: RawTyreStrategy{
			Compounds: map[string]string{
				"soft":   "C5",
				"medium": "C4",
				"hard":   "C3",
			},
			WearPerLap: map[string]RawValueDescription{
				"soft": {Value: "7-8%"},
			},
			TyreLife50Pct: map[string]RawLapsDescription{
				"soft": {Laps: 11},
			},
		},
	}

	normalized, err := NormalizeTrack(raw)
	if err != nil {
		t.Fatalf("NormalizeTrack returned error: %v", err)
	}
	if normalized.TrackInfo.LapCount != nil {
		t.Fatalf("lap_count = %+v, want nil", normalized.TrackInfo.LapCount)
	}
	if normalized.RaceStrategy == nil || normalized.RaceStrategy.Available {
		t.Fatalf("race_strategy = %+v, want unavailable", normalized.RaceStrategy)
	}
}

func TestNormalizeTyreTemps(t *testing.T) {
	raw := RawTyreTempDataset{
		"C5": {
			{Temp: "70°C", Grip: "100%", Zone: "peak"},
			{Temp: "80°C", Grip: "100%", Zone: "peak"},
			{Temp: "90°C", Grip: "99.8%", Zone: "near_peak"},
		},
	}

	normalized, err := NormalizeTyreTemps(raw)
	if err != nil {
		t.Fatalf("NormalizeTyreTemps returned error: %v", err)
	}
	compound := normalized.Compounds["C5"]
	if len(compound.PeakTempsC) != 2 || compound.PeakTempsC[0] != 70 || compound.PeakTempsC[1] != 80 {
		t.Fatalf("peak_temps_c = %+v, want [70 80]", compound.PeakTempsC)
	}
	if compound.Points[2].GripPct != 99.8 {
		t.Fatalf("grip_pct = %.1f, want 99.8", compound.Points[2].GripPct)
	}
}

func stringPtr(value string) *string {
	return &value
}
