package telemetry

import (
	"math"
	"slices"
	"testing"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/udp"
)

// Two complete 90-second laps with sparse 2 Hz status and the 24th car.
// Status-before-timing and timing-before-status must describe the same laps.
func capturedStrategy(t *testing.T, statusFirst, overtake, gap bool) *strategy.Evidence {
	t.Helper()
	c := &strategyCapture{}
	send := func(at float64, p udp.ParsedData) {
		p.Header = &packets.PacketHeader{PacketFormat: 2026, GameYear: 25, GameMajorVersion: 1, GameMinorVersion: 22, SessionUID: 123, PlayerCarIndex: 23, SessionTime: float32(at)}
		c.observe(&p)
	}
	send(0, udp.ParsedData{Session: &packets.PacketSessionData{Formula: 13, TotalLaps: 10, SessionType: 15, TrackLength: 4500, TrackTemperature: 30, StrategyRules: &packets.SessionStrategyRules{EqualPerformance: true}}})
	p := &packets.PacketParticipantsData{}
	p.Participants[23].TeamID = 476
	send(0, udp.ParsedData{Participants: p, CarSetups: &packets.PacketCarSetupData{}})
	for tick := 0; tick <= 3600; tick++ {
		at := float64(tick) / 20
		if gap && tick >= 400 && tick <= 410 {
			continue
		}
		lapIndex, inLap := tick/1800, float64(tick%1800)/20
		telemetry := &packets.PacketCarTelemetryData{}
		telemetry.CarTelemetryData[23].Speed = 180
		t2 := &packets.PacketCarTelemetry2Data{}
		if overtake && tick == 400 {
			t2.CarTelemetry2Data[23].OvertakeActive = 1
		}
		send(at, udp.ParsedData{Telemetry: telemetry, CarTelemetry2: t2})
		status := &packets.PacketCarStatusData{}
		status.CarStatusData[23] = packets.CarStatusData{ActualTyreCompound: 16, VisualTyreCompound: 16, TyresAgeLaps: uint8(5 + lapIndex), FuelInTank: float32(96 - at*.015),
			ERSStoreEnergy: float32(3000000 - 600000*inLap/90), ERSDeployedThisLap: float32(2400000 * inLap / 90), ERSHarvestedThisLapMGUK: float32(1800000 * inLap / 90)}
		if tick%10 == 0 {
			damage := &packets.PacketCarDamageData{}
			wear := float32(5 + at/90)
			damage.CarDamageData[23].TyresWear = [4]float32{wear, wear, wear, wear}
			damage.CarDamageData[23].TyresDamage = [4]uint8{uint8(wear), uint8(wear), uint8(wear), uint8(wear)}
			send(at, udp.ParsedData{CarDamage: damage})
			if statusFirst {
				send(at, udp.ParsedData{CarStatus: status})
			}
		}
		lap := &packets.PacketLapData{}
		lap.LapData[23] = packets.LapData{CurrentLapNum: uint8(2 + lapIndex), CurrentLapTimeInMS: uint32(math.Round(inLap * 1000)), LastLapTimeInMS: 90000, LapDistance: float32(inLap * 50), CarPosition: 1}
		send(at, udp.ParsedData{LapData: lap})
		if !statusFirst && tick%10 == 0 {
			send(at, udp.ParsedData{CarStatus: status})
		}
	}
	e := c.snapshot(123)
	if e == nil || len(e.Laps) != 2 {
		t.Fatalf("missing completed capture: %+v", e)
	}
	return e
}

func TestStrategyCaptureLapBoundaryPacketOrders(t *testing.T) {
	for _, statusFirst := range []bool{true, false} {
		e := capturedStrategy(t, statusFirst, false, false)
		if *e.Conditions.TeamID != 476 {
			t.Fatal("2026 uint16 team ID lost")
		}
		for i, l := range e.Laps {
			if len(l.Flags) != 0 || l.TyreAge != 5+i || l.EndTyreAge != 5+i || l.ERSStartJ == nil || *l.ERSStartJ != 3000000 || *l.ERSEndJ >= 2410000 {
				t.Fatalf("statusFirst=%v contaminated lap: %+v", statusFirst, l)
			}
			var deployed, duration float64
			for _, s := range l.Energy {
				deployed += s.DeployedJ
				duration += s.DurationMs
			}
			if duration < 89000 || math.Abs(deployed-2400000*89.5/90) > 2 {
				t.Fatalf("normal counter reset lost ERS: duration=%v deploy=%v", duration, deployed)
			}
		}
	}
}

