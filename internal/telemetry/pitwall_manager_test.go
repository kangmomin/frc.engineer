package telemetry

import (
	"fmt"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

func TestPitwallManagerBuildStateIncludesSenderState(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.SetSenderState(dto.SenderState{
		SaveFiles:       true,
		TrackRecording:  false,
		RaceStorageMode: "resultOnly",
	})

	state := pm.BuildState()
	if state == nil {
		t.Fatal("expected pitwall state")
	}
	if state.SenderState == nil {
		t.Fatal("expected sender state in pitwall snapshot")
	}
	if !state.SenderState.SaveFiles {
		t.Fatal("expected saveFiles to be true")
	}
	if state.SenderState.TrackRecording {
		t.Fatal("expected trackRecording to be false")
	}
	if state.SenderState.RaceStorageMode != "resultOnly" {
		t.Fatalf("expected raceStorageMode to be resultOnly, got %q", state.SenderState.RaceStorageMode)
	}
}

// TestBuildState24CarPayloadSize: 2026 모드(24대) 풀 데이터 PitwallState가
// WebRTC DataChannel 버퍼 임계(maxBufferedAmount 128KB)를 넘지 않는지 회귀 검증.
// (CLAUDE.md: Chrome SCTP 수신 버퍼 256KB 제약)
func TestBuildState24CarPayloadSize(t *testing.T) {
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, GameYear: 26}

	session := &packets.PacketSessionData{
		Header:          header,
		Weather:         1,
		TotalLaps:       57,
		TrackLength:     5400,
		SessionType:     15,
		TrackID:         42,
		NumMarshalZones: 21,
	}
	for i := range session.MarshalZones {
		session.MarshalZones[i] = packets.MarshalZone{ZoneStart: float32(i) / 21, ZoneFlag: 3}
	}
	session.NumWeatherForecastSamples = 64
	for i := range session.WeatherForecastSamples {
		session.WeatherForecastSamples[i] = packets.WeatherForecastSample{
			SessionType: 15, TimeOffset: uint8(i), Weather: 4,
			TrackTemperature: 38, AirTemperature: 25, RainPercentage: 80,
		}
	}

	participants := &packets.PacketParticipantsData{Header: header, NumActiveCars: 24}
	lapData := &packets.PacketLapData{Header: header}
	carStatus := &packets.PacketCarStatusData{Header: header}
	telemetry := &packets.PacketCarTelemetryData{Header: header}
	carTelemetry2 := &packets.PacketCarTelemetry2Data{Header: header}
	motion := &packets.PacketMotionData{Header: header}
	carDamage := &packets.PacketCarDamageData{Header: header}

	for i := 0; i < packets.MaxCars; i++ {
		copy(participants.Participants[i].Name[:], fmt.Sprintf("Driver Name %02d Long", i))
		participants.Participants[i].TeamID = 476 + uint16(i%11)
		participants.Participants[i].YourTelemetry = 1
		lapData.LapData[i].CarPosition = uint8(i + 1)
		lapData.LapData[i].CurrentLapNum = 30
		lapData.LapData[i].LastLapTimeInMS = 92345
		carStatus.CarStatusData[i].VisualTyreCompound = 17
		carStatus.CarStatusData[i].ERSStoreEnergy = 3_300_000
		telemetry.CarTelemetryData[i].Speed = 280
		telemetry.CarTelemetryData[i].TyresSurfaceTemperature = [4]uint8{95, 96, 97, 98}
		carTelemetry2.CarTelemetry2Data[i].OvertakeActive = 1
		carTelemetry2.CarTelemetry2Data[i].ActiveAeroMode = 1
		motion.CarMotionData[i].WorldPositionX = float32(i) * 11.3
		motion.CarMotionData[i].WorldPositionZ = float32(i) * -7.9
		carDamage.CarDamageData[i].TyresWear = [4]float32{45.5, 46.5, 47.5, 48.5}
		carDamage.CarDamageData[i].FrontLeftWingDamage = 20
	}

	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.UpdateSession(session)
	pm.UpdateParticipants(participants)
	pm.UpdateLapData(lapData)
	pm.UpdateCarStatus(carStatus)
	pm.UpdateTelemetry(telemetry)
	pm.UpdateCarTelemetry2(carTelemetry2)
	pm.UpdateMotion(motion, 0)
	pm.UpdateCarDamage(carDamage)

	state := pm.BuildState()
	if state == nil {
		t.Fatal("expected pitwall state")
	}
	if len(state.Drivers) != 24 {
		t.Fatalf("drivers = %d, want 24", len(state.Drivers))
	}
	if state.GameFormat != 2026 {
		t.Fatalf("gameFormat = %d, want 2026", state.GameFormat)
	}
	if !state.Drivers[23].OvertakeActive {
		t.Fatal("driver 23 overtakeActive must survive BuildState")
	}

	payload, err := dto.MsgpackMarshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > 128*1024 {
		t.Fatalf("24-car payload = %d bytes, exceeds 128KB threshold", len(payload))
	}
	t.Logf("24-car full payload: %d bytes", len(payload))
}
