package strategy_test

import (
	"encoding/json"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestCaptureKeepsOtherLapsWhenOneMeasurementIsInvalid(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*strategy.Lap)
	}{
		{"lap over time limit", func(l *strategy.Lap) { l.TimeMs = 900001 }},
		{"invalid energy", func(l *strategy.Lap) { l.Energy[0].MeanSpeedKph = 501 }},
		{"invalid tyre age", func(l *strategy.Lap) { l.EndTyreAge = 255 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := strategytest.Records()[0].Evidence
			tc.edit(&e.Laps[3])
			before, _ := json.Marshal(e)
			got := strategy.RetainValidSamples(&e)
			if got == nil || len(got.Laps) != 29 || got.Laps[3].Number != 5 || strategy.ValidateEvidence(got) != nil {
				t.Fatal("bad measurement erased valid completed laps")
			}
			if strategy.ValidateEvidence(&e) == nil {
				t.Fatal("strict ingest validation accepted the original invalid evidence")
			}
			after, _ := json.Marshal(e)
			if string(before) != string(after) {
				t.Fatal("capture filtering mutated the original evidence")
			}
		})
	}
}

func TestCaptureDropsBadStopButPreservesSessionExclusions(t *testing.T) {
	e := strategytest.Records()[0].Evidence
	e.Stops[0].StationaryMs = e.Stops[0].LaneMs + 1
	e.Reasons = []string{"conditions-change", "flashback"}
	got := strategy.RetainValidSamples(&e)
	if got == nil || len(got.Stops) != 0 || len(got.Laps) != 30 || len(got.Reasons) != 2 || strategy.ValidateEvidence(got) != nil {
		t.Fatal("invalid optional stop poisoned the race or erased its exclusion")
	}
	if len(strategy.Contexts([]strategy.Record{{AccountID: "capture", Evidence: *got}})) != 0 {
		t.Fatal("filtering made a globally excluded session clean")
	}
}

func TestCaptureDoesNotGuessInvalidSessionOrReorderedLaps(t *testing.T) {
	for _, edit := range []func(*strategy.Evidence){
		func(e *strategy.Evidence) { e.Conditions.TrackLengthM = 0 },
		func(e *strategy.Evidence) { e.Laps[3].Number = e.Laps[2].Number },
		func(e *strategy.Evidence) { e.Reasons = []string{"unknown"} },
	} {
		e := strategytest.Records()[0].Evidence
		edit(&e)
		if strategy.RetainValidSamples(&e) != nil {
			t.Fatal("ambiguous capture was guessed into valid evidence")
		}
	}
	if strategy.RetainValidSamples(nil) != nil {
		t.Fatal("nil capture became synthetic evidence")
	}
}
