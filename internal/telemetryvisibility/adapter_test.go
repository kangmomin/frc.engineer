package telemetryvisibility

import (
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

func TestParseSnapshotStrictMasksRestrictedFields(t *testing.T) {
	snapshot := testSnapshot()

	parsed := ParseSnapshot(snapshot, ModeStrict)

	if len(parsed.Cars) != 3 {
		t.Fatalf("cars = %d, want 3", len(parsed.Cars))
	}

	player := parsed.Cars[0].Normalized
	if player.FuelInTank == 0 || !player.ERSActualReady {
		t.Fatalf("expected player restricted values to remain visible, got %+v", player)
	}

	other := parsed.Cars[1].Normalized
	if other.FuelInTank != 0 || other.ERSStoreEnergy != 0 || other.ERSActualReady {
		t.Fatalf("expected rival restricted values to be masked, got %+v", other)
	}
	if other.ERSEstimatePct != 55 || !other.ERSEstimateReady {
		t.Fatalf("expected ERS estimate to come from source driver data, got %+v", other)
	}
	if parsed.Cars[1].Setup != nil {
		t.Fatalf("expected rival human setup to be masked, got %+v", parsed.Cars[1].Setup)
	}
	if parsed.Cars[2].Setup == nil {
		t.Fatal("expected AI setup to remain visible")
	}
	if !parsed.Cars[1].Normalized.DRSActivated {
		t.Fatalf("expected DRS activation to be copied from telemetry, got %+v", parsed.Cars[1].Normalized)
	}
	if !parsed.Cars[2].Normalized.AiControlled {
		t.Fatalf("expected AI-controlled participant flag to be preserved, got %+v", parsed.Cars[2].Normalized)
	}
}

func TestParseSnapshotPublicExposesRestrictedFields(t *testing.T) {
	snapshot := testSnapshot()

	parsed := ParseSnapshot(snapshot, ModePublic)

	other := parsed.Cars[1].Normalized
	if other.FuelInTank == 0 || other.ERSStoreEnergy == 0 || !other.ERSActualReady {
		t.Fatalf("expected public mode to expose restricted values, got %+v", other)
	}
	if parsed.CarStatus == nil || parsed.CarStatus.CarStatusData[1].FuelInTank == 0 {
		t.Fatalf("expected raw car status visibility in public mode, got %+v", parsed.CarStatus)
	}
}

func TestBuildEnvelopeUsesStrictForUnknownMode(t *testing.T) {
	snapshot := testSnapshot()

	parsed := ParseSnapshot(snapshot, Mode("unknown"))

	other := parsed.Cars[1].Normalized
	if other.FuelInTank != 0 || other.ERSStoreEnergy != 0 {
		t.Fatalf("expected unknown mode to fall back to strict, got %+v", other)
	}
}

func TestBuildEnvelopeCopiesDiffOnThrottle(t *testing.T) {
	snapshot := testSnapshot()

	env := BuildEnvelope(snapshot)

	if env.CarSetups == nil {
		t.Fatal("expected car setups to be present")
	}
	if env.CarSetups.CarSetups[1].DiffOnThrottle != 63 {
		t.Fatalf("diffOnThrottle = %d, want 63", env.CarSetups.CarSetups[1].DiffOnThrottle)
	}
	if env.CarSetups.CarSetups[1].OnThrottle != 63 {
		t.Fatalf("onThrottle = %d, want 63", env.CarSetups.CarSetups[1].OnThrottle)
	}
}

func testSnapshot() Snapshot {
	playerIndex := uint8(0)

	var participants packets.PacketParticipantsData
	participants.NumActiveCars = 3
	setParticipant(&participants.Participants[0], "Player", 1, 0, 1)
	setParticipant(&participants.Participants[1], "Rival", 2, 0, 0)
	setParticipant(&participants.Participants[2], "AI Bot", 3, 1, 0)

	var setups packets.PacketCarSetupData
	setups.CarSetupData[0].OnThrottle = 60
	setups.CarSetupData[0].BrakeBias = 56
	setups.CarSetupData[1].OnThrottle = 63
	setups.CarSetupData[1].BrakeBias = 54
	setups.CarSetupData[2].OnThrottle = 58
	setups.CarSetupData[2].BrakeBias = 58

	var telemetry packets.PacketCarTelemetryData
	telemetry.CarTelemetryData[1].DRS = 1

	var status packets.PacketCarStatusData
	status.CarStatusData[0] = packets.CarStatusData{
		FuelInTank:              23.5,
		FuelCapacity:            30,
		FuelRemainingLaps:       12.1,
		FuelMix:                 2,
		FrontBrakeBias:          56,
		VisualTyreCompound:      16,
		ActualTyreCompound:      19,
		TyresAgeLaps:            7,
		ERSStoreEnergy:          2100000,
		ERSDeployMode:           3,
		ERSHarvestedThisLapMGUK: 200000,
		ERSHarvestedThisLapMGUH: 90000,
		ERSDeployedThisLap:      320000,
	}
	status.CarStatusData[1] = packets.CarStatusData{
		FuelInTank:              18.2,
		FuelCapacity:            30,
		FuelRemainingLaps:       9.4,
		FuelMix:                 1,
		FrontBrakeBias:          54,
		VisualTyreCompound:      18,
		ActualTyreCompound:      20,
		TyresAgeLaps:            14,
		ERSStoreEnergy:          1400000,
		ERSDeployMode:           2,
		ERSHarvestedThisLapMGUK: 180000,
		ERSHarvestedThisLapMGUH: 70000,
		ERSDeployedThisLap:      280000,
	}

	var damage packets.PacketCarDamageData
	damage.CarDamageData[0].FrontLeftWingDamage = 4
	damage.CarDamageData[0].TyresWear = [4]float32{12, 13, 10, 11}
	damage.CarDamageData[1].FrontLeftWingDamage = 7
	damage.CarDamageData[1].TyresWear = [4]float32{22, 24, 19, 20}

	var lap packets.PacketLapData
	lap.LapData[0].CarPosition = 1
	lap.LapData[0].CurrentLapNum = 12
	lap.LapData[1].CarPosition = 2
	lap.LapData[1].CurrentLapNum = 12
	lap.LapData[2].CarPosition = 3
	lap.LapData[2].CurrentLapNum = 12

	return Snapshot{
		PlayerCarIndex: &playerIndex,
		Participants:   &participants,
		CarSetups:      &setups,
		CarTelemetry:   &telemetry,
		CarStatus:      &status,
		CarDamage:      &damage,
		LapData:        &lap,
		Drivers: []dto.DriverInfo{
			{Index: 0, ERSEstimatePct: 64, ERSEstimateReady: true},
			{Index: 1, ERSEstimatePct: 55, ERSEstimateReady: true},
			{Index: 2, ERSEstimatePct: 48, ERSEstimateReady: true},
		},
	}
}

func setParticipant(p *packets.ParticipantData, name string, teamID uint16, aiControlled uint8, yourTelemetry uint8) {
	p.TeamID = teamID
	p.AIControlled = aiControlled
	p.YourTelemetry = yourTelemetry
	copy(p.Name[:], []byte(name))
}
