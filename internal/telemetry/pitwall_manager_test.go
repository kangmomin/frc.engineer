package telemetry

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// TestRecordPenaltyLogCapDedupAndReset verifies the per-car penalty log's
// out-of-range guard, consecutive-duplicate dedup, per-car cap, and SessionUID reset.
func TestRecordPenaltyLogCapDedupAndReset(t *testing.T) {
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: 111}
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.UpdateSession(&packets.PacketSessionData{Header: header, SessionType: 15})

	// Out-of-range vehicle index is ignored (no panic).
	pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 250, PenaltyType: 4}, 111)

	// Consecutive exact duplicate (UDP re-broadcast) is skipped.
	dup := &packets.PenaltyEvent{VehicleIdx: 3, PenaltyType: 4, InfringementType: 2, Time: 5, LapNum: 7}
	pm.RecordPenalty(dup, 111)
	pm.RecordPenalty(dup, 111)
	if got := len(pm.penaltyLog[3]); got != 1 {
		t.Fatalf("car 3 log len = %d, want 1 (duplicate skipped)", got)
	}

	// Cap: append well past the cap; oldest are dropped, newest kept.
	for j := 0; j < maxPenaltyLogPerCar+5; j++ {
		pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 5, PenaltyType: 4, InfringementType: uint8(j), LapNum: uint8(j)}, 111)
	}
	log := pm.penaltyLog[5]
	if len(log) != maxPenaltyLogPerCar {
		t.Fatalf("car 5 log len = %d, want cap %d", len(log), maxPenaltyLogPerCar)
	}
	if log[len(log)-1].Inf != maxPenaltyLogPerCar+4 {
		t.Fatalf("car 5 newest inf = %d, want %d (kept newest)", log[len(log)-1].Inf, maxPenaltyLogPerCar+4)
	}

	// Same-track session change (new SessionUID, trackID unchanged) clears the log.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 222}, SessionType: 10})
	if len(pm.penaltyLog[3]) != 0 || len(pm.penaltyLog[5]) != 0 {
		t.Fatal("penalty log must reset on SessionUID change")
	}
}

// TestRecordPenaltyTimeSentinelAndDedupWindow verifies (1) the uint8 Time "N/A"
// sentinel (255) is not surfaced as a 255-second penalty, and (2) the duplicate
// skip is windowed — a byte-identical entry outside penaltyDedupWindow is a second
// real penalty (e.g. two corner cuts on the same lap), not a UDP re-broadcast.
func TestRecordPenaltyTimeSentinelAndDedupWindow(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	now := time.Unix(1_000, 0)
	pm.now = func() time.Time { return now }

	pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 1, PenaltyType: 10, InfringementType: 25, Time: 255, LapNum: 4}, 111)
	if got := pm.penaltyLog[1][0].TimeSec; got != 0 {
		t.Fatalf("sentinel Time=255 stored as sec=%d, want 0", got)
	}

	// Identical entry within the window = UDP re-broadcast → skipped.
	e := &packets.PenaltyEvent{VehicleIdx: 2, PenaltyType: 5, InfringementType: 7, LapNum: 9}
	pm.RecordPenalty(e, 111)
	now = now.Add(50 * time.Millisecond)
	pm.RecordPenalty(e, 111)
	if got := len(pm.penaltyLog[2]); got != 1 {
		t.Fatalf("within-window duplicate logged: len = %d, want 1", got)
	}

	// Identical entry outside the window = a second real penalty → logged.
	now = now.Add(penaltyDedupWindow)
	pm.RecordPenalty(e, 111)
	if got := len(pm.penaltyLog[2]); got != 2 {
		t.Fatalf("out-of-window identical penalty dropped: len = %d, want 2", got)
	}
}