func TestProcessorCollectsStrategyWithOptionalOutputsDisabled(t *testing.T) {
	p := NewProcessor(udp.NewParser(testLogger()), &dashboardTestHub{}, 0, testLogger(), nil)
	p.SetDashboardEnabled(false)
	p.SetReplayRecording(false)
	p.SetRaceSummaryRecording(true) // Sender keeps this pipeline on even with local saving off.
	dashboardFixture(t, p)
	laps := make([]packets.LapData, 22)
	laps[0] = packets.LapData{CurrentLapNum: 2, LastLapTimeInMS: 90000, CarPosition: 1}
	p.processPacket(dashboardPacket(t, 2, laps, 255, 255))
	e := p.strategyEvidence.snapshot(41)
	if e == nil || len(e.Laps) != 1 || e.Laps[0].TimeMs != 90000 {
		t.Fatalf("default packet processing did not collect strategy evidence: %+v", e)
	}
	// Missing measurements remain flagged even though collection is automatic.
	if !slices.Contains(e.Laps[0].Flags, "source-missing") {
		t.Fatal("default collection treated absent measurements as clean")
	}
}

func TestStrategyCaptureContaminatedLapsExcluded(t *testing.T) {
	for _, flag := range []string{"traffic", "gap"} {
		e := capturedStrategy(t, true, flag == "traffic", flag == "gap")
		if !slices.Contains(e.Laps[0].Flags, flag) || len(e.Laps[1].Flags) != 0 {
			t.Fatalf("expected only first lap %s: %+v", flag, e.Laps)
		}
	}
}

func TestStrategyCaptureRejectsMissingSourceAndFlashback(t *testing.T) {
	c := &strategyCapture{}
	c.reset(123, 0)
	c.session = &packets.PacketSessionData{SessionType: 15, TotalLaps: 10}
	c.evidence.Conditions = strategy.Conditions{PacketFormat: 2025, TotalLaps: 10, SessionType: 15, TrackLengthM: 4500}
	c.observeLap(0, packets.LapData{CurrentLapNum: 2})
	c.observeLap(90, packets.LapData{CurrentLapNum: 3, LastLapTimeInMS: 90000})
	if !slices.Contains(c.evidence.Laps[0].Flags, "source-missing") {
		t.Fatal("missing native status/damage/setup was treated as clean")
	}
	c.observeLap(80, packets.LapData{CurrentLapNum: 2, CurrentLapTimeInMS: 80000})
	if len(c.evidence.Laps) != 0 || !slices.Contains(c.evidence.Reasons, "flashback") {
		t.Fatal("rewound observations remained in corpus")
	}
	if e := c.snapshot(123); e == nil || !slices.Contains(e.Reasons, "flashback") {
		t.Fatal("rewind reason must survive a checkpoint with no newly completed laps")
	}
}

