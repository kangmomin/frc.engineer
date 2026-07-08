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
	if data.AroundMode != "" {
		t.Fatalf("around mode = %q, want empty (track mode)", data.AroundMode)
	}
}

// newThreatFallbackManager는 threat fallback 테스트 공통 셋업 — 플레이어(idx 0, P8)가
// 개러지(pit=1)라 on-track 필터에서 빠지는 상태를 만든다.
func newThreatFallbackManager(numActive uint8) *PitwallManager {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.playerIndex = 0
	pm.session = &packets.PacketSessionData{
		SessionType: uint8(packets.SessionQ2),
		TrackLength: 5000,
	}
	pm.participants = &packets.PacketParticipantsData{NumActiveCars: numActive}
	pm.lapData = &packets.PacketLapData{}
	pm.lapData.LapData[0] = packets.LapData{
		CarPosition:   8,
		CurrentLapNum: 6,
		PitStatus:     1, // 개러지 — on-track 필터 탈락
		LapDistance:   -1,
		DriverStatus:  0,
		ResultStatus:  2,
	}
	return pm
}

func TestBuildStrategyOverlayDataQualifyingThreatFallbackRanking(t *testing.T) {
	pm := newThreatFallbackManager(5)
	copy(pm.participants.Participants[0].Name[:], []byte("Player"))
	copy(pm.participants.Participants[1].Name[:], []byte("Flying Threat"))
	copy(pm.participants.Participants[2].Name[:], []byte("Inlap Threat"))
	copy(pm.participants.Participants[3].Name[:], []byte("Leader Flyer"))
	copy(pm.participants.Participants[4].Name[:], []byte("Outlap Threat"))

	// P12 플라잉(TRY/attack) — 포지션 위협 1순위 기대
	pm.lapData.LapData[1] = packets.LapData{
		CarPosition: 12, CurrentLapNum: 5, LapDistance: 1200, DriverStatus: 1, ResultStatus: 2,
	}
	// P10 인랩(COOL/standby) — 포지션 위협이지만 tone에서 밀림
	pm.lapData.LapData[2] = packets.LapData{
		CarPosition: 10, CurrentLapNum: 5, LapDistance: 900, DriverStatus: 2, ResultStatus: 2,
	}
	// P4 플라잉(TRY/attack) — 내 앞 순위라 비위협 그룹
	pm.lapData.LapData[3] = packets.LapData{
		CarPosition: 4, CurrentLapNum: 5, LapDistance: 3000, DriverStatus: 1, ResultStatus: 2,
	}
	// P15 아웃랩(BUILD/watch) — 포지션 위협 2순위 기대
	pm.lapData.LapData[4] = packets.LapData{
		CarPosition: 15, CurrentLapNum: 5, LapDistance: 400, DriverStatus: 3, ResultStatus: 2,
	}

	pm.carStatus = &packets.PacketCarStatusData{}
	// 플라잉 차량들에 aggressive ERS → TRY(attack) 확정
	pm.carStatus.CarStatusData[1] = packets.CarStatusData{ERSDeployMode: 3, ERSStoreEnergy: 2_400_000}
	pm.carStatus.CarStatusData[3] = packets.CarStatusData{ERSDeployMode: 3, ERSStoreEnergy: 2_400_000}

	pm.sessionHistory[0] = qualifyingHistoryPacket(72_000, 30_000, 41_000)
	pm.sessionHistory[1] = qualifyingHistoryPacket(72_500, 30_200, 41_100)

	data := pm.BuildStrategyOverlayData(21_000, 2)
	if data == nil {
		t.Fatal("expected qualifying overlay data")
	}
	if data.AroundMode != "threat" {
		t.Fatalf("around mode = %q, want threat", data.AroundMode)
	}
	if data.CarAhead == nil || data.CarAhead.Name != "Flying Threat" {
		t.Fatalf("threat slot 1 = %+v, want Flying Threat (positional+attack)", data.CarAhead)
	}
	if data.CarAhead.TryLabel != "TRY" {
		t.Fatalf("threat slot 1 try label = %q, want TRY", data.CarAhead.TryLabel)
	}
	if data.CarAhead.PaceDeltaMs != 500 {
		t.Fatalf("threat slot 1 pace delta = %v, want 500 (best 72.5 vs 72.0)", data.CarAhead.PaceDeltaMs)
	}
	if data.CarAhead.GapMeters != 0 {
		t.Fatalf("threat slot 1 gap meters = %d, want 0 (unset in threat mode)", data.CarAhead.GapMeters)
	}
	if data.CarBehind == nil || data.CarBehind.Name != "Outlap Threat" {
		t.Fatalf("threat slot 2 = %+v, want Outlap Threat (positional+watch beats standby and non-positional)", data.CarBehind)
	}
	if data.CarBehind.PaceDeltaMs != 0 {
		t.Fatalf("threat slot 2 pace delta = %v, want 0 sentinel (no best lap)", data.CarBehind.PaceDeltaMs)
	}
}

