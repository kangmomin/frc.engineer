package telemetry

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
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

// TestBuildState24CarPayloadSize: 2026 모드(24대) 풀 데이터 PitwallState의 페이로드 크기 회귀 검증.
// (1) 트랙맵(다운샘플 2000pt)이 포함된 worst-case 메시지가 Chrome SCTP 수신 버퍼 하드 상한(256KB)을
// 넘지 않고, (2) 트랙맵 전송분 소진 후 정상 상태가 백프레셔 임계(maxBufferedAmount 128KB)를 넘지 않는지 확인.
// (CLAUDE.md: SCTP 256KB / maxBufferedAmount 128KB 제약)
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

	// 실제 트랙맵 포함 worst-case를 측정하기 위해 8000포인트 트랙을 주입한다
	// (다운샘플 상한 2000 초과 → stride 서브샘플이 실제로 동작하는 크기).
	trackStore := tracks.NewTrackStore(t.TempDir())
	trackStore.LoadSingle(session.TrackID, writeTrackLineCSV(t, 8000))

	pm := NewPitwallManager(NewStrategyManager(), trackStore, nil)
	pm.UpdateSession(session)
	pm.UpdateParticipants(participants)
	pm.UpdateLapData(lapData)
	pm.UpdateCarStatus(carStatus)
	pm.UpdateTelemetry(telemetry)
	pm.UpdateCarTelemetry2(carTelemetry2)
	pm.UpdateMotion(motion, 0)
	pm.UpdateCarDamage(carDamage)

	// 첫 BuildState는 트랙맵을 포함한다(트랙 변경 감지로 trackMapSendCount=8).
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
	if state.TrackMap == nil {
		t.Fatal("expected trackmap in first BuildState")
	}
	if n := len(state.TrackMap.Points); n == 0 || n > maxTrackMapPoints {
		t.Fatalf("trackmap points = %d, want 1..%d (downsample cap)", n, maxTrackMapPoints)
	}

	// (1) 트랙맵 포함 메시지가 SCTP 수신 버퍼 하드 상한(256KB)을 넘지 않아야 한다.
	withMap, err := dto.MsgpackMarshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(withMap) > 256*1024 {
		t.Fatalf("24-car + trackmap payload = %d bytes, exceeds 256KB SCTP limit", len(withMap))
	}
	t.Logf("24-car + %d-pt trackmap payload: %d bytes", len(state.TrackMap.Points), len(withMap))

	// (2) 트랙맵 전송분(8회)을 소진한 뒤의 정상 상태 페이로드는 128KB를 넘지 않아야 한다.
	var steady *dto.PitwallState
	for i := 0; i < 12; i++ {
		steady = pm.BuildState()
		if steady.TrackMap == nil {
			break
		}
	}
	if steady.TrackMap != nil {
		t.Fatal("expected trackmap sends to drain to steady state")
	}
	payload, err := dto.MsgpackMarshal(steady)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > 128*1024 {
		t.Fatalf("24-car steady payload = %d bytes, exceeds 128KB threshold", len(payload))
	}
	t.Logf("24-car steady payload: %d bytes", len(payload))
}

// writeTrackLineCSV는 n포인트 레이싱라인 CSV(loadCSV 포맷: 메타/헤더 2줄 스킵 후
// dist,pos_z,pos_x,pos_y,drs,sector)를 임시 파일에 쓰고 경로를 반환한다.
func writeTrackLineCSV(t *testing.T, n int) string {
	t.Helper()
	var b strings.Builder
	b.WriteString("meta\n")
	b.WriteString("dist,pos_z,pos_x,pos_y,drs,sector\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "%d,%.3f,%.3f,0,%d,%d\n", i, float64(i)*1.7, float64(i)*-2.3, i%2, i%3)
	}
	path := filepath.Join(t.TempDir(), "worstcase_racingline.txt")
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