func TestStrategyDamageDistinguishesTyreWear(t *testing.T) {
	for _, tc := range []struct {
		name    string
		damage  packets.CarDamageData
		exclude bool
	}{
		// Actual race-clean-start capture, 1.58 seconds after lights out.
		{"ordinary wear", packets.CarDamageData{TyresWear: [4]float32{1.0448905, 1.0575718}, TyresDamage: [4]uint8{1, 1}}, false},
		{"integer rounding", packets.CarDamageData{TyresWear: [4]float32{39.5}, TyresDamage: [4]uint8{40}}, false},
		{"damage beyond wear", packets.CarDamageData{TyresWear: [4]float32{39.5}, TyresDamage: [4]uint8{41}}, true},
		{"puncture on worn tyre", packets.CarDamageData{TyresWear: [4]float32{99.5}, TyresDamage: [4]uint8{100}}, true},
		{"wing damage", packets.CarDamageData{FrontLeftWingDamage: 1}, true},
		{"engine damage", packets.CarDamageData{EngineDamage: 1}, true},
		{"DRS fault", packets.CarDamageData{DRSFault: 1}, true},
		{"ERS fault", packets.CarDamageData{ERSFault: 1}, true},
		{"unknown wear", packets.CarDamageData{TyresWear: [4]float32{float32(math.NaN())}}, true},
		{"infinite wear", packets.CarDamageData{TyresWear: [4]float32{float32(math.Inf(1))}}, true},
		{"negative wear", packets.CarDamageData{TyresWear: [4]float32{-1}}, true},
		{"out of range wear", packets.CarDamageData{TyresWear: [4]float32{101}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := strategyDamaged(tc.damage); got != tc.exclude {
				t.Fatalf("excluded=%v, want %v", got, tc.exclude)
			}
		})
	}
}

func TestStrategyCapturePreRaceClockResets(t *testing.T) {
	c := &strategyCapture{}
	c.reset(123, 0)
	c.session = &packets.PacketSessionData{SessionType: 15, TotalLaps: 20}
	c.evidence.Conditions = strategy.Conditions{PacketFormat: 2026, TotalLaps: 20, SessionType: 15, TrackLengthM: 3337}
	// Actual consecutive-frame resets from race-edge-cases; no FLBK event and
	// no timed lap yet, including the reset after the formation lap.
	for _, times := range [][2]float64{{113.30251, .000008}, {102.26422, .043627}, {6.128495, .067841}} {
		l := packets.LapData{CurrentLapNum: 1}
		c.observeLap(times[0], l)
		c.observeLap(times[1], l)
		if len(c.evidence.Reasons) != 0 {
			t.Fatalf("pre-race reset %v disqualified the session: %v", times, c.evidence.Reasons)
		}
		if c.current == nil || c.current.startTime != times[1] {
			t.Fatal("pre-race reset retained an old lap accumulator")
		}
	}
}

func TestStrategyCaptureStillRejectsRealRewinds(t *testing.T) {
	for _, tc := range []struct {
		name      string
		before    packets.LapData
		after     packets.LapData
		completed bool
		explicit  bool
	}{
		{"timed first lap", packets.LapData{CurrentLapNum: 1, CurrentLapTimeInMS: 10000}, packets.LapData{CurrentLapNum: 1}, false, false},
		{"completed evidence", packets.LapData{CurrentLapNum: 1}, packets.LapData{CurrentLapNum: 1}, true, false},
		{"reported previous lap", packets.LapData{CurrentLapNum: 1, LastLapTimeInMS: 90000}, packets.LapData{CurrentLapNum: 1}, false, false},
		{"joined during race", packets.LapData{CurrentLapNum: 3}, packets.LapData{CurrentLapNum: 2}, false, false},
		{"explicit event before start", packets.LapData{CurrentLapNum: 1}, packets.LapData{CurrentLapNum: 1}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &strategyCapture{}
			c.reset(123, 0)
			c.session = &packets.PacketSessionData{SessionType: 15, TotalLaps: 20}
			c.evidence.Conditions = strategy.Conditions{PacketFormat: 2026, TotalLaps: 20, SessionType: 15, TrackLengthM: 3337}
			c.observeLap(100, tc.before)
			if tc.completed {
				c.evidence.Laps = []strategy.Lap{{Number: 1, TimeMs: 90000}}
			}
			if tc.explicit {
				c.observe(&udp.ParsedData{Header: &packets.PacketHeader{SessionUID: 123, SessionTime: 100}, Event: &packets.PacketEventData{EventStringCode: packets.EventFlashback}})
			}
			c.observeLap(0, tc.after)
			if !slices.Contains(c.evidence.Reasons, "flashback") || len(c.evidence.Laps) != 0 {
				t.Fatalf("real rewind retained usable evidence: %+v", c.evidence)
			}
		})
	}
}
