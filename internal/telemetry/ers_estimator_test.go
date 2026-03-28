package telemetry

import (
	"math"
	"testing"

	"frc.engineer/internal/packets"
)

func TestERSEstimatorResetsOnNewSession(t *testing.T) {
	estimator := NewERSEstimator(nil)

	for step := 0; step < 7; step++ {
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(101, float32(step)*0.25, 1, float32(150+step*90), 0.98, 0.02, 305, 3, 1, float32(step*24_000), float32(step*3_000), 0, false)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}
	if estimator.cars[0].validSteps == 0 {
		t.Fatal("expected estimator to accumulate warmup steps")
	}

	session, participants, lapData, telemetry, carStatus := makeERSTestPackets(202, 0.10, 1, 90, 0.20, 0.00, 110, 0, 0, 0, 0, 0, false)
	snapshot := estimator.Update(session, participants, lapData, telemetry, carStatus, 0)

	if estimator.sessionUID != 202 {
		t.Fatalf("sessionUID = %d, want 202", estimator.sessionUID)
	}
	if estimator.cars[0].validSteps != 0 {
		t.Fatalf("validSteps = %d, want 0 after session reset", estimator.cars[0].validSteps)
	}
	if snapshot[0].Ready {
		t.Fatal("snapshot should not be ready immediately after a session reset")
	}
}

func TestERSEstimatorUsesPublicTelemetryCalibration(t *testing.T) {
	estimator := NewERSEstimator(nil)

	for step := 0; step < 8; step++ {
		energy := float32(3_200_000 - (step * 10_000))
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(303, float32(step)*0.25, 2, float32(300+step*85), 1.00, 0.00, 320, 3, 1, float32(step*25_000), float32(step*2_000), energy, true)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}

	if estimator.calibrationSamples == 0 {
		t.Fatal("expected public telemetry samples to calibrate the estimator")
	}
	if estimator.bucketCalibration[3].deploySamples == 0 {
		t.Fatal("expected deploy calibration to be recorded for the active bucket")
	}
}

func TestERSEstimatorTracksDeployAndHarvest(t *testing.T) {
	estimator := NewERSEstimator(nil)

	for step := 0; step < 7; step++ {
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(404, float32(step)*0.25, 3, float32(220+step*95), 0.99, 0.01, 300, 3, 1, float32(step*28_000), float32(step*2_000), 0, false)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}
	afterDeploy := estimator.cars[0].energyJ
	if afterDeploy >= ersEstimateDefaultEnergyJ {
		t.Fatalf("deploy phase should lower ERS energy, got %.0f", afterDeploy)
	}

	for step := 7; step < 14; step++ {
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(404, float32(step)*0.25, 3, float32(220+step*95), 0.18, 0.62, 130, 1, 0, 196_000, float32((step-6)*22_000), 0, false)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}
	afterHarvest := estimator.cars[0].energyJ
	if afterHarvest <= afterDeploy {
		t.Fatalf("harvest phase should recover ERS energy, got deploy=%.0f harvest=%.0f", afterDeploy, afterHarvest)
	}
}

func TestERSEstimatorCarriesForwardAcrossLapChange(t *testing.T) {
	estimator := NewERSEstimator(nil)

	for step := 0; step < 7; step++ {
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(505, float32(step)*0.25, 5, float32(4_800+step*120), 0.96, 0.02, 290, 2, 1, float32(step*20_000), float32(step*1_000), 0, false)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}
	beforeLapChange := estimator.cars[0].energyJ

	session, participants, lapData, telemetry, carStatus := makeERSTestPackets(505, 2.0, 6, 85, 0.55, 0.05, 165, 1, 0, 500, 250, 0, false)
	estimator.Update(session, participants, lapData, telemetry, carStatus, 0)

	car := estimator.cars[0]
	if car.completedLaps != 1 {
		t.Fatalf("completedLaps = %d, want 1", car.completedLaps)
	}
	if car.lapStartDeployJ != 500 || car.lapStartHarvestJ != 250 {
		t.Fatalf("lap start counters not reset, got deploy=%.0f harvest=%.0f", car.lapStartDeployJ, car.lapStartHarvestJ)
	}
	if math.Abs(car.energyJ-beforeLapChange) > 200_000 {
		t.Fatalf("lap change should preserve energy continuity, delta=%.0f", math.Abs(car.energyJ-beforeLapChange))
	}
}

func TestPitwallManagerBuildStatePublishesERSEstimateReadiness(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.playerIndex = 0

	session, participants, lapData, telemetry, carStatus := makeERSTestPackets(606, 0.0, 4, 150, 0.95, 0.00, 300, 3, 1, 0, 0, 0, false)
	pm.session = session
	pm.participants = participants
	pm.lapData = lapData
	pm.telemetry = telemetry
	pm.carStatus = carStatus

	state := pm.BuildState()
	if len(state.Drivers) != 1 {
		t.Fatalf("drivers = %d, want 1", len(state.Drivers))
	}
	if state.Drivers[0].ERSEstimateReady {
		t.Fatal("estimate should stay hidden before warmup")
	}

	for step := 1; step < 8; step++ {
		session, participants, lapData, telemetry, carStatus = makeERSTestPackets(606, float32(step)*0.25, 4, float32(150+step*90), 0.96, 0.01, 302, 3, 1, float32(step*18_000), float32(step*2_500), 0, false)
		pm.session = session
		pm.participants = participants
		pm.lapData = lapData
		pm.telemetry = telemetry
		pm.carStatus = carStatus
		state = pm.BuildState()
	}

	driver := state.Drivers[0]
	if !driver.ERSEstimateReady {
		t.Fatal("estimate should be ready after warmup and counter movement")
	}
	if driver.ERSEstimatePct < 0 || driver.ERSEstimatePct > 100 {
		t.Fatalf("estimate percent out of bounds: %d", driver.ERSEstimatePct)
	}
}

