package telemetry

import (
	"testing"

	"frc.engineer/internal/packets"
)

// carStatusFor builds a single-car CarStatus packet (driver 0) with the given
// visual compound and tyre age.
func carStatusFor(visualCompound, tyreAge uint8) *packets.PacketCarStatusData {
	p := &packets.PacketCarStatusData{}
	p.CarStatusData[0].VisualTyreCompound = visualCompound
	p.CarStatusData[0].TyresAgeLaps = tyreAge
	return p
}

// lapDataFor builds a single-car LapData packet (driver 0).
func lapDataFor(currentLap, numPitStops uint8) *packets.PacketLapData {
	p := &packets.PacketLapData{}
	p.LapData[0].CurrentLapNum = currentLap
	p.LapData[0].NumPitStops = numPitStops
	return p
}

// carDamageFor builds a single-car CarDamage packet (driver 0) with a uniform
// 4-corner wear percentage.
func carDamageFor(wear float32) *packets.PacketCarDamageData {
	p := &packets.PacketCarDamageData{}
	p.CarDamageData[0].TyresWear = [4]float32{wear, wear, wear, wear}
	return p
}

// TestStrategyManagerStintWearPeakOnClose reproduces the pit-lap frame-order hazard:
// a fresh-tyre ~0% CarDamage frame can land between the pit stop and the
// compound-change detection. The stint that just closed must still record its peak
// wear, not the post-pit reset value.
func TestStrategyManagerStintWearPeakOnClose(t *testing.T) {
	const (
		visualSoft   = 16
		visualMedium = 17
	)
	sm := NewStrategyManager()

	// Lap 5 on Soft (age 5): initialises the running stint.
	sm.Update(carStatusFor(visualSoft, 5), lapDataFor(5, 0))
	// Wear builds to a peak of 55% over the stint.
	sm.UpdateTyreWear(carDamageFor(40))
	sm.UpdateTyreWear(carDamageFor(55))
	// A fresh-tyre 0% frame arrives (post-pit) BEFORE the compound change is seen —
	// UpdateTyreWear keeps the max, so the peak survives.
	sm.UpdateTyreWear(carDamageFor(0))

	// Lap 6 on Medium (age 1): compound change closes the Soft stint.
	sm.Update(carStatusFor(visualMedium, 1), lapDataFor(6, 1))

	hist := sm.drivers[0].StintHistory
	if len(hist) != 1 {
		t.Fatalf("stint history len = %d, want 1 (closed soft stint)", len(hist))
	}
	closed := hist[0]
	if closed.Compound != "soft" || closed.StartLap != 1 || closed.Laps != 5 {
		t.Fatalf("closed stint = %+v, want soft L1 (5 laps)", closed)
	}
	if closed.TireWearPct != 55 {
		t.Fatalf("closed stint wear = %d, want 55 (peak, not the post-pit 0%%)", closed.TireWearPct)
	}
	// The new stint's accumulator must have been reset for the fresh tyre.
	if sm.drivers[0].currentStintWear != 0 {
		t.Fatalf("running stint wear = %d, want 0 after reset", sm.drivers[0].currentStintWear)
	}
}

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