// TestRecordPenaltyBeforeFirstSessionPreserved covers the ordering where a PENA
// event is processed before the first Session packet: the log must survive the
// first (baseline) Session observation and only reset on a genuine UID change.
// A uid==0 Session packet must be ignored so it can't wipe the log.
func TestRecordPenaltyBeforeFirstSessionPreserved(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)

	// PENA arrives before any Session packet (lastSessionUID still 0). The event
	// carries its own session's UID (777), which seeds the baseline WITHOUT clearing.
	pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 4, PenaltyType: 4, InfringementType: 2, Time: 5, LapNum: 3}, 777)
	if got := len(pm.penaltyLog[4]); got != 1 {
		t.Fatalf("pre-session penalty len = %d, want 1", got)
	}

	// First Session packet (nonzero UID) sets the baseline WITHOUT clearing.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 777}, SessionType: 10})
	if got := len(pm.penaltyLog[4]); got != 1 {
		t.Fatalf("first Session packet must not clear same-session penalty: got %d, want 1", got)
	}

	// A spurious uid==0 Session packet is ignored — it must not wipe the log.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 0}, SessionType: 10})
	if got := len(pm.penaltyLog[4]); got != 1 {
		t.Fatalf("uid==0 Session packet must be ignored: got %d, want 1", got)
	}

	// A genuine session change (nonzero → different nonzero) clears.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 888}, SessionType: 15})
	if got := len(pm.penaltyLog[4]); got != 0 {
		t.Fatalf("genuine SessionUID change must clear the log: got %d, want 0", got)
	}
}

// TestRecordPenaltyNewSessionEventBeforeSessionPacket covers the residual window:
// session A's log is resident when a session B PENA lands BEFORE B's first Session
// packet. Because RecordPenalty observes the event's own SessionUID, it must clear
// A's stale log and keep B's penalty; B's later Session packet must then be a no-op.
func TestRecordPenaltyNewSessionEventBeforeSessionPacket(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)

	// Session A: establish a resident penalty log.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 100}, SessionType: 15})
	pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 2, PenaltyType: 4, InfringementType: 1, LapNum: 5}, 100)
	if got := len(pm.penaltyLog[2]); got != 1 {
		t.Fatalf("session A penalty len = %d, want 1", got)
	}

	// Session B's PENA arrives BEFORE B's first Session packet (out-of-order/reconnect).
	pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 6, PenaltyType: 4, InfringementType: 2, LapNum: 1}, 200)
	if got := len(pm.penaltyLog[2]); got != 0 {
		t.Fatalf("stale session A log must be cleared by the session B event: got %d, want 0", got)
	}
	if got := len(pm.penaltyLog[6]); got != 1 {
		t.Fatalf("session B penalty must be recorded: got %d, want 1", got)
	}

	// B's first Session packet (same UID) is now a no-op — it must not wipe B's penalty.
	pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 200}, SessionType: 10})
	if got := len(pm.penaltyLog[6]); got != 1 {
		t.Fatalf("B's Session packet must not clear B's own penalty: got %d, want 1", got)
	}
}