func makeERSTestPackets(
	sessionUID uint64,
	sessionTime float32,
	lapNum uint8,
	lapDistance float32,
	throttle float32,
	brake float32,
	speed uint16,
	deployMode uint8,
	drs uint8,
	deployedThisLap float32,
	harvestedThisLap float32,
	actualEnergy float32,
	publicTelemetry bool,
) (*packets.PacketSessionData, *packets.PacketParticipantsData, *packets.PacketLapData, *packets.PacketCarTelemetryData, *packets.PacketCarStatusData) {
	header := packets.PacketHeader{
		SessionUID:  sessionUID,
		SessionTime: sessionTime,
	}
	session := &packets.PacketSessionData{
		Header:      header,
		TrackID:     10,
		TrackLength: 5800,
	}
	participants := &packets.PacketParticipantsData{
		Header:        header,
		NumActiveCars: 1,
	}
	copy(participants.Participants[0].Name[:], []byte("Test Driver"))
	if publicTelemetry {
		participants.Participants[0].YourTelemetry = 1
	}

	lapData := &packets.PacketLapData{
		Header: header,
	}
	lapData.LapData[0] = packets.LapData{
		CurrentLapNum: lapNum,
		LapDistance:   lapDistance,
		CarPosition:   1,
	}

	telemetry := &packets.PacketCarTelemetryData{
		Header: header,
	}
	telemetry.CarTelemetryData[0] = packets.CarTelemetryData{
		Speed:    speed,
		Throttle: throttle,
		Brake:    brake,
		DRS:      drs,
	}

	carStatus := &packets.PacketCarStatusData{
		Header: header,
	}
	carStatus.CarStatusData[0] = packets.CarStatusData{
		ERSStoreEnergy:          actualEnergy,
		ERSDeployMode:           deployMode,
		ERSDeployedThisLap:      deployedThisLap,
		ERSHarvestedThisLapMGUK: harvestedThisLap * 0.7,
		ERSHarvestedThisLapMGUH: harvestedThisLap * 0.3,
	}

	return session, participants, lapData, telemetry, carStatus
}

func TestERSEstimatorInitializesPlayerFromActualEnergy(t *testing.T) {
	estimator := NewERSEstimator(nil)

	session, participants, lapData, telemetry, carStatus := makeERSTestPackets(707, 0.25, 2, 320, 0.94, 0.01, 296, 3, 1, 32_000, 4_000, 40_000, false)
	snapshot := estimator.Update(session, participants, lapData, telemetry, carStatus, 0)

	if snapshot[0].Percent > 5 {
		t.Fatalf("initial estimate percent = %d, want <= 5 when actual ERS is nearly empty", snapshot[0].Percent)
	}
	if math.Abs(estimator.cars[0].energyJ-40_000) > 1 {
		t.Fatalf("initial energy = %.0f, want 40000", estimator.cars[0].energyJ)
	}
}

func TestERSEstimatorUsesPlayerActualForCalibration(t *testing.T) {
	estimator := NewERSEstimator(nil)

	for step := 0; step < 8; step++ {
		energy := float32(1_200_000 - (step * 12_000))
		session, participants, lapData, telemetry, carStatus := makeERSTestPackets(808, float32(step)*0.25, 3, float32(500+step*90), 1.00, 0.00, 315, 3, 1, float32(step*18_000), float32(step*1_500), energy, false)
		estimator.Update(session, participants, lapData, telemetry, carStatus, 0)
	}

	if estimator.calibrationSamples == 0 {
		t.Fatal("expected player actual ERS to contribute calibration samples")
	}
}

func TestERSEstimatorReanchorsLargeActualMismatch(t *testing.T) {
	estimator := NewERSEstimator(nil)
	estimator.sessionUID = 909
	estimator.cars[0] = ersCarState{
		initialized:         true,
		energyJ:             3_200_000,
		lastSessionTime:     1.00,
		lastLapNum:          4,
		lastLapDistance:     900,
		lastSpeed:           305,
		lastDeployJ:         240_000,
		lastHarvestJ:        30_000,
		lapStartEnergyJ:     3_200_000,
		lapStartDeployJ:     200_000,
		lapStartHarvestJ:    20_000,
		validSteps:          8,
		seenCounterMovement: true,
	}

	session, participants, lapData, telemetry, carStatus := makeERSTestPackets(909, 1.25, 4, 980, 0.98, 0.00, 312, 3, 1, 250_000, 32_000, 40_000, false)
	snapshot := estimator.Update(session, participants, lapData, telemetry, carStatus, 0)

	if snapshot[0].Percent > 6 {
		t.Fatalf("reanchored estimate percent = %d, want <= 6 for near-empty actual ERS", snapshot[0].Percent)
	}
}
