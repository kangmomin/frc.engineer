package telemetry

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

const (
	trySectorMarginMs            = 250
	tryCombinedMarginMs          = 400
	recentCompetitiveLapMarginMs = 1_200
	ersDeployMarginJ             = 120_000
	tryMinERSPct                 = 18
	trySpeedSignalFloorKPH       = 240
	trySpeedSignalTrackFloorKPH  = 220
	trySpeedSignalTopMarginKPH   = 30
)

type qualifyingOverlayCar struct {
	idx                 int
	position            int
	lapNum              int
	lapDistance         float32
	pitStatus           int
	driverStatus        int
	resultStatus        int
	lapInvalid          bool
	name                string
	speedKPH            int
	topSpeedKPH         int
	drsActivated        bool
	lastLapMs           float32
	bestLapMs           float32
	tireCompound        string
	tireAge             int
	ersDeployMode       int
	ersDeployedThisLap  float32
	ersHarvestedThisLap float32
	ersActualPct        int
	ersActualReady      bool
	sector1TimeMs       int
	sector2TimeMs       int
	bestSector1Ms       int
	bestSector2Ms       int
}

type qualifyingTryState struct {
	Label          string
	Tone           string
	Summary        string
	Score          int
	SectorDelta1Ms *int
	SectorDelta2Ms *int
}

func isQualifyingOverlaySession(sessionType uint8) bool {
	return sessionType >= uint8(packets.SessionQ1) && sessionType <= uint8(packets.SessionOSSS)
}

func buildSectorDelta(currentMs int, bestMs int) *int {
	if currentMs <= 0 || bestMs <= 0 {
		return nil
	}
	delta := currentMs - bestMs
	return &delta
}

func hasCompetitiveSector(deltaMs *int) bool {
	return deltaMs != nil && *deltaMs <= trySectorMarginMs
}

func hasStrongSector(deltaMs *int) bool {
	return deltaMs != nil && *deltaMs <= 100
}

func formatSignedDelta(deltaMs int) string {
	seconds := math.Abs(float64(deltaMs)) / 1000.0
	sign := "+"
	if deltaMs <= 0 {
		sign = "-"
	}
	return fmt.Sprintf("%s%.3f", sign, seconds)
}

func buildTrySummary(parts []string) string {
	if len(parts) == 0 {
		return "No live push signal"
	}
	if len(parts) > 3 {
		parts = parts[:3]
	}
	return strings.Join(parts, " | ")
}

func overlayERSLabel(car qualifyingOverlayCar) string {
	switch car.ersDeployMode {
	case 3:
		return "ERS OVT"
	case 2:
		return "ERS HOT"
	case 1:
		return "ERS MED"
	default:
		if car.ersActualReady {
			return fmt.Sprintf("ERS %d%%", car.ersActualPct)
		}
		return ""
	}
}

func hasSpeedTrySignal(car qualifyingOverlayCar) bool {
	if car.speedKPH <= 0 {
		return false
	}

	threshold := trySpeedSignalFloorKPH
	if car.topSpeedKPH > 0 {
		threshold = car.topSpeedKPH - trySpeedSignalTopMarginKPH
		if threshold < trySpeedSignalTrackFloorKPH {
			threshold = trySpeedSignalTrackFloorKPH
		}
	}
	return car.speedKPH >= threshold
}