// TestBuildState24CarPayloadSize: 2026 모드(24대) 풀 데이터 WSResponse envelope의 페이로드 크기 회귀 검증.
// (1) 트랙맵(다운샘플 2000pt)이 포함된 worst-case 메시지가 Chrome SCTP 수신 버퍼 하드 상한(256KB)을
// 넘지 않고, (2) 트랙맵 전송분 소진 후 정상 상태가 백프레셔 임계(maxBufferedAmount 128KB)를 넘지 않는지 확인.
// (CLAUDE.md: SCTP 256KB / maxBufferedAmount 128KB 제약)
func TestBuildState24CarPayloadSize(t *testing.T) {
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, GameYear: 26, SessionUID: ^uint64(0)}

	session := &packets.PacketSessionData{
		Header:          header,
		Weather:         1,
		TotalLaps:       57,
		TrackLength:     5400,
		SessionType:     15,
		Formula:         13,
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
		lapData.LapData[i].ResultStatus = 2 // transmitted in every RTC view
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
	for i := 0; i < packets.MaxCars; i++ {
		history := &packets.PacketSessionHistoryData{
			Header: header, CarIdx: uint8(i), NumLaps: packets.MaxNumLapsInHistory,
			BestLapTimeLapNum: 100, BestSector1LapNum: 100, BestSector2LapNum: 100, BestSector3LapNum: 100,
		}
		for lap := range history.LapHistoryData {
			history.LapHistoryData[lap] = packets.LapHistoryData{
				LapTimeInMS: 210000, LapValidBitFlags: 15,
				Sector1TimeMinPart: 1, Sector1TimeMSPart: 10000,
				Sector2TimeMinPart: 1, Sector2TimeMSPart: 10000,
				Sector3TimeMinPart: 1, Sector3TimeMSPart: 10000,
			}
		}
		pm.UpdateSessionHistory(history)
	}

	// Worst-case penalty log: every car at the per-car cap, so the 128KB guard
	// covers the added field (msgpack, numeric codes — see PenaltyLogEntry).
	for i := 0; i < packets.MaxCars; i++ {
		for j := 0; j < maxPenaltyLogPerCar; j++ {
			pm.RecordPenalty(&packets.PenaltyEvent{
				VehicleIdx: uint8(i), PenaltyType: uint8(4), InfringementType: uint8(j), Time: 5, LapNum: uint8(j + 1),
			}, header.SessionUID)
		}
	}

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
	if state.Session.QualifyingGridSize != 24 || !state.Drivers[23].SessionHistoryAvailable || state.Drivers[23].BestSector1Ms == nil || *state.Drivers[23].BestSector1Ms != 70000 {
		t.Fatal("full history and grid metadata must be included in the payload fixture")
	}
	if state.TrackMap == nil {
		t.Fatal("expected trackmap in first BuildState")
	}
	if n := len(state.TrackMap.Points); n == 0 || n > maxTrackMapPoints {
		t.Fatalf("trackmap points = %d, want 1..%d (downsample cap)", n, maxTrackMapPoints)
	}
	// PenaltyLog must survive the full BuildState path, including applySourceVisibility
	// (which mutates a field whitelist in place and must not drop the penalty log).
	if got := len(state.Drivers[23].PenaltyLog); got != maxPenaltyLogPerCar {
		t.Fatalf("driver 23 penaltyLog dropped by BuildState/applySourceVisibility: got %d, want %d", got, maxPenaltyLogPerCar)
	}

	// (1) 실제 WSResponse envelope의 트랙맵 포함 메시지가 SCTP 수신 버퍼 하드 상한(256KB)을 넘지 않아야 한다.
	withMap, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: state,
	})
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
	payload, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: steady,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) > 128*1024 {
		t.Fatalf("24-car steady payload = %d bytes, exceeds 128KB threshold", len(payload))
	}
	t.Logf("24-car steady payload: %d bytes", len(payload))
}

func TestAnalysisTrackOutlineUsesRecordedWorldCentrelineWithoutLiveMutation(t *testing.T) {
	const trackID = 42
	store := tracks.NewTrackStore(t.TempDir())
	store.LoadSingle(trackID, writeTrackLineCSV(t, maxAnalysisTrackOutlinePoints+80))
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: 901, PlayerCarIndex: 0}
	pm := NewPitwallManager(NewStrategyManager(), store, nil)
	pm.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: trackID})

	before := pm.trackMapSendCount
	outline, capturedPoints := pm.AnalysisTrackOutline()
	if outline == nil || len(outline.Points) != maxAnalysisTrackOutlinePoints || capturedPoints != maxAnalysisTrackOutlinePoints+80 {
		t.Fatalf("analysis outline = %+v captured=%d, want %d retained / %d source", outline, capturedPoints, maxAnalysisTrackOutlinePoints, maxAnalysisTrackOutlinePoints+80)
	}
	if pm.trackMapSendCount != before {
		t.Fatalf("analysis snapshot mutated live track-map counter: %d -> %d", before, pm.trackMapSendCount)
	}
	for _, point := range outline.Points {
		if point[0] < outline.Bounds.MinX || point[0] > outline.Bounds.MaxX || point[1] < outline.Bounds.MinZ || point[1] > outline.Bounds.MaxZ {
			t.Fatalf("world point %v escapes bounds %+v", point, outline.Bounds)
		}
	}

	pm.UpdateLapData(&packets.PacketLapData{Header: header})
	pm.UpdateCarStatus(&packets.PacketCarStatusData{Header: header})
	pm.UpdateCarDamage(&packets.PacketCarDamageData{Header: header})
	pm.UpdateTyreSets(&packets.PacketTyreSetsData{Header: header, CarIdx: 0})
	pm.UpdateSessionHistory(&packets.PacketSessionHistoryData{Header: header, CarIdx: 0})
	provenance := pm.CaptureProvenance()
	if !provenance.LapDataObserved || !provenance.CarStatusObserved || !provenance.CarDamageObserved ||
		!provenance.TyreSetsObserved || !provenance.SessionHistoryObserved {
		t.Fatalf("raw source provenance = %+v, want all observed flags", provenance)
	}
}

