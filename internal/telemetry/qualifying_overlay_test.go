package telemetry

import (
	"strings"
	"testing"

	"frc.engineer/internal/packets"
)

func TestEvaluateQualifyingTryStateUsesSpeedSignal(t *testing.T) {
	state := evaluateQualifyingTryState(qualifyingOverlayCar{
		driverStatus:   1,
		speedKPH:       289,
		topSpeedKPH:    310,
		ersActualPct:   62,
		ersActualReady: true,
	})

	if state.Label != "TRY" {
		t.Fatalf("label = %q, want TRY", state.Label)
	}
	if !strings.Contains(state.Summary, "289kph") {
		t.Fatalf("summary = %q, want speed signal", state.Summary)
	}
}

func TestBuildStrategyOverlayDataQualifyingUsesTrackCarsAndTryState(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.playerIndex = 0
	pm.session = &packets.PacketSessionData{
		SessionType: uint8(packets.SessionQ2),
		TrackLength: 5000,
	}
	pm.participants = &packets.PacketParticipantsData{NumActiveCars: 4}
	copy(pm.participants.Participants[0].Name[:], []byte("Player Car"))
	copy(pm.participants.Participants[1].Name[:], []byte("Ahead Car"))
	copy(pm.participants.Participants[2].Name[:], []byte("Pit Car"))
	copy(pm.participants.Participants[3].Name[:], []byte("Behind Car"))

	pm.lapData = &packets.PacketLapData{}
	pm.lapData.LapData[0] = packets.LapData{
		CarPosition:   8,
		CurrentLapNum: 5,
		PitStatus:     0,
		LapDistance:   2000,
		DriverStatus:  1,
		ResultStatus:  2,
	}
	pm.lapData.LapData[1] = packets.LapData{
		CarPosition:           7,
		CurrentLapNum:         5,
		PitStatus:             0,
		LapDistance:           2150,
		DriverStatus:          1,
		ResultStatus:          2,
		LastLapTimeInMS:       71000,
		Sector1TimeInMS:       29950,
		Sector2TimeInMS:       40050,
		SpeedTrapFastestSpeed: 302,
	}
	pm.lapData.LapData[2] = packets.LapData{
		CarPosition:   6,
		CurrentLapNum: 5,
		PitStatus:     1,
		LapDistance:   2100,
		DriverStatus:  1,
		ResultStatus:  2,
	}
	pm.lapData.LapData[3] = packets.LapData{
		CarPosition:           9,
		CurrentLapNum:         5,
		PitStatus:             0,
		LapDistance:           1850,
		DriverStatus:          2,
		ResultStatus:          2,
		LastLapTimeInMS:       76000,
		Sector1TimeInMS:       31400,
		Sector2TimeInMS:       41200,
		SpeedTrapFastestSpeed: 295,
	}

	pm.telemetry = &packets.PacketCarTelemetryData{}
	pm.telemetry.CarTelemetryData[1] = packets.CarTelemetryData{Speed: 289, DRS: 1}
	pm.telemetry.CarTelemetryData[3] = packets.CarTelemetryData{Speed: 198, DRS: 0}

	pm.carStatus = &packets.PacketCarStatusData{}
	pm.carStatus.CarStatusData[1] = packets.CarStatusData{
		VisualTyreCompound:      16,
		TyresAgeLaps:            4,
		ERSStoreEnergy:          2_400_000,
		ERSDeployMode:           2,
		ERSDeployedThisLap:      260_000,
		ERSHarvestedThisLapMGUK: 40_000,
	}
	pm.carStatus.CarStatusData[3] = packets.CarStatusData{
		VisualTyreCompound:      17,
		TyresAgeLaps:            5,
		ERSStoreEnergy:          1_400_000,
		ERSDeployMode:           0,
		ERSDeployedThisLap:      20_000,
		ERSHarvestedThisLapMGUK: 60_000,
	}

	pm.sessionHistory[1] = qualifyingHistoryPacket(70_000, 30_080, 40_180)
	pm.sessionHistory[3] = qualifyingHistoryPacket(74_800, 31_000, 41_000)

	data := pm.BuildStrategyOverlayData(21_000, 2)
	if data == nil {
		t.Fatal("expected qualifying overlay data")
	}
	if data.Mode != "qualifying" {
		t.Fatalf("mode = %q, want qualifying", data.Mode)
	}
	if data.CarAhead == nil || data.CarAhead.Name != "Ahead Car" {
		t.Fatalf("car ahead = %+v, want Ahead Car", data.CarAhead)
	}
	if data.CarAhead.GapMeters != 150 {
		t.Fatalf("ahead gap = %d, want 150m", data.CarAhead.GapMeters)
	}
	if data.CarAhead.TryLabel != "TRY" {
		t.Fatalf("ahead try label = %q, want TRY", data.CarAhead.TryLabel)
	}
	if data.CarAhead.SectorDelta1 == nil || *data.CarAhead.SectorDelta1 != -130 {
		t.Fatalf("ahead S1 delta = %v, want -130", data.CarAhead.SectorDelta1)
	}
	if data.CarBehind == nil || data.CarBehind.Name != "Behind Car" {
		t.Fatalf("car behind = %+v, want Behind Car", data.CarBehind)
	}
	if data.CarBehind.TryLabel != "COOL" {
		t.Fatalf("behind try label = %q, want COOL", data.CarBehind.TryLabel)
	}
}

func qualifyingHistoryPacket(bestLap uint32, bestSector1 uint16, bestSector2 uint16) *packets.PacketSessionHistoryData {
	sector3 := bestLap - uint32(bestSector1) - uint32(bestSector2)
	return &packets.PacketSessionHistoryData{
		NumLaps:           1,
		BestLapTimeLapNum: 1,
		BestSector1LapNum: 1,
		BestSector2LapNum: 1,
		BestSector3LapNum: 1,
		LapHistoryData: [packets.MaxNumLapsInHistory]packets.LapHistoryData{
			{
				LapTimeInMS:       bestLap,
				Sector1TimeMSPart: bestSector1,
				Sector2TimeMSPart: bestSector2,
				Sector3TimeMSPart: uint16(sector3),
			},
		},
	}
}