func evaluateQualifyingTryState(car qualifyingOverlayCar) qualifyingTryState {
	sectorDelta1Ms := buildSectorDelta(car.sector1TimeMs, car.bestSector1Ms)
	sectorDelta2Ms := buildSectorDelta(car.sector2TimeMs, car.bestSector2Ms)

	var combinedDeltaMs *int
	if sectorDelta1Ms != nil && sectorDelta2Ms != nil {
		combined := *sectorDelta1Ms + *sectorDelta2Ms
		combinedDeltaMs = &combined
	}

	competitiveSectorCount := 0
	strongSectorCount := 0
	for _, delta := range []*int{sectorDelta1Ms, sectorDelta2Ms} {
		if hasCompetitiveSector(delta) {
			competitiveSectorCount++
		}
		if hasStrongSector(delta) {
			strongSectorCount++
		}
	}

	isPit := car.pitStatus != 0
	isInvalid := car.lapInvalid
	isGarage := car.driverStatus == 0
	isInLap := car.driverStatus == 2
	isOutLap := car.driverStatus == 3
	isFlying := car.driverStatus == 1
	isTrack := car.driverStatus == 4

	hasDrsSignal := car.drsActivated
	hasSpeedSignal := hasSpeedTrySignal(car)
	hasAggressiveErsMode := car.ersDeployMode >= 2
	isDeployingErs := car.ersDeployedThisLap > 0 && car.ersDeployedThisLap >= car.ersHarvestedThisLap+ersDeployMarginJ
	hasUsableErs := !car.ersActualReady || car.ersActualPct >= tryMinERSPct
	recentCompetitiveLap := car.lastLapMs > 0 && car.bestLapMs > 0 && car.lastLapMs <= car.bestLapMs+recentCompetitiveLapMarginMs

	if isPit {
		return qualifyingTryState{
			Label:          "COOL",
			Tone:           "standby",
			Summary:        "In pit",
			Score:          -3,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}
	if isInvalid {
		return qualifyingTryState{
			Label:          "COOL",
			Tone:           "standby",
			Summary:        "Lap invalid",
			Score:          -3,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}
	if isGarage {
		return qualifyingTryState{
			Label:          "COOL",
			Tone:           "standby",
			Summary:        "Garage",
			Score:          -2,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}
	if isInLap {
		return qualifyingTryState{
			Label:          "COOL",
			Tone:           "standby",
			Summary:        "In lap",
			Score:          -1,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}

	score := 0
	if isFlying {
		score += 3
	} else if isTrack {
		score++
	} else if isOutLap {
		score--
	}

	if hasAggressiveErsMode && hasUsableErs {
		score += 2
	} else if isDeployingErs && hasUsableErs {
		score++
	}
	if hasDrsSignal {
		score++
	}
	if hasSpeedSignal {
		score++
	}
	score += competitiveSectorCount
	score += strongSectorCount
	if combinedDeltaMs != nil && *combinedDeltaMs <= tryCombinedMarginMs {
		score++
	}
	if recentCompetitiveLap {
		score++
	}

	positiveSignals := make([]string, 0, 5)
	if isFlying {
		positiveSignals = append(positiveSignals, "Flying")
	} else if isOutLap {
		positiveSignals = append(positiveSignals, "Out lap")
	}
	if ersLabel := overlayERSLabel(car); ersLabel != "" {
		positiveSignals = append(positiveSignals, ersLabel)
	}
	if hasDrsSignal {
		positiveSignals = append(positiveSignals, "DRS")
	}
	if hasSpeedSignal {
		positiveSignals = append(positiveSignals, fmt.Sprintf("%dkph", car.speedKPH))
	}

	if (isFlying && hasUsableErs && (hasAggressiveErsMode || isDeployingErs || hasDrsSignal || hasSpeedSignal || competitiveSectorCount > 0 || recentCompetitiveLap)) ||
		competitiveSectorCount >= 2 ||
		strongSectorCount >= 1 ||
		(combinedDeltaMs != nil && *combinedDeltaMs <= tryCombinedMarginMs && hasUsableErs && (hasDrsSignal || hasSpeedSignal || hasAggressiveErsMode || isDeployingErs)) {
		return qualifyingTryState{
			Label:          "TRY",
			Tone:           "attack",
			Summary:        buildTrySummary(positiveSignals),
			Score:          score,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}

	if isOutLap || (score >= 2 && hasUsableErs) {
		return qualifyingTryState{
			Label:          "BUILD",
			Tone:           "watch",
			Summary:        buildTrySummary(positiveSignals),
			Score:          score,
			SectorDelta1Ms: sectorDelta1Ms,
			SectorDelta2Ms: sectorDelta2Ms,
		}
	}

	return qualifyingTryState{
		Label:          "COOL",
		Tone:           "standby",
		Summary:        "No live push signal",
		Score:          score,
		SectorDelta1Ms: sectorDelta1Ms,
		SectorDelta2Ms: sectorDelta2Ms,
	}
}

func sessionHistoryBestLapMs(history *packets.PacketSessionHistoryData) float32 {
	if history == nil {
		return 0
	}
	lapNum := int(history.BestLapTimeLapNum)
	if lapNum <= 0 || lapNum > int(history.NumLaps) || lapNum > packets.MaxNumLapsInHistory {
		return 0
	}
	lapTime := history.LapHistoryData[lapNum-1].LapTimeInMS
	if lapTime <= 0 {
		return 0
	}
	return float32(lapTime)
}

func sessionHistoryBestSectorMs(history *packets.PacketSessionHistoryData, sector int) int {
	if history == nil {
		return 0
	}

	var lapNum int
	switch sector {
	case 1:
		lapNum = int(history.BestSector1LapNum)
	case 2:
		lapNum = int(history.BestSector2LapNum)
	case 3:
		lapNum = int(history.BestSector3LapNum)
	default:
		return 0
	}
	if lapNum <= 0 || lapNum > int(history.NumLaps) || lapNum > packets.MaxNumLapsInHistory {
		return 0
	}

	lap := history.LapHistoryData[lapNum-1]
	switch sector {
	case 1:
		return lap.Sector1Ms()
	case 2:
		return lap.Sector2Ms()
	case 3:
		return lap.Sector3Ms()
	default:
		return 0
	}
}

func (pm *PitwallManager) buildQualifyingOverlayDataLocked() *dto.StrategyOverlayData {
	playerIdx := int(pm.playerIndex)
	numCars := pm.effectiveNumCars()
	playerLap := 0
	playerPosition := 0
	if playerIdx >= 0 && playerIdx < numCars {
		playerLap = int(pm.lapData.LapData[playerIdx].CurrentLapNum)
		playerPosition = int(pm.lapData.LapData[playerIdx].CarPosition)
	}

	data := &dto.StrategyOverlayData{
		Mode:           "qualifying",
		SessionType:    sessionTypeString(pm.session.SessionType),
		PlayerPosition: playerPosition,
		PlayerLap:      playerLap,
		TotalLaps:      int(pm.session.TotalLaps),
		TrackID:        pm.session.TrackID,
	}

	if pm.session.TrackLength == 0 {
		return data
	}

	cars := make([]qualifyingOverlayCar, 0, numCars)
	for i := range numCars {
		ld := &pm.lapData.LapData[i]
		if ld.ResultStatus != 2 && ld.ResultStatus != 3 {
			continue
		}
		if ld.PitStatus != 0 || ld.LapDistance < 0 {
			continue
		}

		car := qualifyingOverlayCar{
			idx:           i,
			position:      int(ld.CarPosition),
			lapNum:        int(ld.CurrentLapNum),
			lapDistance:   sanitize(ld.LapDistance),
			pitStatus:     int(ld.PitStatus),
			driverStatus:  int(ld.DriverStatus),
			resultStatus:  int(ld.ResultStatus),
			lapInvalid:    ld.CurrentLapInvalid == 1,
			lastLapMs:     float32(ld.LastLapTimeInMS),
			topSpeedKPH:   int(math.Round(float64(sanitize(ld.SpeedTrapFastestSpeed)))),
			sector1TimeMs: int(ld.Sector1TimeMinutes)*60000 + int(ld.Sector1TimeInMS),
			sector2TimeMs: int(ld.Sector2TimeMinutes)*60000 + int(ld.Sector2TimeInMS),
		}

		if pm.participants != nil {
			car.name = pm.participants.Participants[i].GetName()
		}
		if car.name == "" {
			car.name = fmt.Sprintf("Driver %d", i)
		}
		if pm.telemetry != nil {
			ct := &pm.telemetry.CarTelemetryData[i]
			car.speedKPH = int(ct.Speed)
			car.drsActivated = ct.DRS != 0
		}
		if pm.carTelemetry2 != nil {
			// 2026 모드: Overtake(Manual Override)가 DRS 신호를 대체한다.
			car.drsActivated = car.drsActivated || pm.carTelemetry2.CarTelemetry2Data[i].OvertakeActive == 1
		}
		if pm.carStatus != nil {
			cs := &pm.carStatus.CarStatusData[i]
			car.tireCompound = tireCompoundString(cs.VisualTyreCompound)
			car.tireAge = int(cs.TyresAgeLaps)
			car.ersDeployMode = int(cs.ERSDeployMode)
			car.ersDeployedThisLap = sanitize(cs.ERSDeployedThisLap)
			car.ersHarvestedThisLap = sanitize(cs.ERSHarvestedThisLapMGUK + cs.ERSHarvestedThisLapMGUH)
			car.ersActualPct = ersPercent(cs.ERSStoreEnergy)
			car.ersActualReady = true
		}
		if history := pm.sessionHistory[i]; history != nil {
			car.bestLapMs = sessionHistoryBestLapMs(history)
			car.bestSector1Ms = sessionHistoryBestSectorMs(history, 1)
			car.bestSector2Ms = sessionHistoryBestSectorMs(history, 2)
		}
		cars = append(cars, car)
	}

	sort.Slice(cars, func(i, j int) bool { return cars[i].lapDistance < cars[j].lapDistance })

	playerPos := -1
	for i := range cars {
		if cars[i].idx == playerIdx {
			playerPos = i
			break
		}
	}
	// 플레이어가 트랙 밖(개러지/핏)이거나 주변에 차가 없으면 앞뒤차 대신
	// threat watch로 폴백한다 — 퀄리 막판 개러지 대기 중이 정확히 이 상태다.
	if playerPos == -1 || len(cars) < 2 {
		pm.fillQualifyingThreatsLocked(data, cars, playerIdx, playerPosition)
		return data
	}

	n := len(cars)
	trackLength := float64(pm.session.TrackLength)
	aheadIdx := (playerPos + 1) % n
	behindIdx := (playerPos - 1 + n) % n
	if aheadIdx != playerPos {
		gapMeters := int(math.Round(math.Mod(float64(cars[aheadIdx].lapDistance-cars[playerPos].lapDistance)+trackLength, trackLength)))
		data.CarAhead = buildQualifyingOverlayStrategyCar(cars[aheadIdx], gapMeters)
	}
	if behindIdx != playerPos {
		gapMeters := int(math.Round(math.Mod(float64(cars[playerPos].lapDistance-cars[behindIdx].lapDistance)+trackLength, trackLength)))
		data.CarBehind = buildQualifyingOverlayStrategyCar(cars[behindIdx], gapMeters)
	}

	return data
}

func buildQualifyingOverlayStrategyCar(car qualifyingOverlayCar, gapMeters int) *dto.StrategyCar {
	sc := newQualifyingStrategyCar(car, evaluateQualifyingTryState(car))
	sc.GapMeters = gapMeters
	return sc
}

func newQualifyingStrategyCar(car qualifyingOverlayCar, tryState qualifyingTryState) *dto.StrategyCar {
	return &dto.StrategyCar{
		Name:         car.name,
		Position:     car.position,
		TireCompound: car.tireCompound,
		TireAge:      car.tireAge,
		LastLapMs:    car.lastLapMs,
		SpeedKPH:     car.speedKPH,
		TryLabel:     tryState.Label,
		TryTone:      tryState.Tone,
		TrySummary:   tryState.Summary,
		TryScore:     tryState.Score,
		SectorDelta1: tryState.SectorDelta1Ms,
		SectorDelta2: tryState.SectorDelta2Ms,
	}
}

func qualifyingToneRank(tone string) int {
	switch tone {
	case "attack":
		return 0
	case "watch":
		return 1
	default:
		return 2
	}
}

// fillQualifyingThreatsLocked은 플레이어가 트랙 밖(개러지/핏)일 때 CarAhead/CarBehind
// 슬롯을 threat watch로 채운다(AroundMode="threat"). 랭킹: 포지션 위협(내 뒤 순위) 우선 →
// try tone(attack > watch > standby) → raw position 오름차순 → car index(결정적 tiebreak).
// 내 뒤 순위만 내 순위를 끌어내릴 수 있으므로 tone보다 포지션 위협이 먼저다. 뒤 차량이
// 전부 COOL이어도 표시한다 — "가장 가까운 라이벌이 안 밀고 있다"도 유효한 신호다.
// 웹 web/src/views/qualifying/derive/threatWatch.ts와 동일 의미(데이터 소스가 달라 동일
// 결과는 보장하지 않음).
func (pm *PitwallManager) fillQualifyingThreatsLocked(data *dto.StrategyOverlayData, cars []qualifyingOverlayCar, playerIdx, playerPosition int) {
	// playerIdx는 uint8 원본이라 255(관전 등)일 수 있다 — sessionHistory 고정 배열
	// 접근 전 반드시 범위 가드. 플레이어 순위를 모르면 위협 판정이 불가능하므로 빈 표시 유지.
	if playerIdx < 0 || playerIdx >= packets.MaxCars || playerPosition <= 0 {
		return
	}

	type rankedThreat struct {
		car qualifyingOverlayCar
		try qualifyingTryState
	}
	candidates := make([]rankedThreat, 0, len(cars))
	for _, car := range cars {
		if car.idx == playerIdx || car.position <= 0 {
			continue
		}
		candidates = append(candidates, rankedThreat{car: car, try: evaluateQualifyingTryState(car)})
	}
	if len(candidates) == 0 {
		return
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		aThreat := a.car.position > playerPosition
		bThreat := b.car.position > playerPosition
		if aThreat != bThreat {
			return aThreat
		}
		if ar, br := qualifyingToneRank(a.try.Tone), qualifyingToneRank(b.try.Tone); ar != br {
			return ar < br
		}
		if a.car.position != b.car.position {
			return a.car.position < b.car.position
		}
		return a.car.idx < b.car.idx
	})

	playerBestMs := sessionHistoryBestLapMs(pm.sessionHistory[playerIdx])
	threatCar := func(t rankedThreat) *dto.StrategyCar {
		sc := newQualifyingStrategyCar(t.car, t.try)
		if t.car.bestLapMs > 0 && playerBestMs > 0 {
			sc.PaceDeltaMs = t.car.bestLapMs - playerBestMs
		}
		return sc
	}

	data.AroundMode = "threat"
	data.CarAhead = threatCar(candidates[0])
	if len(candidates) > 1 {
		data.CarBehind = threatCar(candidates[1])
	}
}