func TestCaptureProvenanceUsesOnlyPlayerHistoryAndTyreSetPackets(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: 902, PlayerCarIndex: 0}
	pm.UpdateParticipants(&packets.PacketParticipantsData{Header: header, NumActiveCars: 2})
	pm.UpdateTyreSets(&packets.PacketTyreSetsData{Header: header, CarIdx: 1})
	pm.UpdateSessionHistory(&packets.PacketSessionHistoryData{Header: header, CarIdx: 1})
	if got := pm.CaptureProvenance(); got.TyreSetsObserved || got.SessionHistoryObserved {
		t.Fatalf("rival-only source provenance = %+v, want player flags false", got)
	}
	pm.UpdateTyreSets(&packets.PacketTyreSetsData{Header: header, CarIdx: 0})
	pm.UpdateSessionHistory(&packets.PacketSessionHistoryData{Header: header, CarIdx: 0})
	if got := pm.CaptureProvenance(); !got.TyreSetsObserved || !got.SessionHistoryObserved {
		t.Fatalf("player source provenance = %+v, want player flags true", got)
	}
}

func TestDriverIdentityRespectsNumActiveCars(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	participants := &packets.PacketParticipantsData{NumActiveCars: 22}
	participants.Participants[0].TeamID = 0
	copy(participants.Participants[0].Name[:], "Player")
	participants.Participants[22].TeamID = 7
	copy(participants.Participants[22].Name[:], "phantom")
	pm.UpdateParticipants(participants)
	if name, team := pm.GetDriverName(22), pm.GetDriverTeamID(22); name != "" || team != nil {
		t.Fatalf("inactive slot identity = %q/%v, want empty/nil", name, team)
	}
	team := pm.GetDriverTeamID(0)
	if team == nil || *team != 0 || pm.GetDriverName(0) != "Player" {
		t.Fatalf("active team zero identity lost: name=%q team=%v", pm.GetDriverName(0), team)
	}
}

func TestSessionResetClearsParticipantPrivacyBeforeNewParticipants(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	first := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: 100, PlayerCarIndex: 0}
	participants := &packets.PacketParticipantsData{Header: first, NumActiveCars: 2}
	copy(participants.Participants[1].Name[:], "Old Public Rival")
	participants.Participants[1].TeamID = 17
	participants.Participants[1].YourTelemetry = 1
	pm.UpdateParticipants(participants)
	if !pm.TelemetryAvailableForVehicle(1) {
		t.Fatal("pre-reset public rival should be available")
	}

	// A new session's telemetry and motion can arrive before its Participants
	// packet. They must not inherit the previous session's name/team/privacy bit.
	second := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: 200, PlayerCarIndex: 0}
	pm.UpdateTelemetry(&packets.PacketCarTelemetryData{Header: second})
	pm.UpdateMotion(&packets.PacketMotionData{Header: second}, 0)

	if name := pm.GetDriverName(1); name != "" {
		t.Fatalf("stale rival name after session reset = %q", name)
	}
	if team := pm.GetDriverTeamID(1); team != nil {
		t.Fatalf("stale rival team after session reset = %v", team)
	}
	if pm.TelemetryAvailableForVehicle(1) {
		t.Fatal("stale rival YourTelemetry leaked before new Participants packet")
	}
	if !pm.TelemetryAvailableForVehicle(0) {
		t.Fatal("current motion header's player must remain telemetry-available")
	}
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

// newPitMeasureManager seeds a 2-car session for measured pit-loss capture tests.
func newPitMeasureManager(t *testing.T, uid uint64) (*PitwallManager, packets.PacketHeader) {
	t.Helper()
	header := packets.PacketHeader{PacketFormat: packets.PacketFormat2026, GameYear: 26, SessionUID: uid}
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: 3, TrackLength: 5000})
	pm.UpdateParticipants(&packets.PacketParticipantsData{Header: header, NumActiveCars: 2})
	return pm, header
}

