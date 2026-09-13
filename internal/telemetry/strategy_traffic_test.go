package telemetry

import (
	"math"
	"slices"
	"testing"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/udp"
)

// Identical timestamped measurements describe two 90-second laps. Only the
// delivery order of a brief DRS/override sample changes between scenarios.
func captureTrafficBoundary(t *testing.T, source string, timingFirst, late bool) *strategy.Evidence {
	t.Helper()
	c := &strategyCapture{}
	send := func(tick int, p udp.ParsedData) {
		p.Header = &packets.PacketHeader{PacketFormat: 2026, GameYear: 25, GameMajorVersion: 1, GameMinorVersion: 22,
			SessionUID: 123, SessionTime: float32(float64(tick) / 20), OverallFrameIdentifier: uint32(tick + 1)}
		c.observe(&p)
	}
	send(0, udp.ParsedData{Session: &packets.PacketSessionData{Formula: 13, TotalLaps: 10, SessionType: 15,
		TrackLength: 4500, TrackTemperature: 30, StrategyRules: &packets.SessionStrategyRules{EqualPerformance: true}}})
	p := &packets.PacketParticipantsData{}
	p.Participants[0].TeamID = 476
	send(0, udp.ParsedData{Participants: p, CarSetups: &packets.PacketCarSetupData{}, CarTelemetry2: &packets.PacketCarTelemetry2Data{}})
	traffic := func(tick int, active bool) {
		telemetry := &packets.PacketCarTelemetryData{}
		telemetry.CarTelemetryData[0].Speed = 180
		overtake := &packets.PacketCarTelemetry2Data{}
		if active {
			if source == "DRS" {
				telemetry.CarTelemetryData[0].DRS = 1
			} else {
				overtake.CarTelemetry2Data[0].OvertakeActive = 1
			}
		}
		send(tick, udp.ParsedData{Telemetry: telemetry, CarTelemetry2: overtake})
	}
	for tick := 0; tick <= 3600; tick++ {
		at := float64(tick) / 20
		lapIndex, inLap := tick/1800, float64(tick%1800)/20
		if tick%10 == 0 {
			send(tick, udp.ParsedData{CarDamage: &packets.PacketCarDamageData{}})
			status := &packets.PacketCarStatusData{}
			status.CarStatusData[0] = packets.CarStatusData{ActualTyreCompound: 16, VisualTyreCompound: 16,
				TyresAgeLaps: uint8(5 + lapIndex), FuelInTank: float32(96 - at*.015), ERSStoreEnergy: 3000000}
			send(tick, udp.ParsedData{CarStatus: status})
		}
		active := !late && tick == 1800
		if !timingFirst {
			traffic(tick, active)
			if active {
				traffic(tick, false) // A short activation must survive an inactive sample.
			}
		}
		if late && tick == 1805 {
			traffic(tick, false)
			traffic(1798, true) // A previous-lap activation follows fresh inactive data.
		}
		lap := &packets.PacketLapData{}
		lap.LapData[0] = packets.LapData{CurrentLapNum: uint8(2 + lapIndex), CurrentLapTimeInMS: uint32(math.Round(inLap * 1000)),
			LastLapTimeInMS: 90000, LapDistance: float32(inLap * 50), CarPosition: 1}
		send(tick, udp.ParsedData{LapData: lap})
		if timingFirst {
			traffic(tick, active)
		}
	}
	e := c.snapshot(123)
	if e == nil || len(e.Laps) != 2 {
		t.Fatalf("missing completed capture: %+v", e)
	}
	return e
}

func TestStrategyTrafficBelongsToTimestampedLap(t *testing.T) {
	for _, source := range []string{"DRS", "override"} {
		for _, timingFirst := range []bool{false, true} {
			for _, late := range []bool{false, true} {
				t.Run(source+"/"+map[bool]string{false: "telemetry-first", true: "timing-first"}[timingFirst]+"/"+map[bool]string{false: "boundary", true: "late"}[late], func(t *testing.T) {
					e := captureTrafficBoundary(t, source, timingFirst, late)
					wantTraffic := 1
					if late {
						wantTraffic = 0
					}
					for i, lap := range e.Laps {
						if (i == wantTraffic && !slices.Equal(lap.Flags, []string{"traffic"})) || (i != wantTraffic && len(lap.Flags) != 0) {
							t.Fatalf("lap %d flags=%v, traffic belongs to lap %d", lap.Number, lap.Flags, wantTraffic+2)
						}
					}
				})
			}
		}
	}
}

func TestStrategyTrafficQueueIsBoundedAndResetsWithTimingEpoch(t *testing.T) {
	c := &strategyCapture{}
	c.reset(123, 0)
	c.session = &packets.PacketSessionData{SessionType: 15, TotalLaps: 10}
	c.evidence.Conditions.TotalLaps = 10
	c.observeLap(0, packets.LapData{CurrentLapNum: 2, CarPosition: 1})
	for i := 1; i <= 1000; i++ {
		c.observeTraffic(float64(i) / 20)
	}
	if len(c.pendingTraffic) > 256 {
		t.Fatal("missing timing allowed an unbounded activation queue")
	}
	c.observeLap(50, packets.LapData{CurrentLapNum: 2, CurrentLapTimeInMS: 50000, CarPosition: 1})
	if !c.current.flags["gap"] || c.trafficOverflow || len(c.pendingTraffic) != 0 {
		t.Fatal("lost queued samples were admitted as complete telemetry")
	}
	c.observeTraffic(51)
	c.lapFrame = 2000
	c.observeLap(0, packets.LapData{CurrentLapNum: 2, CarPosition: 1})
	old := &packets.PacketCarTelemetry2Data{}
	old.CarTelemetry2Data[0].OvertakeActive = 1
	c.observe(&udp.ParsedData{Header: &packets.PacketHeader{SessionUID: 123, OverallFrameIdentifier: 1999, SessionTime: 51}, CarTelemetry2: old})
	if len(c.pendingTraffic) != 0 || len(c.lapWindows) != 0 || c.overtakeKnown {
		t.Fatal("pre-reset activation or freshness crossed the timing epoch")
	}
	c.reset(124, 0)
	c.observe(&udp.ParsedData{Header: &packets.PacketHeader{SessionUID: 124, OverallFrameIdentifier: 1}, CarTelemetry2: old})
	if len(c.pendingTraffic) != 1 || !c.overtakeKnown {
		t.Fatal("old timing epoch suppressed packets in a new session")
	}
}

func TestStrategyLateTrafficPreservesPublishedSnapshot(t *testing.T) {
	e := captureTrafficBoundary(t, "override", false, false)
	flags := make([]string, 3, 4)
	copy(flags, []string{"gap", "invalid", "weather-change"})
	e.Laps[0].Flags = flags
	c := &strategyCapture{uid: 123, evidence: *e, lapWindows: []strategyLapWindow{{start: 0, end: 90, index: 0}}}
	published := c.snapshot(123)
	if published == nil {
		t.Fatal("fixture did not publish a valid snapshot")
	}
	c.markTraffic(30)
	if !slices.Equal(published.Laps[0].Flags, []string{"gap", "invalid", "weather-change"}) {
		t.Fatalf("late sample mutated an immutable published summary: %v", published.Laps[0].Flags)
	}
	if !slices.Equal(c.evidence.Laps[0].Flags, []string{"gap", "invalid", "traffic", "weather-change"}) {
		t.Fatalf("late activation lost an existing exclusion: %v", c.evidence.Laps[0].Flags)
	}
}