func TestBuildStrategyOverlayDataQualifyingThreatFallbackSingleCandidate(t *testing.T) {
	pm := newThreatFallbackManager(2)
	copy(pm.participants.Participants[1].Name[:], []byte("Solo Threat"))
	pm.lapData.LapData[1] = packets.LapData{
		CarPosition: 9, CurrentLapNum: 5, LapDistance: 800, DriverStatus: 1, ResultStatus: 2,
	}

	data := pm.BuildStrategyOverlayData(21_000, 2)
	if data == nil {
		t.Fatal("expected qualifying overlay data")
	}
	if data.AroundMode != "threat" {
		t.Fatalf("around mode = %q, want threat", data.AroundMode)
	}
	if data.CarAhead == nil || data.CarAhead.Name != "Solo Threat" {
		t.Fatalf("threat slot 1 = %+v, want Solo Threat", data.CarAhead)
	}
	if data.CarBehind != nil {
		t.Fatalf("threat slot 2 = %+v, want nil (single candidate)", data.CarBehind)
	}
}

func TestBuildStrategyOverlayDataQualifyingThreatFallbackNoCandidates(t *testing.T) {
	pm := newThreatFallbackManager(2)
	// 유일한 타 차량도 핏 → 후보 0대
	pm.lapData.LapData[1] = packets.LapData{
		CarPosition: 9, CurrentLapNum: 5, PitStatus: 1, LapDistance: -1, DriverStatus: 0, ResultStatus: 2,
	}

	data := pm.BuildStrategyOverlayData(21_000, 2)
	if data == nil {
		t.Fatal("expected qualifying overlay data")
	}
	if data.AroundMode != "" || data.CarAhead != nil || data.CarBehind != nil {
		t.Fatalf("want bare data with no threats, got mode=%q ahead=%+v behind=%+v",
			data.AroundMode, data.CarAhead, data.CarBehind)
	}
}

func TestBuildStrategyOverlayDataQualifyingThreatFallbackInvalidPlayer(t *testing.T) {
	pm := newThreatFallbackManager(2)
	pm.playerIndex = 255 // 관전/무플레이어 — sessionHistory 패닉 없이 빈 표시 유지
	pm.lapData.LapData[1] = packets.LapData{
		CarPosition: 9, CurrentLapNum: 5, LapDistance: 800, DriverStatus: 1, ResultStatus: 2,
	}

	data := pm.BuildStrategyOverlayData(21_000, 2)
	if data == nil {
		t.Fatal("expected qualifying overlay data")
	}
	if data.AroundMode != "" || data.CarAhead != nil || data.CarBehind != nil {
		t.Fatalf("want bare data for invalid player, got mode=%q ahead=%+v behind=%+v",
			data.AroundMode, data.CarAhead, data.CarBehind)
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