// pushLap stores one car-0 LapData frame (no BuildState — capture runs in BuildState).
func pushLap(pm *PitwallManager, h packets.PacketHeader, pitStatus uint8, laneMs, stopMs uint16, numStops uint8) {
	ld := &packets.PacketLapData{Header: h}
	ld.LapData[0].CarPosition = 1
	ld.LapData[0].PitStatus = pitStatus
	ld.LapData[0].PitLaneTimeInLaneInMS = laneMs
	ld.LapData[0].PitStopTimerInMS = stopMs
	ld.LapData[0].NumPitStops = numStops
	pm.UpdateLapData(ld)
}

// TestPitMeasureCapture exercises the measured pit-loss state machine (Fable C2/M2):
// exit-edge confirmation, drive-through exclusion, multi-stop cross-contamination
// guard, and session reset.
func TestPitMeasureCapture(t *testing.T) {
	pm, h := newPitMeasureManager(t, 1)
	frame := func(pitStatus uint8, laneMs, stopMs uint16, numStops uint8) dto.DriverInfo {
		pushLap(pm, h, pitStatus, laneMs, stopMs, numStops)
		return pm.BuildState().Drivers[0]
	}

	// One stop: confirm the observed max at the pit-exit down-edge (NumPitStops++).
	frame(0, 0, 0, 0)
	if d := frame(1, 5000, 2500, 0); d.MeasuredPitLaneMs != 0 {
		t.Fatalf("in-pit must not confirm yet: got %d", d.MeasuredPitLaneMs)
	}
	frame(1, 18000, 2500, 0) // accumulate observed lane dwell
	if d := frame(0, 0, 0, 1); d.MeasuredPitLaneMs != 18000 || d.MeasuredPitStopMs != 2500 {
		t.Fatalf("one-stop confirm: lane=%d stop=%d (want 18000/2500)", d.MeasuredPitLaneMs, d.MeasuredPitStopMs)
	}

	// Multi-stop: entry re-arms obs so stop 1's values don't leak into stop 2.
	frame(1, 4000, 2200, 1)
	frame(1, 15000, 2200, 1)
	if d := frame(0, 0, 0, 2); d.MeasuredPitLaneMs != 15000 || d.MeasuredPitStopMs != 2200 {
		t.Fatalf("multi-stop contamination: lane=%d stop=%d (want 15000/2200)", d.MeasuredPitLaneMs, d.MeasuredPitStopMs)
	}

	// Drive-through: lane traversed but NumPitStops unchanged → not confirmed.
	frame(1, 3000, 0, 2)
	if d := frame(0, 0, 0, 2); d.MeasuredPitLaneMs != 15000 {
		t.Fatalf("drive-through must not confirm: got %d (want 15000 retained)", d.MeasuredPitLaneMs)
	}

	// Session reset clears the capture.
	h2 := h
	h2.SessionUID = 2
	pm.UpdateSession(&packets.PacketSessionData{Header: h2, TrackID: 3, TrackLength: 5000})
	pushLap(pm, h2, 0, 0, 0, 0)
	if d := pm.BuildState().Drivers[0]; d.MeasuredPitLaneMs != 0 || d.MeasuredPitStopMs != 0 {
		t.Fatalf("session reset must clear: lane=%d stop=%d (want 0/0)", d.MeasuredPitLaneMs, d.MeasuredPitStopMs)
	}
}

// TestPitMeasureReadOnlyDoesNotMutate proves the RLock read path never mutates the
// capture state (Fable C1): the pit-exit down-edge must confirm only under BuildState.
func TestPitMeasureReadOnlyDoesNotMutate(t *testing.T) {
	pm, h := newPitMeasureManager(t, 1)

	pushLap(pm, h, 1, 12000, 3000, 0)
	pm.BuildState() // mutate: entry edge arms obs
	pushLap(pm, h, 1, 20000, 3000, 0)
	pm.BuildState()            // mutate: accumulate obs=20000
	pushLap(pm, h, 0, 0, 0, 1) // exit down-edge frame

	// Read-only build must NOT confirm the stop (no state write under RLock).
	if d := pm.BuildStateReadOnly().Drivers[0]; d.MeasuredPitLaneMs != 0 {
		t.Fatalf("BuildStateReadOnly must not confirm (C1): got %d", d.MeasuredPitLaneMs)
	}
	// A mutating build then confirms the same frame.
	if d := pm.BuildState().Drivers[0]; d.MeasuredPitLaneMs != 20000 {
		t.Fatalf("mutating build confirms: got %d (want 20000)", d.MeasuredPitLaneMs)
	}
}
