package telemetry

import "testing"

func TestStrategyManagerCrossoverPrediction(t *testing.T) {
	sm := NewStrategyManager()
	sm.drivers[0].RecentLaps = []completedLap{
		{LapNum: 5, TimeMS: 90_000, Compound: "soft"},
		{LapNum: 6, TimeMS: 91_500, Compound: "soft"},
		{LapNum: 7, TimeMS: 93_000, Compound: "soft"},
	}
	sm.drivers[1].RecentLaps = []completedLap{
		{LapNum: 5, TimeMS: 93_000, Compound: "inter"},
		{LapNum: 6, TimeMS: 93_000, Compound: "inter"},
		{LapNum: 7, TimeMS: 93_500, Compound: "inter"},
	}

	prediction := sm.GetCrossoverPrediction()
	if !prediction.Available {
		t.Fatalf("prediction should be available, got unavailable: %s", prediction.Reason)
	}
	if prediction.DryGroup != "slick" {
		t.Fatalf("dry group = %q, want slick", prediction.DryGroup)
	}
	if prediction.WetGroup != "inter" {
		t.Fatalf("wet group = %q, want inter", prediction.WetGroup)
	}
	if prediction.CurrentDeltaMS != -500 {
		t.Fatalf("current delta = %.0f, want -500", prediction.CurrentDeltaMS)
	}
	if prediction.TrendDeltaMSPerLap != 1250 {
		t.Fatalf("trend delta = %.0f, want 1250", prediction.TrendDeltaMSPerLap)
	}
	if prediction.HistoryDepth != 3 {
		t.Fatalf("history depth = %d, want 3", prediction.HistoryDepth)
	}
	if prediction.DrySampleCount != 1 || prediction.WetSampleCount != 1 {
		t.Fatalf("sample counts = %d/%d, want 1/1", prediction.DrySampleCount, prediction.WetSampleCount)
	}
}

func TestStrategyManagerCrossoverPredictionRequiresBothGroups(t *testing.T) {
	sm := NewStrategyManager()
	sm.drivers[0].RecentLaps = []completedLap{
		{LapNum: 10, TimeMS: 91_000, Compound: "soft"},
		{LapNum: 11, TimeMS: 91_500, Compound: "soft"},
	}

	prediction := sm.GetCrossoverPrediction()
	if prediction.Available {
		t.Fatal("prediction should not be available without wet-weather runners")
	}
	if prediction.Reason == "" {
		t.Fatal("prediction should explain why it is unavailable")
	}
}
