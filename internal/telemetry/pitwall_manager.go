package telemetry

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/telemetryvisibility"
	"frc.engineer/internal/tracks"
)

// sanitize replaces NaN/Inf float32 with 0
func sanitize(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

// PitwallManager aggregates data from multiple packet types into a unified PitwallState
type PitwallManager struct {
	mu sync.RWMutex

	session           *packets.PacketSessionData
	participants      *packets.PacketParticipantsData
	motion            *packets.PacketMotionData
	carStatus         *packets.PacketCarStatusData
	lapData           *packets.PacketLapData
	telemetry         *packets.PacketCarTelemetryData
	carTelemetry2     *packets.PacketCarTelemetry2Data // 2026 Season Pack 전용 (nil on F1 25)
	gameFormat        uint16                           // 마지막으로 수신한 packetFormat (2025/2026)
	carDamage         *packets.PacketCarDamageData
	carSetups         *packets.PacketCarSetupData
	tyreSets          [packets.MaxCars]*packets.PacketTyreSetsData
	sessionHistory    [packets.MaxCars]*packets.PacketSessionHistoryData
	motionEx          *packets.PacketMotionExData
	playerIndex       uint8
	strategyMgr       *StrategyManager
	trackStore        *tracks.TrackStore
	recorder          *TrackRecorder
	dynamicsAnalyzer  *DynamicsAnalyzer
	ersEstimator      *ERSEstimator
	ersActualEnabled  bool
	ersCompareEnabled bool
	senderState       *dto.SenderState
	trackMapSendCount int    // remaining broadcasts to include trackMap
	lastTrackID       int8   // last track ID for change detection
	peakActiveCars    int    // high-water mark for NumActiveCars
	lastSessionUID    uint64 // last session UID for per-session cache reset
	captureStartLap   int    // player's lap at first LapData of this session (0=unseen)
	// Raw source observation flags feed v2 completeness. They intentionally track
	// packet presence rather than normalized values, so an observed zero cannot be
	// mistaken for absent telemetry at upload/read time.
	lapDataObserved        bool
	sessionHistoryObserved bool
	carStatusObserved      bool
	carDamageObserved      bool
	tyreSetsObserved       bool

	// Per-car penalty/warning log for the leaderboard hover detail. Reset on
	// SessionUID change alongside the other per-session caches (noteSessionLocked).
	penaltyLog [packets.MaxCars][]dto.PenaltyLogEntry
	// Wall-clock of the last append per car — dedup window basis (RecordPenalty).
	penaltyLogAt [packets.MaxCars]time.Time
	// Per-car measured pit-stop capture. Reset on SessionUID change.
	pitMeasure [packets.MaxCars]pitMeasureState
	// Injectable clock for tests; NewPitwallManager sets time.Now.
	now func() time.Time
}

// pitMeasureState는 완료된 피트스톱의 실측 레인/정지 시간을 프레임 간 유지한다.
// 라이브 PitLaneTime/PitStopTimer(둘 다 uint16 소스, ≤65535ms)는 피트 중 실시간 값이라
// 진출 후 리셋되므로, 피트 중 관찰 최댓값을 모으다 레인 진출(PitStatus>0→0 하강 에지)에서
// 확정한다. 진입 상승 에지 이후 어느 시점에 NumPitStops가 증가하든(박스 정차/릴리스/진출)
// 하강 에지가 풀 체류를 관찰한 뒤에 잡는다(Fable C2).
type pitMeasureState struct {
	lastLaneMs int  // 마지막 완료 스톱의 레인 체류(ms)
	lastStopMs int  // 마지막 완료 스톱의 정지 작업(ms)
	obsLaneMs  int  // 진행 중 스톱의 레인 관찰 최댓값
	obsStopMs  int  // 진행 중 스톱의 정지 관찰 최댓값
	inPit      bool // 직전 프레임 피트 여부(진입/진출 에지 감지)
	entryStops int  // 진입 시점 NumPitStops(진출 시 정비 스톱 여부 판정 — drive-through 배제)
}

// maxTrackMapPoints bounds the trackMap point count so a long recorded lap can
// never push the WebRTC DataChannel payload past Chrome's 256KB SCTP receive buffer.
const maxTrackMapPoints = 2000

// maxAnalysisTrackOutlinePoints is independent from the live TrackMap cap. The
// analysis payload needs a small actual centreline that can safely coexist with
// 24-car incident clips under the HTTP budget; this accessor never consumes the
// live broadcast track-map send counter.
const maxAnalysisTrackOutlinePoints = 256

// downsampleStride returns the sampling stride needed to keep n points at or under max.
func downsampleStride(n, max int) int {
	if max <= 0 || n <= max {
		return 1
	}
	return (n + max - 1) / max
}

// maxPenaltyLogPerCar caps the per-car penalty log; on overflow the oldest entry
// is dropped. 16 comfortably covers a messy race while bounding the payload.
const maxPenaltyLogPerCar = 16

// penaltyDedupWindow bounds the consecutive-duplicate skip in RecordPenalty: only
// an identical entry arriving within this window is treated as a UDP re-broadcast.
// Outside it, a byte-identical entry is a genuinely repeated penalty (e.g. two
// corner cuts on the same lap) and must be logged.
const penaltyDedupWindow = 2 * time.Second

// NewPitwallManager creates a new PitwallManager
func NewPitwallManager(strategyMgr *StrategyManager, trackStore *tracks.TrackStore, recorder *TrackRecorder) *PitwallManager {
	return &PitwallManager{
		strategyMgr:      strategyMgr,
		trackStore:       trackStore,
		recorder:         recorder,
		dynamicsAnalyzer: NewDynamicsAnalyzer(),
		ersEstimator:     NewERSEstimator(trackStore),
		lastTrackID:      -1, // Melbourne(TrackID 0)과의 제로값 충돌 방지
		now:              time.Now,
	}
}

// SetRecorder sets the track recorder
func (pm *PitwallManager) SetRecorder(r *TrackRecorder) {
	pm.mu.Lock()
	pm.recorder = r
	pm.mu.Unlock()
}

// SetERSComparisonEnabled toggles sending actual-vs-estimate comparison fields.
func (pm *PitwallManager) SetERSComparisonEnabled(enabled bool) {
	pm.mu.Lock()
	pm.ersCompareEnabled = enabled
	pm.mu.Unlock()
}

// SetERSActualEnabled toggles population of actual ERS fields for downstream filtering.
func (pm *PitwallManager) SetERSActualEnabled(enabled bool) {
	pm.mu.Lock()
	pm.ersActualEnabled = enabled
	pm.mu.Unlock()
}

// SetSenderState publishes sender-owned runtime flags into the pitwall snapshot.
func (pm *PitwallManager) SetSenderState(state dto.SenderState) {
	pm.mu.Lock()
	stateCopy := state
	pm.senderState = &stateCopy
	pm.mu.Unlock()
}

// ResendTrackMap forces trackMap to be included in the next few broadcasts.
// Call this when a new peer connects so they receive the track outline.
func (pm *PitwallManager) ResendTrackMap() {
	pm.mu.Lock()
	pm.trackMapSendCount = 8
	pm.mu.Unlock()
}

// ObserveSession observes the header even for events without a dedicated cache
// update (SSTA/SEND, for example). Call after finalizing the previous session.
func (pm *PitwallManager) ObserveSession(header *packets.PacketHeader) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.noteSessionLocked(header)
}

// UpdateSession stores the latest session packet
func (pm *PitwallManager) UpdateSession(s *packets.PacketSessionData) {
	pm.mu.Lock()
	if pm.session == nil || pm.session.SessionType != s.SessionType {
		fmt.Printf("[DEBUG] Session: type=%d timeLeft=%d duration=%d\n",
			s.SessionType, s.SessionTimeLeft, s.SessionDuration)
	}
	pm.noteSessionLocked(&s.Header)
	pm.session = s
	pm.noteFormatLocked(s.Header.PacketFormat)
	pm.mu.Unlock()
}

// RecordPenalty appends a penalty/warning event to the offending car's log for the
// leaderboard hover detail. Called from the event processor with the event packet's
// own SessionUID, so a PENA belonging to a new session that arrives before that
// session's first Session packet resets the stale log itself (see
// noteSessionUIDLocked). Consecutive exact duplicates (UDP re-broadcasts) are
// skipped; the log is capped per car.
func (pm *PitwallManager) RecordPenalty(e *packets.PenaltyEvent, sessionUID uint64) {
	if e == nil || int(e.VehicleIdx) >= packets.MaxCars {
		return
	}
	timeSec := int(e.Time)
	if timeSec == 255 {
		// uint8 "N/A" sentinel (OtherVehicleIdx의 255=none과 동일 관례) — 랩 무효화/
		// 경고류에 실리는 값이라 255초 타임페널티로 오표기하지 않도록 0(없음) 처리.
		timeSec = 0
	}
	entry := dto.PenaltyLogEntry{
		Lap:     int(e.LapNum),
		Pen:     int(e.PenaltyType),
		Inf:     int(e.InfringementType),
		TimeSec: timeSec,
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()
	// Observe the session boundary before reading the slice — a genuine UID change
	// clears penaltyLog, so `log` must be read after the potential reset.
	pm.noteSessionUIDLocked(sessionUID)
	log := pm.penaltyLog[e.VehicleIdx]
	// Byte-identical fields alone can't distinguish a UDP re-broadcast from a second
	// real penalty of the same type on the same lap — only skip when the identical
	// entry also arrives within the dedup window.
	if n := len(log); n > 0 && log[n-1] == entry && pm.now().Sub(pm.penaltyLogAt[e.VehicleIdx]) < penaltyDedupWindow {
		return
	}
	log = append(log, entry)
	if len(log) > maxPenaltyLogPerCar {
		log = log[len(log)-maxPenaltyLogPerCar:]
	}
	pm.penaltyLog[e.VehicleIdx] = log
	pm.penaltyLogAt[e.VehicleIdx] = pm.now()
}

// noteFormatLocked tracks the active packetFormat and clears format-specific
// caches when the game switches UDP mode (25↔26) — 이전 포맷의 CT2/고수위가
// 새 세션을 오염시키지 않게 한다. pm.mu 보유 상태에서 호출할 것.
func (pm *PitwallManager) noteFormatLocked(format uint16) {
	if pm.gameFormat != 0 && pm.gameFormat != format {
		pm.carTelemetry2 = nil
		pm.peakActiveCars = 0
	}
	pm.gameFormat = format
}

// noteSessionLocked tracks the active session UID and clears per-session caches
// when a new session begins — 이전 세션의 tyre set/히스토리/고수위가 새 세션을
// 오염시키지 않게 한다 (ERSEstimator.resetSession의 매니저 측 미러).
// pm.mu 보유 상태에서 호출할 것.
func (pm *PitwallManager) noteSessionLocked(header *packets.PacketHeader) {
	if header == nil {
		return
	}
	pm.noteSessionUIDLocked(header.SessionUID)
	if header.PacketFormat != 0 {
		pm.noteFormatLocked(header.PacketFormat)
	}
	pm.playerIndex = header.PlayerCarIndex
}

// noteSessionUIDLocked is the SessionUID-keyed core of noteSessionLocked. Both the
// packet paths (via noteSessionLocked) and the event path (RecordPenalty) funnel
// through it, so a session change detected from ANY source clears the per-session
// caches — including the penalty log. The first observation (lastSessionUID==0)
// only seeds the baseline WITHOUT clearing, so a PENA that arrived before its
// session's first packet is preserved. uid==0 (unset/replay artifact) is ignored
// so it can't wipe state. Caller must hold pm.mu.
func (pm *PitwallManager) noteSessionUIDLocked(uid uint64) {
	if uid == 0 {
		return
	}
	if pm.lastSessionUID != 0 && pm.lastSessionUID != uid {
		pm.session = nil
		pm.motion = nil
		pm.telemetry = nil
		pm.carTelemetry2 = nil
		pm.carDamage = nil
		pm.carSetups = nil
		pm.motionEx = nil
		pm.playerIndex = 0
		pm.gameFormat = 0
		pm.trackMapSendCount = 0
		pm.ersEstimator = NewERSEstimator(pm.trackStore)
		// Participants carries identity and per-car telemetry permission. It must
		// never bridge a session boundary: Motion/Telemetry commonly arrive before
		// the new Participants packet, and retaining this pointer would leak a
		// prior rival's name, team, or YourTelemetry bit into a new clip.
		pm.participants = nil
		// Strategy updates require a status/lap pair from this session. Otherwise
		// the first arriving packet can seed new history with the previous race.
		pm.carStatus = nil
		pm.lapData = nil
		pm.strategyMgr.Reset()
		pm.tyreSets = [packets.MaxCars]*packets.PacketTyreSetsData{}
		pm.sessionHistory = [packets.MaxCars]*packets.PacketSessionHistoryData{}
		pm.peakActiveCars = 0
		pm.lastTrackID = -1 // 다음 BuildState에서 트랙맵 재전송 트리거
		pm.dynamicsAnalyzer.Reset()
		pm.penaltyLog = [packets.MaxCars][]dto.PenaltyLogEntry{}
		pm.penaltyLogAt = [packets.MaxCars]time.Time{}
		pm.pitMeasure = [packets.MaxCars]pitMeasureState{}
		pm.captureStartLap = 0
		pm.lapDataObserved = false
		pm.sessionHistoryObserved = false
		pm.carStatusObserved = false
		pm.carDamageObserved = false
		pm.tyreSetsObserved = false
	}
	pm.lastSessionUID = uid
}

// ResetDynamics clears per-session dynamics accumulation.
// 세션 UID 변경 시 processor의 raceSummary 리셋과 함께 호출된다.
// UpdateParticipants stores the latest participants packet
func (pm *PitwallManager) UpdateParticipants(p *packets.PacketParticipantsData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&p.Header)
	pm.participants = p
	if active := int(p.NumActiveCars); active > pm.peakActiveCars {
		pm.peakActiveCars = active
	}
	pm.mu.Unlock()
}

// UpdateMotion stores the latest motion packet and feeds track recorder
func (pm *PitwallManager) UpdateMotion(m *packets.PacketMotionData, playerIndex uint8) {
	pm.mu.Lock()
	pm.noteSessionLocked(&m.Header)
	pm.motion = m
	pm.playerIndex = playerIndex

	// Capture recorder inputs under lock, call recorder outside lock
	var rec *TrackRecorder
	var trackID int8
	var trackName string
	var trackLength uint16
	var lapDist float32
	var lapNum uint8
	var wx, wy, wz float32
	var drs, sector int

	if pm.session != nil && pm.lapData != nil && int(playerIndex) < packets.MaxCars {
		idx := int(playerIndex)
		car := &m.CarMotionData[idx]
		ld := &pm.lapData.LapData[idx]

		if pm.recorder != nil {
			rec = pm.recorder
			trackID = pm.session.TrackID
			trackName = tracks.TrackName(trackID)
			trackLength = pm.session.TrackLength
			lapDist = ld.LapDistance
			lapNum = ld.CurrentLapNum
			wx = car.WorldPositionX
			wy = car.WorldPositionY
			wz = car.WorldPositionZ
			sector = int(ld.Sector)

			if pm.carTelemetry2 != nil {
				// 2026 모드: DRS 폐지. Active Aero X-mode(직선 저드래그)를 고속
				// 구간 플래그로 기록해 트랙맵/ERS 프로파일의 의미를 유지한다.
				if pm.carTelemetry2.CarTelemetry2Data[idx].ActiveAeroMode == 1 {
					drs = 1
				}
			} else if pm.telemetry != nil {
				drs = int(pm.telemetry.CarTelemetryData[idx].DRS)
			}
		}

		// Feed dynamics analyzer (under lock since it modifies state)
		if pm.telemetry != nil {
			tel := &pm.telemetry.CarTelemetryData[idx]
			pm.dynamicsAnalyzer.ProcessFrame(
				car.WorldVelocityX, car.WorldVelocityZ, car.Yaw,
				tel.Speed, tel.Steer, tel.Brake,
				ld.CurrentLapNum,
			)

		}
	}

	pm.mu.Unlock()

	if rec != nil {
		rec.RecordPoint(m.Header.SessionUID, trackID, trackName, trackLength, lapDist, lapNum, wx, wy, wz, drs, sector)
	}
}

// UpdateMotionEx stores the latest motion ex packet
func (pm *PitwallManager) UpdateMotionEx(m *packets.PacketMotionExData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&m.Header)
	pm.motionEx = m
	pm.mu.Unlock()
}

// UpdateCarStatus stores the latest car status packet and updates strategy tracking
func (pm *PitwallManager) UpdateCarStatus(cs *packets.PacketCarStatusData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&cs.Header)
	pm.carStatus = cs
	pm.carStatusObserved = true
	lapData := pm.lapData
	pm.mu.Unlock()
	pm.strategyMgr.Update(cs, lapData)
}

// UpdateLapData stores the latest lap data (all 22 cars) for position/timing
func (pm *PitwallManager) UpdateLapData(ld *packets.PacketLapData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&ld.Header)
	pm.lapData = ld
	pm.lapDataObserved = true
	// 세션 첫 LapData에서 캡처 시작 랩을 고정. 헤더의 PlayerCarIndex를 쓴다 —
	// pm.playerIndex는 Motion 미수신 시 0 (EventCollision 경로와 동일 근거).
	if pm.captureStartLap == 0 {
		if idx := int(ld.Header.PlayerCarIndex); idx < packets.MaxCars {
			if lap := int(ld.LapData[idx].CurrentLapNum); lap > 0 {
				pm.captureStartLap = lap
			}
		}
	}
	carStatus := pm.carStatus
	pm.mu.Unlock()
	pm.strategyMgr.Update(carStatus, ld)
}

// UpdateTelemetry stores the latest telemetry packet (for tire temps)
func (pm *PitwallManager) UpdateTelemetry(t *packets.PacketCarTelemetryData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&t.Header)
	pm.telemetry = t
	pm.noteFormatLocked(t.Header.PacketFormat)
	pm.mu.Unlock()
}

// UpdateCarTelemetry2 stores the latest Car Telemetry 2 packet
// (2026 Season Pack: Active Aero / Overtake state).
func (pm *PitwallManager) UpdateCarTelemetry2(t *packets.PacketCarTelemetry2Data) {
	pm.mu.Lock()
	pm.noteSessionLocked(&t.Header)
	pm.noteFormatLocked(t.Header.PacketFormat)
	pm.carTelemetry2 = t
	pm.mu.Unlock()
}

// UpdateCarSetups stores the latest car setups packet
func (pm *PitwallManager) UpdateCarSetups(cs *packets.PacketCarSetupData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&cs.Header)
	pm.carSetups = cs
	pm.mu.Unlock()
}

// UpdateCarDamage stores the latest car damage packet and feeds per-car tyre wear
// into the strategy manager's stint tracking (peak wear per stint).
func (pm *PitwallManager) UpdateCarDamage(cd *packets.PacketCarDamageData) {
	pm.mu.Lock()
	pm.noteSessionLocked(&cd.Header)
	pm.carDamage = cd
	pm.carDamageObserved = true
	pm.mu.Unlock()
	pm.strategyMgr.UpdateTyreWear(cd)
}

// UpdateTyreSets stores the latest tyre sets packet for a specific car
func (pm *PitwallManager) UpdateTyreSets(ts *packets.PacketTyreSetsData) {
	if int(ts.CarIdx) >= packets.MaxCars {
		return
	}
	pm.mu.Lock()
	pm.noteSessionLocked(&ts.Header)
	pm.tyreSets[ts.CarIdx] = ts
	if int(ts.CarIdx) == int(ts.Header.PlayerCarIndex) {
		pm.tyreSetsObserved = true
	}
	pm.mu.Unlock()
}

// UpdateSessionHistory stores the latest session history packet for a specific car
func (pm *PitwallManager) UpdateSessionHistory(sh *packets.PacketSessionHistoryData) {
	if int(sh.CarIdx) >= packets.MaxCars {
		return
	}
	pm.mu.Lock()
	pm.noteSessionLocked(&sh.Header)
	pm.sessionHistory[sh.CarIdx] = sh
	if int(sh.CarIdx) == int(sh.Header.PlayerCarIndex) {
		pm.sessionHistoryObserved = true
	}
	pm.mu.Unlock()
}

// BuildState constructs the PitwallState DTO from all cached packet data.
// buildStateLocked이 trackMapSendCount/peakActiveCars 등을 변이하므로 배타 락이 필요하다.
func (pm *PitwallManager) BuildState() *dto.PitwallState {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	return pm.buildStateLocked(pm.sourceVisibilityMode(), true, true)
}

// BuildStateReadOnly constructs the PitwallState DTO without mutating any manager
// state (trackMapSendCount/lastTrackID/peakActiveCars/ersEstimator). HTTP/debug
// 조회 경로용 — 브로드캐스트 상태 머신을 건드리지 않는다.
func (pm *PitwallManager) BuildStateReadOnly() *dto.PitwallState {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	return pm.buildStateLocked(pm.sourceVisibilityMode(), true, false)
}

// BuildReplayState constructs a replay-friendly PitwallState with public visibility.
func (pm *PitwallManager) BuildReplayState() *dto.PitwallState {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	return pm.buildStateLocked(telemetryvisibility.ModePublic, false, true)
}

// buildStateLocked assembles the snapshot. mutate=false는 읽기 전용 경로로,
// 상태 변이(트랙맵 카운터/고수위/ERS 추정 진행) 없이 현재 값만 읽는다.
func (pm *PitwallManager) buildStateLocked(visibilityMode telemetryvisibility.Mode, includeTrackMap bool, mutate bool) *dto.PitwallState {
	state := &dto.PitwallState{
		PlayerIndex:          int(pm.playerIndex),
		GameFormat:           int(pm.gameFormat),
		ERSEstimateEnabled:   true, // broadcaster filters per-peer via ViewERSEstimate
		ERSComparisonEnabled: pm.ersCompareEnabled,
	}
	if pm.lastSessionUID != 0 {
		state.SessionUID = strconv.FormatUint(pm.lastSessionUID, 10)
	}
	if pm.senderState != nil {
		senderStateCopy := *pm.senderState
		state.SenderState = &senderStateCopy
	}

	// Session info
	if pm.session != nil {
		si := &dto.SessionInfo{
			Formula:                pm.session.Formula,
			SessionUID:             state.SessionUID,
			Weather:                weatherString(pm.session.Weather),
			TrackTemp:              float32(pm.session.TrackTemperature),
			AirTemp:                float32(pm.session.AirTemperature),
			SafetyCar:              safetyCarString(pm.session.SafetyCarStatus),
			SessionType:            sessionTypeString(pm.session.SessionType),
			TotalLaps:              int(pm.session.TotalLaps),
			SessionTimeLeft:        int(pm.session.SessionTimeLeft),
			SessionDuration:        int(pm.session.SessionDuration),
			TrackID:                pm.session.TrackID,
			TrackName:              tracks.TrackName(pm.session.TrackID),
			TrackLength:            int(pm.session.TrackLength),
			PitStopWindowIdealLap:  int(pm.session.PitStopWindowIdealLap),
			PitStopWindowLatestLap: int(pm.session.PitStopWindowLatestLap),
			PitStopRejoinPosition:  int(pm.session.PitStopRejoinPosition),
		}
		// A reduced Q2/Q3 field cannot establish the original roster. Only
		// observed full standard F1 fields justify a knockout format.
		if pm.session.Formula == 0 || pm.session.Formula == 13 {
			switch pm.peakActiveCars {
			case 20, 22, 24:
				si.QualifyingGridSize = pm.peakActiveCars
			}
		}
		numZones := int(pm.session.NumMarshalZones)
		if numZones > 21 {
			numZones = 21
		}
		if numZones > 0 {
			si.MarshalZones = make([]dto.MarshalZoneDTO, numZones)
			for i := range numZones {
				mz := &pm.session.MarshalZones[i]
				si.MarshalZones[i] = dto.MarshalZoneDTO{
					Start: mz.ZoneStart,
					Flag:  mz.ZoneFlag,
				}
			}
		}
		// Weather forecast samples — current session only
		numForecast := int(pm.session.NumWeatherForecastSamples)
		if numForecast > 64 {
			numForecast = 64
		}
		if numForecast > 0 {
			forecasts := make([]dto.WeatherForecastDTO, 0, numForecast)
			for i := range numForecast {
				fs := &pm.session.WeatherForecastSamples[i]
				if fs.SessionType != pm.session.SessionType {
					continue
				}
				forecasts = append(forecasts, dto.WeatherForecastDTO{
					SessionType:     sessionTypeString(fs.SessionType),
					TimeOffset:      int(fs.TimeOffset),
					Weather:         weatherString(fs.Weather),
					TrackTemp:       float32(fs.TrackTemperature),
					TrackTempChange: int(fs.TrackTemperatureChange),
					AirTemp:         float32(fs.AirTemperature),
					AirTempChange:   int(fs.AirTemperatureChange),
					RainPercentage:  int(fs.RainPercentage),
				})
			}
			if len(forecasts) > 0 {
				si.WeatherForecast = forecasts
			}
		}
		prediction := pm.strategyMgr.GetCrossoverPrediction()
		if prediction.Available || prediction.Reason != "" {
			si.CrossoverPrediction = &dto.CrossoverPredictionDTO{
				Available:          prediction.Available,
				DryGroup:           prediction.DryGroup,
				WetGroup:           prediction.WetGroup,
				CurrentDeltaMS:     prediction.CurrentDeltaMS,
				TrendDeltaMSPerLap: prediction.TrendDeltaMSPerLap,
				AvgLapTimeMS:       prediction.AvgLapTimeMS,
				DrySampleCount:     prediction.DrySampleCount,
				WetSampleCount:     prediction.WetSampleCount,
				HistoryDepth:       prediction.HistoryDepth,
				CurrentDryAvgMS:    prediction.CurrentDryAvgMS,
				CurrentWetAvgMS:    prediction.CurrentWetAvgMS,
				Reason:             prediction.Reason,
			}
		}
		state.Session = si
	}

	// Track map from pre-loaded CSV data (included for first 8 broadcasts per track change)
	if includeTrackMap && pm.session != nil && pm.trackStore != nil {
		currentTrackID := pm.session.TrackID
		if mutate && int8(currentTrackID) != pm.lastTrackID {
			pm.lastTrackID = int8(currentTrackID)
			pm.trackMapSendCount = 8 // ~2 seconds at 4Hz
		}
		if pm.trackMapSendCount > 0 {
			if td := pm.trackStore.Get(currentTrackID); td != nil {
				// 긴 랩 녹화 파일도 페이로드가 256KB를 넘지 않게 stride 서브샘플
				stride := downsampleStride(len(td.Points), maxTrackMapPoints)
				state.TrackMap = &dto.TrackMapDTO{
					Points: make([]dto.TrackPointDTO, 0, (len(td.Points)+stride-1)/stride),
					MinX:   td.MinX,
					MaxX:   td.MaxX,
					MinZ:   td.MinZ,
					MaxZ:   td.MaxZ,
				}
				for i := 0; i < len(td.Points); i += stride {
					p := td.Points[i]
					state.TrackMap.Points = append(state.TrackMap.Points, dto.TrackPointDTO{
						X:      p.X,
						Z:      p.Z,
						Sector: p.Sector,
						DRS:    p.DRS,
					})
				}
			}
			if mutate {
				pm.trackMapSendCount--
			}
		}
	}

	// Car positions from motion data
	if pm.motion != nil {
		state.Positions = make([]dto.CarPosition, packets.MaxCars)
		for i := range packets.MaxCars {
			m := &pm.motion.CarMotionData[i]
			state.Positions[i] = dto.CarPosition{
				Index: i,
				X:     m.WorldPositionX,
				Y:     m.WorldPositionY,
				Z:     m.WorldPositionZ,
				Yaw:   m.Yaw,
			}
		}
	}

	// Driver info (merge participants, lap data, car status)
	// Use high-water mark to prevent drivers from disappearing when NumActiveCars fluctuates
	numCars := packets.MaxCars
	if pm.participants != nil {
		active := int(pm.participants.NumActiveCars)
		peak := pm.peakActiveCars
		if active > peak {
			peak = active
			if mutate {
				pm.peakActiveCars = active
			}
		}
		if peak > 0 && peak < numCars {
			numCars = peak
		}
	}
	if int(pm.playerIndex) >= numCars {
		numCars = int(pm.playerIndex) + 1
	}
	if numCars > packets.MaxCars {
		numCars = packets.MaxCars
	}

	if numCars > 0 {
		var ersEstimates [packets.MaxCars]ERSEstimate
		if mutate {
			ersEstimates = pm.ersEstimator.Update(pm.session, pm.participants, pm.lapData, pm.telemetry, pm.carStatus, pm.carTelemetry2, pm.playerIndex)
		} else {
			// 읽기 전용 경로: 추정기 상태를 진행시키지 않고 현재 값만 스냅샷
			ersEstimates = pm.ersEstimator.Snapshot()
		}
		state.Drivers = make([]dto.DriverInfo, numCars)
		for i := range numCars {
			d := &state.Drivers[i]
			d.Index = i

			if pm.participants != nil {
				p := &pm.participants.Participants[i]
				d.Name = p.GetName()
				d.TeamID = int(p.TeamID)
				d.AIControlled = p.AIControlled == 1
			}

			if pm.lapData != nil {
				ld := &pm.lapData.LapData[i]
				d.Position = int(ld.CarPosition)
				d.CurrentLapNum = int(ld.CurrentLapNum)
				d.LastLapTime = float32(ld.LastLapTimeInMS)
				d.PitStatus = int(ld.PitStatus)
				d.DriverStatus = int(ld.DriverStatus)
				d.ResultStatus = int(ld.ResultStatus)
				d.NumPitStops = int(ld.NumPitStops)
				d.LapDistance = sanitize(ld.LapDistance)
				d.PitStopTimer = float32(ld.PitStopTimerInMS) / 1000.0
				d.Sector1TimeMs = int(ld.Sector1TimeMinutes)*60000 + int(ld.Sector1TimeInMS)
				d.Sector2TimeMs = int(ld.Sector2TimeMinutes)*60000 + int(ld.Sector2TimeInMS)
				d.CurrentSector = int(ld.Sector)
				d.DeltaToCarInFront = int(ld.DeltaToCarInFrontMinutesPart)*60000 + int(ld.DeltaToCarInFrontMSPart)
				d.DeltaToRaceLeader = int(ld.DeltaToRaceLeaderMinutesPart)*60000 + int(ld.DeltaToRaceLeaderMSPart)
				d.TopSpeed = int(math.Round(float64(sanitize(ld.SpeedTrapFastestSpeed))))
				d.PitLaneTime = int(ld.PitLaneTimeInLaneInMS)

				// 실측 피트 캡처. 상태 변이는 mutate 경로에서만 수행한다(BuildStateReadOnly는
				// RLock만 잡으므로 여기서 쓰면 데이터 레이스 — Fable C1). 진입 상승 에지에서 obs를
				// 초기화(직전 스톱 값 크로스 오염 차단)하고, 피트 중 관찰 최댓값을 모으다, 진출 하강
				// 에지에서 정비 스톱(NumPitStops 증가 동반)일 때만 확정한다.
				pmv := &pm.pitMeasure[i]
				if mutate {
					laneMs, stopMs := int(ld.PitLaneTimeInLaneInMS), int(ld.PitStopTimerInMS)
					inPit := ld.PitStatus > 0
					switch {
					case inPit && !pmv.inPit: // 진입 상승 에지
						pmv.obsLaneMs, pmv.obsStopMs = laneMs, stopMs
						pmv.entryStops = int(ld.NumPitStops)
					case inPit: // 피트 중 — 관찰 최댓값 축적
						pmv.obsLaneMs = max(pmv.obsLaneMs, laneMs)
						pmv.obsStopMs = max(pmv.obsStopMs, stopMs)
					case pmv.inPit: // 진출 하강 에지 — 정비 스톱일 때만 확정(drive-through 배제)
						if pmv.obsLaneMs > 0 && int(ld.NumPitStops) > pmv.entryStops {
							pmv.lastLaneMs, pmv.lastStopMs = pmv.obsLaneMs, pmv.obsStopMs
						}
						pmv.obsLaneMs, pmv.obsStopMs = 0, 0
					}
					pmv.inPit = inPit
				}
				d.MeasuredPitLaneMs = pmv.lastLaneMs
				d.MeasuredPitStopMs = pmv.lastStopMs
				d.Penalties = int(ld.Penalties)
				d.TotalWarnings = int(ld.TotalWarnings)
				d.CornerCuttingWarnings = int(ld.CornerCuttingWarnings)
				d.NumUnservedDriveThroughs = int(ld.NumUnservedDriveThroughs)
				d.NumUnservedStopGoPenalties = int(ld.NumUnservedStopGoPenalties)
				d.LapInvalid = ld.CurrentLapInvalid == 1
			}

			// Penalty log (event-sourced) for the leaderboard hover detail — copy so
			// downstream mutation/visibility filtering can't alias the manager's slice.
			if log := pm.penaltyLog[i]; len(log) > 0 {
				d.PenaltyLog = append([]dto.PenaltyLogEntry(nil), log...)
			}

			if pm.carStatus != nil {
				cs := &pm.carStatus.CarStatusData[i]
				d.TireCompound = tireCompoundString(cs.VisualTyreCompound)
				d.TireAge = int(cs.TyresAgeLaps)
				// d.FuelInTank – omitted from broadcast DTO
				d.FuelRemainingLaps = sanitize(cs.FuelRemainingLaps)
				// d.FuelMix – omitted from broadcast DTO
				d.ERSStoreEnergy = sanitize(cs.ERSStoreEnergy)
				d.ERSDeployMode = int(cs.ERSDeployMode)
				d.ERSDeployedThisLap = sanitize(cs.ERSDeployedThisLap)
				d.ERSHarvestedThisLap = sanitize(cs.ERSHarvestedThisLapMGUK + cs.ERSHarvestedThisLapMGUH)
				d.BrakeBias = int(cs.FrontBrakeBias)
				if pm.ersActualEnabled && (visibilityMode == telemetryvisibility.ModePublic || ersActualAvailable(pm.participants, pm.playerIndex, i)) {
					d.ERSActualPct = ersPercent(cs.ERSStoreEnergy)
					d.ERSActualReady = true
				}
			}
			d.ERSEstimatePct = ersEstimates[i].Percent
			d.ERSEstimateReady = ersEstimates[i].Ready

			if pm.carSetups != nil {
				setup := &pm.carSetups.CarSetupData[i]
				d.DiffOnThrottle = int(setup.OnThrottle)
				// d.DiffOffThrottle – omitted from broadcast DTO
			}

			// Stint history from strategy manager
			ds := pm.strategyMgr.GetDriverStrategy(i)
			if len(ds.StintHistory) > 0 {
				d.StintHistory = make([]dto.StintInfoDTO, len(ds.StintHistory))
				for si, s := range ds.StintHistory {
					endLap := s.StartLap + s.Laps - 1
					if endLap < s.StartLap {
						endLap = s.StartLap
					}
					d.StintHistory[si] = dto.StintInfoDTO{
						Compound:    s.Compound,
						Laps:        s.Laps,
						StartLap:    s.StartLap,
						EndLap:      endLap,
						TireWearPct: s.TireWearPct,
					}
				}
			}

			// Vehicle dynamics (player car only)
			if i == int(pm.playerIndex) {
				d.Dynamics = pm.dynamicsAnalyzer.GetLapDynamics()
			}

			// F1 game order: [RL, RR, FL, FR] -> DTO order: [FL, FR, RL, RR]
			var g2d = [4]int{2, 3, 0, 1}

			if pm.telemetry != nil {
				ct := &pm.telemetry.CarTelemetryData[i]
				d.DRSActivated = ct.DRS != 0
				// Speed, Throttle, Brake, Gear, Steering – omitted from broadcast DTO
				for w := range 4 {
					g := g2d[w]
					d.TireSurfaceTemp[w] = int(ct.TyresSurfaceTemperature[g])
					d.TireInnerTemp[w] = int(ct.TyresInnerTemperature[g])
					// BrakeTemp – omitted from broadcast DTO
				}
			}

			// 2026 Season Pack: Active Aero / Overtake (Manual Override) 상태
			if pm.carTelemetry2 != nil {
				ct2 := &pm.carTelemetry2.CarTelemetry2Data[i]
				d.OvertakeActive = ct2.OvertakeActive == 1
				d.OvertakeAvailable = ct2.OvertakeAvailable == 1
				d.ActiveAeroMode = int(ct2.ActiveAeroMode)
			}

			if pm.carDamage != nil {
				cd := &pm.carDamage.CarDamageData[i]
				d.Damage = &dto.CarDamage{
					FrontLeftWing:  clampDamage(cd.FrontLeftWingDamage),
					FrontRightWing: clampDamage(cd.FrontRightWingDamage),
					RearWing:       clampDamage(cd.RearWingDamage),
					Floor:          clampDamage(cd.FloorDamage),
					Diffuser:       clampDamage(cd.DiffuserDamage),
					Sidepod:        clampDamage(cd.SidepodDamage),
					Engine:         clampDamage(cd.EngineDamage),
					Gearbox:        clampDamage(cd.GearBoxDamage),
					DRSFault:       cd.DRSFault == 1,
					ERSFault:       cd.ERSFault == 1,
				}
				// Also populate tire wear from damage packet (game sends 0-100% float)
				for w := range 4 {
					wear := math.Round(float64(cd.TyresWear[g2d[w]]))
					if wear < 0 {
						wear = 0
					} else if wear > 100 {
						wear = 100
					}
					d.TireWear[w] = int(wear)
				}
			}

			if ts := pm.tyreSets[i]; ts != nil {
				fittedIdx := int(ts.FittedIdx)
				if fittedIdx >= 0 && fittedIdx < packets.MaxNumTyreSets {
					fitted := &ts.TyreSetData[fittedIdx]
					w, l, u := int(fitted.Wear), int(fitted.LifeSpan), int(fitted.UsableLife)
					d.TyreSetWear = &w
					d.TyreLifeSpan = &l
					d.TyreUsableLife = &u
				}
				// Aggregate available sets by compound
				counts := map[string]int{}
				for s := range packets.MaxNumTyreSets {
					set := &ts.TyreSetData[s]
					if set.Available == 1 && set.Fitted == 0 {
						compound := tireCompoundString(set.VisualTyreCompound)
						counts[compound]++
					}
				}
				if len(counts) > 0 {
					avail := make([]dto.TyreSetBrief, 0, len(counts))
					for _, c := range []string{"soft", "medium", "hard", "inter", "wet"} {
						if n, ok := counts[c]; ok {
							avail = append(avail, dto.TyreSetBrief{Compound: c, Count: n})
						}
					}
					d.AvailableSets = avail
				}
			}

			if sh := pm.sessionHistory[i]; sh != nil {
				d.SessionHistoryAvailable = true
				d.BestLapTime = float32(sh.BestLapMS())
				d.BestSector1Ms = sh.BestSectorMS(1)
				d.BestSector2Ms = sh.BestSectorMS(2)
				d.BestSector3Ms = sh.BestSectorMS(3)
			}
		}

		playerIdx := int(pm.playerIndex)
		if playerIdx >= 0 && playerIdx < len(state.Drivers) {
			playerLeaderDelta := state.Drivers[playerIdx].DeltaToRaceLeader
			for i := range state.Drivers {
				state.Drivers[i].DeltaToPlayer = state.Drivers[i].DeltaToRaceLeader - playerLeaderDelta
			}
		}

		pm.applySourceVisibility(state, visibilityMode)
	}

	return state
}

func (pm *PitwallManager) applySourceVisibility(state *dto.PitwallState, visibilityMode telemetryvisibility.Mode) {
	if state == nil || len(state.Drivers) == 0 {
		return
	}

	sessionHistoryByCar := make(map[uint8]*packets.PacketSessionHistoryData)
	for idx, sh := range pm.sessionHistory {
		if sh != nil {
			sessionHistoryByCar[uint8(idx)] = sh
		}
	}

	tyreSetsByCar := make(map[uint8]*packets.PacketTyreSetsData)
	for idx, ts := range pm.tyreSets {
		if ts != nil {
			tyreSetsByCar[uint8(idx)] = ts
		}
	}

	snapshot := telemetryvisibility.Snapshot{
		PlayerCarIndex:      &pm.playerIndex,
		Session:             pm.session,
		Participants:        pm.participants,
		Motion:              pm.motion,
		LapData:             pm.lapData,
		CarSetups:           pm.carSetups,
		CarTelemetry:        pm.telemetry,
		CarStatus:           pm.carStatus,
		CarDamage:           pm.carDamage,
		SessionHistoryByCar: sessionHistoryByCar,
		TyreSetsByCar:       tyreSetsByCar,
		Drivers:             append([]dto.DriverInfo(nil), state.Drivers...),
	}

	parsed := telemetryvisibility.ParseSnapshot(snapshot, visibilityMode)
	limit := min(len(state.Drivers), len(parsed.Cars))
	for i := range limit {
		driver := &state.Drivers[i]
		normalized := parsed.Cars[i].Normalized

		driver.AIControlled = normalized.AiControlled
		driver.DRSActivated = normalized.DRSActivated
		driver.FuelInTank = normalized.FuelInTank
		driver.FuelRemainingLaps = normalized.FuelRemainingLaps
		driver.FuelMix = int(normalized.FuelMix)
		driver.BrakeBias = int(normalized.BrakeBias)
		driver.ERSStoreEnergy = normalized.ERSStoreEnergy
		driver.ERSDeployMode = int(normalized.ERSDeployMode)
		driver.ERSDeployedThisLap = normalized.ERSDeployedThisLap
		driver.ERSHarvestedThisLap = normalized.ERSHarvestedMGUK + normalized.ERSHarvestedMGUH
		driver.ERSActualPct = normalized.ERSActualPct
		driver.ERSActualReady = normalized.ERSActualReady
		driver.ERSEstimatePct = normalized.ERSEstimatePct
		driver.ERSEstimateReady = normalized.ERSEstimateReady

		setup := parsed.Cars[i].Setup
		if setup == nil {
			driver.DiffOnThrottle = 0
			driver.DiffOffThrottle = 0
		} else {
			diffOn := setup.DiffOnThrottle
			if diffOn == 0 {
				diffOn = setup.OnThrottle
			}
			driver.DiffOnThrottle = int(diffOn)
			driver.DiffOffThrottle = int(setup.OffThrottle)
		}

		if normalized.Damage == nil {
			driver.Damage = nil
			driver.TireWear = [4]int{}
		} else {
			nextDamage := &dto.CarDamage{
				FrontLeftWing:  int(normalized.Damage.FrontLeftWing),
				FrontRightWing: int(normalized.Damage.FrontRightWing),
				RearWing:       int(normalized.Damage.RearWing),
				Floor:          int(normalized.Damage.Floor),
				Diffuser:       int(normalized.Damage.Diffuser),
				Sidepod:        int(normalized.Damage.Sidepod),
				Engine:         int(normalized.Damage.Engine),
				Gearbox:        int(normalized.Damage.Gearbox),
			}
			if driver.Damage != nil {
				nextDamage.DRSFault = driver.Damage.DRSFault
				nextDamage.ERSFault = driver.Damage.ERSFault
			}
			driver.Damage = nextDamage
			driver.TireWear = normalized.TireWear
		}

		if visibilityMode != telemetryvisibility.ModePublic && !ersActualAvailable(pm.participants, pm.playerIndex, i) {
			driver.FuelInTank = 0
			driver.FuelRemainingLaps = 0
			driver.FuelMix = 0
			driver.BrakeBias = 0
			driver.ERSStoreEnergy = 0
			driver.ERSDeployMode = 0
			driver.ERSDeployedThisLap = 0
			driver.ERSHarvestedThisLap = 0
			driver.ERSActualPct = 0
			driver.ERSActualReady = false
			driver.Damage = nil
			driver.TireWear = [4]int{}
		}
	}
}

func (pm *PitwallManager) sourceVisibilityMode() telemetryvisibility.Mode {
	if pm.participants == nil {
		return telemetryvisibility.ModeStrict
	}

	numCars := int(pm.participants.NumActiveCars)
	if numCars <= 0 || numCars > packets.MaxCars {
		numCars = packets.MaxCars
	}
	for i := 0; i < numCars; i++ {
		if i == int(pm.playerIndex) {
			continue
		}
		if pm.participants.Participants[i].YourTelemetry == 1 {
			return telemetryvisibility.ModePublic
		}
	}
	return telemetryvisibility.ModeStrict
}

// GetDriverName returns the name for a vehicle index, or empty string if unknown.
func (pm *PitwallManager) GetDriverName(vehicleIdx uint8) string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if !pm.participantSlotKnownLocked(int(vehicleIdx)) {
		return ""
	}
	return pm.participants.Participants[vehicleIdx].GetName()
}

// GetDriverTeamID returns a null-preserving identity source for incident
// capture. Team 0 and the game's 255 no-team sentinel are both valid values;
// nil is reserved solely for a missing participants source/invalid slot.
func (pm *PitwallManager) GetDriverTeamID(vehicleIdx uint8) *int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if !pm.participantSlotKnownLocked(int(vehicleIdx)) {
		return nil
	}
	teamID := int(pm.participants.Participants[vehicleIdx].TeamID)
	return &teamID
}

func (pm *PitwallManager) participantSlotKnownLocked(idx int) bool {
	if pm.participants == nil || idx < 0 || idx >= packets.MaxCars {
		return false
	}
	active := int(pm.participants.NumActiveCars)
	if active < 0 {
		return false
	}
	if active > packets.MaxCars {
		active = packets.MaxCars
	}
	return idx < active
}

// TelemetryAvailableForVehicle applies the established privacy rule to an
// incident sample: the player is always available; a rival is available only
// when that participant explicitly exposes telemetry. Packet freshness alone
// is not permission to surface a restricted rival's inputs.
func (pm *PitwallManager) TelemetryAvailableForVehicle(vehicleIdx uint8) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if int(vehicleIdx) == int(pm.playerIndex) {
		return true
	}
	if !pm.participantSlotKnownLocked(int(vehicleIdx)) {
		return false
	}
	return pm.participants.Participants[vehicleIdx].YourTelemetry == 1
}

// AnalysisTrackOutline returns a read-only, deterministic snapshot of the
// recorded TrackStore centreline in world X/Z coordinates. It never fabricates a
// track and returns nil when a usable recorded line is unavailable. sourcePoints
// is the original TrackStore count retained in private restart provenance.
func (pm *PitwallManager) AnalysisTrackOutline() (*dto.TrackOutlineDTO, int) {
	pm.mu.RLock()
	if pm.session == nil || pm.trackStore == nil {
		pm.mu.RUnlock()
		return nil, 0
	}
	trackID := pm.session.TrackID
	store := pm.trackStore
	pm.mu.RUnlock()

	data := store.Get(trackID)
	if data == nil || len(data.Points) < 2 {
		return nil, 0
	}
	sourcePoints := len(data.Points)
	count := sourcePoints
	if count > maxAnalysisTrackOutlinePoints {
		count = maxAnalysisTrackOutlinePoints
	}
	points := make([][2]float64, 0, count)
	if count == 1 {
		return nil, 0
	}
	for i := 0; i < count; i++ {
		// Evenly select real points, including both source endpoints. This avoids
		// synthetic interpolation while keeping a deterministic <=256 outline.
		idx := i * (len(data.Points) - 1) / (count - 1)
		p := data.Points[idx]
		if !finiteTrackCoordinate(float64(p.X)) || !finiteTrackCoordinate(float64(p.Z)) {
			return nil, 0
		}
		points = append(points, [2]float64{float64(p.X), float64(p.Z)})
	}
	bounds := dto.TrackOutlineBounds{MinX: data.MinX, MaxX: data.MaxX, MinZ: data.MinZ, MaxZ: data.MaxZ}
	if !finiteTrackCoordinate(bounds.MinX) || !finiteTrackCoordinate(bounds.MaxX) ||
		!finiteTrackCoordinate(bounds.MinZ) || !finiteTrackCoordinate(bounds.MaxZ) ||
		bounds.MinX > bounds.MaxX || bounds.MinZ > bounds.MaxZ {
		return nil, 0
	}
	return &dto.TrackOutlineDTO{Points: points, Bounds: bounds}, sourcePoints
}

func finiteTrackCoordinate(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// CaptureProvenance reports raw packet-source observations for the active
// session. The returned value is a copy and is safe to retain in a summary.
func (pm *PitwallManager) CaptureProvenance() dto.RaceCaptureProvenance {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	provenance := dto.RaceCaptureProvenance{
		LapDataObserved:        pm.lapDataObserved,
		SessionHistoryObserved: pm.sessionHistoryObserved,
		CarStatusObserved:      pm.carStatusObserved,
		CarDamageObserved:      pm.carDamageObserved,
		TyreSetsObserved:       pm.tyreSetsObserved,
	}
	idx := int(pm.playerIndex)
	if idx >= 0 && idx < packets.MaxCars {
		provenance.PitMeasurementObserved = pm.pitMeasure[idx].lastLaneMs > 0
	}
	return provenance
}

// GetPlayerName returns the player's own participant name (header PlayerCarIndex
// slot), or empty string if participants / player index are not yet known. Used
// for nickname-ban matching. Empty result means "cannot identify" → never banned.
func (pm *PitwallManager) GetPlayerName() string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if pm.participants == nil || int(pm.playerIndex) >= len(pm.participants.Participants) {
		return ""
	}
	return pm.participants.Participants[pm.playerIndex].GetName()
}

// GetPlayerCurrentLap returns the player's current lap number, or 0 if unknown.
// Used to lap-tag race-control notifications for the persisted summary.
func (pm *PitwallManager) GetPlayerCurrentLap() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	idx := int(pm.playerIndex)
	if pm.lapData == nil || idx < 0 || idx >= packets.MaxCars {
		return 0
	}
	return int(pm.lapData.LapData[idx].CurrentLapNum)
}

// CaptureStartLap returns the player's lap number when this session was first
// observed (0 = no lap data seen yet). >1 means a late attach: dynamics before
// that lap were never measured (laps themselves are retroactive via history).
func (pm *PitwallManager) CaptureStartLap() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.captureStartLap
}

// PlayerHasCompletedLap reports whether the player's session history holds at
// least one completed lap (LapTimeInMS>0 — numLaps alone counts the in-progress
// lap). Uses pm.playerIndex, the same source BuildState/PlayerLapTimings resolve
// to, so the gate and the saved content always agree.
func (pm *PitwallManager) PlayerHasCompletedLap() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	idx := int(pm.playerIndex)
	if idx < 0 || idx >= packets.MaxCars {
		return false
	}
	sh := pm.sessionHistory[idx]
	if sh == nil {
		return false
	}
	numLaps := int(sh.NumLaps)
	if numLaps > packets.MaxNumLapsInHistory {
		numLaps = packets.MaxNumLapsInHistory
	}
	for i := 0; i < numLaps; i++ {
		if sh.LapHistoryData[i].LapTimeInMS > 0 {
			return true
		}
	}
	return false
}

// PlayerLapTimings returns completed-lap timings for the given car from the game's
// session-history packet. Tyre is left empty (derived from stint ranges in
// BuildSummary — the session-history packet carries no per-lap compound); nil or
// short history yields an empty slice. Pure read, safe to call after BuildState.
func (pm *PitwallManager) PlayerLapTimings(idx int) []dto.LapTimingDTO {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if idx < 0 || idx >= packets.MaxCars {
		return nil
	}
	sh := pm.sessionHistory[idx]
	if sh == nil {
		return nil
	}
	numLaps := int(sh.NumLaps)
	if numLaps > packets.MaxNumLapsInHistory {
		numLaps = packets.MaxNumLapsInHistory
	}
	out := make([]dto.LapTimingDTO, 0, numLaps)
	for i := 0; i < numLaps; i++ {
		lh := sh.LapHistoryData[i]
		if lh.LapTimeInMS == 0 {
			continue // lap not completed
		}
		out = append(out, dto.LapTimingDTO{
			LapNumber: i + 1,
			LapMs:     lh.LapTimeInMS,
			S1Ms:      uint32(lh.Sector1Ms()),
			S2Ms:      uint32(lh.Sector2Ms()),
			S3Ms:      uint32(lh.Sector3Ms()),
			Valid:     lh.LapValidBitFlags&0x01 != 0,
		})
	}
	return out
}

// PlayerSetup returns the car setup (23 fields) for the given car, or nil if the
// setup packet was never received. Pure read, safe to call after BuildState.
func (pm *PitwallManager) PlayerSetup(idx int) *dto.CarSetupDTO {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if pm.carSetups == nil || idx < 0 || idx >= packets.MaxCars {
		return nil
	}
	s := &pm.carSetups.CarSetupData[idx]
	return &dto.CarSetupDTO{
		FrontWing:              int(s.FrontWing),
		RearWing:               int(s.RearWing),
		OnThrottle:             int(s.OnThrottle),
		OffThrottle:            int(s.OffThrottle),
		FrontCamber:            float64(s.FrontCamber),
		RearCamber:             float64(s.RearCamber),
		FrontToe:               float64(s.FrontToe),
		RearToe:                float64(s.RearToe),
		FrontSuspension:        int(s.FrontSuspension),
		RearSuspension:         int(s.RearSuspension),
		FrontAntiRollBar:       int(s.FrontAntiRollBar),
		RearAntiRollBar:        int(s.RearAntiRollBar),
		FrontSuspensionHeight:  int(s.FrontSuspensionHeight),
		RearSuspensionHeight:   int(s.RearSuspensionHeight),
		BrakePressure:          int(s.BrakePressure),
		BrakeBias:              int(s.BrakeBias),
		EngineBraking:          int(s.EngineBraking),
		RearLeftTyrePressure:   float64(s.RearLeftTyrePressure),
		RearRightTyrePressure:  float64(s.RearRightTyrePressure),
		FrontLeftTyrePressure:  float64(s.FrontLeftTyrePressure),
		FrontRightTyrePressure: float64(s.FrontRightTyrePressure),
		Ballast:                int(s.Ballast),
		FuelLoad:               float64(s.FuelLoad),
	}
}

// BuildPositions returns car positions from the latest motion packet.
// This is a lightweight alternative to BuildState for high-frequency broadcasting.
func (pm *PitwallManager) BuildPositions() []dto.CarPosition {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.motion == nil {
		return nil
	}

	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}

	positions := make([]dto.CarPosition, numCars)
	for i := range numCars {
		m := &pm.motion.CarMotionData[i]
		positions[i] = dto.CarPosition{
			Index: i,
			X:     m.WorldPositionX,
			Y:     m.WorldPositionY,
			Z:     m.WorldPositionZ,
			Yaw:   m.Yaw,
		}
	}
	return positions
}

// BuildRadarData returns a lightweight radar payload for the local overlay SSE stream.
func (pm *PitwallManager) BuildRadarData() *dto.RadarData {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.motion == nil {
		return nil
	}

	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}

	data := &dto.RadarData{
		PlayerIndex: int(pm.playerIndex),
		Cars:        make([]dto.RadarCarData, numCars),
	}
	for i := range numCars {
		m := &pm.motion.CarMotionData[i]
		car := dto.RadarCarData{
			Index: i,
			X:     m.WorldPositionX,
			Z:     m.WorldPositionZ,
			Yaw:   m.Yaw,
		}
		if pm.participants != nil {
			car.TeamID = int(pm.participants.Participants[i].TeamID)
		}
		data.Cars[i] = car
	}
	return data
}

// BuildWeatherData returns a lightweight weather payload for the local overlay SSE stream.
func (pm *PitwallManager) BuildWeatherData() *dto.WeatherOverlayData {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.session == nil {
		return nil
	}

	data := &dto.WeatherOverlayData{
		CurrentWeather: weatherString(pm.session.Weather),
		TrackTemp:      float32(pm.session.TrackTemperature),
		AirTemp:        float32(pm.session.AirTemperature),
		SessionType:    sessionTypeString(pm.session.SessionType),
	}

	numForecast := int(pm.session.NumWeatherForecastSamples)
	if numForecast > 64 {
		numForecast = 64
	}
	if numForecast > 0 {
		forecasts := make([]dto.WeatherForecastDTO, 0, numForecast)
		for i := range numForecast {
			fs := &pm.session.WeatherForecastSamples[i]
			if fs.SessionType != pm.session.SessionType {
				continue
			}
			forecasts = append(forecasts, dto.WeatherForecastDTO{
				SessionType:     sessionTypeString(fs.SessionType),
				TimeOffset:      int(fs.TimeOffset),
				Weather:         weatherString(fs.Weather),
				TrackTemp:       float32(fs.TrackTemperature),
				TrackTempChange: int(fs.TrackTemperatureChange),
				AirTemp:         float32(fs.AirTemperature),
				AirTempChange:   int(fs.AirTemperatureChange),
				RainPercentage:  int(fs.RainPercentage),
			})
		}
		data.Forecasts = forecasts
	}
	return data
}

// CurrentTrackID returns the current session track ID, or -1 if unknown.
func (pm *PitwallManager) CurrentTrackID() int8 {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if pm.session == nil {
		return -1
	}
	return pm.session.TrackID
}

// BuildStrategyOverlayData returns a lightweight strategy payload for the overlay.
// pitTimeLossMs is the per-track pit lane time loss in milliseconds.
// undercutDiff is the track undercut difficulty (1=easy, 2=medium, 3=hard).
func (pm *PitwallManager) BuildStrategyOverlayData(pitTimeLossMs int, undercutDiff int) *dto.StrategyOverlayData {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.session == nil || pm.lapData == nil {
		return nil
	}
	st := pm.session.SessionType
	if isQualifyingOverlaySession(st) {
		return pm.buildQualifyingOverlayDataLocked()
	}

	// Only produce data during race sessions (15=Race, 16=Race2, 17=Race3)
	if st < 15 || st > 17 {
		return nil
	}
	// Suppress during safety car / formation lap
	if pm.session.SafetyCarStatus != 0 {
		return nil
	}

	playerIdx := int(pm.playerIndex)
	numCars := pm.effectiveNumCars()

	// Build a lightweight per-car slice sorted by position.
	type carEntry struct {
		idx             int
		position        int
		lapNum          int
		deltaToLeaderMs int
		deltaToFrontMs  int
		lastLapMs       float32
		tireCompound    string
		tireAge         int
		pitStatus       int
		numPitStops     int
		resultStatus    int
		name            string
		avgPaceMs       float32
	}

	cars := make([]carEntry, 0, numCars)
	for i := range numCars {
		ld := &pm.lapData.LapData[i]
		// Skip inactive / retired / DNF / DSQ
		if ld.ResultStatus != 2 && ld.ResultStatus != 3 { // 2=active, 3=finished
			continue
		}
		c := carEntry{
			idx:             i,
			position:        int(ld.CarPosition),
			lapNum:          int(ld.CurrentLapNum),
			deltaToLeaderMs: int(ld.DeltaToRaceLeaderMinutesPart)*60000 + int(ld.DeltaToRaceLeaderMSPart),
			deltaToFrontMs:  int(ld.DeltaToCarInFrontMinutesPart)*60000 + int(ld.DeltaToCarInFrontMSPart),
			lastLapMs:       float32(ld.LastLapTimeInMS),
			pitStatus:       int(ld.PitStatus),
			numPitStops:     int(ld.NumPitStops),
			resultStatus:    int(ld.ResultStatus),
		}
		if pm.carStatus != nil {
			cs := &pm.carStatus.CarStatusData[i]
			c.tireCompound = tireCompoundString(cs.VisualTyreCompound)
			c.tireAge = int(cs.TyresAgeLaps)
		}
		if pm.participants != nil {
			c.name = pm.participants.Participants[i].GetName()
		}
		// Clean recent pace from strategy manager (last 5 laps avg)
		ds := pm.strategyMgr.GetDriverStrategy(i)
		if n := len(ds.RecentLaps); n > 0 {
			cnt := min(5, n)
			sum := 0
			for _, l := range ds.RecentLaps[n-cnt:] {
				sum += l.TimeMS
			}
			c.avgPaceMs = float32(sum) / float32(cnt)
		}
		cars = append(cars, c)
	}
	// Sort by position ascending
	sort.Slice(cars, func(i, j int) bool { return cars[i].position < cars[j].position })

	// Find player in sorted list
	playerPos := -1
	var player *carEntry
	for i := range cars {
		if cars[i].idx == playerIdx {
			playerPos = i
			player = &cars[i]
			break
		}
	}
	if player == nil {
		return nil
	}

	data := &dto.StrategyOverlayData{
		Mode:           "race",
		SessionType:    sessionTypeString(pm.session.SessionType),
		PlayerPosition: player.position,
		PlayerLap:      player.lapNum,
		TotalLaps:      int(pm.session.TotalLaps),
		TrackID:        pm.session.TrackID,
	}

	// ── Pit Rejoin Position ──
	// Primary: game-provided value
	gameRejoin := int(pm.session.PitStopRejoinPosition)
	if gameRejoin > 0 {
		data.PitRejoinPosition = gameRejoin
	} else {
		// Fallback: estimate from gaps
		effectiveGap := player.deltaToLeaderMs + pitTimeLossMs
		rejoinPos := 1
		for _, c := range cars {
			if c.idx == playerIdx {
				continue
			}
			if c.deltaToLeaderMs < effectiveGap {
				rejoinPos++
			}
		}
		data.PitRejoinPosition = rejoinPos
	}

	// ── Car Ahead / Behind (skip pitting cars) ──
	var ahead, behind *carEntry
	for i := playerPos - 1; i >= 0; i-- {
		if cars[i].pitStatus == 0 { // on track
			ahead = &cars[i]
			break
		}
	}
	for i := playerPos + 1; i < len(cars); i++ {
		if cars[i].pitStatus == 0 {
			behind = &cars[i]
			break
		}
	}

	playerAvg := player.avgPaceMs
	if ahead != nil {
		gapMs := player.deltaToLeaderMs - ahead.deltaToLeaderMs
		if gapMs < 0 {
			gapMs = ahead.deltaToFrontMs // fallback
		}
		paceDelta := float32(0)
		if playerAvg > 0 && ahead.avgPaceMs > 0 {
			paceDelta = playerAvg - ahead.avgPaceMs // positive = player slower
		}
		data.CarAhead = &dto.StrategyCar{
			Name:         ahead.name,
			Position:     ahead.position,
			GapMs:        gapMs,
			TireCompound: ahead.tireCompound,
			TireAge:      ahead.tireAge,
			LastLapMs:    ahead.lastLapMs,
			AvgPaceMs:    ahead.avgPaceMs,
			PitStops:     ahead.numPitStops,
			HasPitted:    ahead.numPitStops > 0,
			PaceDeltaMs:  paceDelta,
		}
	}
	if behind != nil {
		gapMs := behind.deltaToLeaderMs - player.deltaToLeaderMs
		if gapMs < 0 {
			gapMs = 0
		}
		paceDelta := float32(0)
		if playerAvg > 0 && behind.avgPaceMs > 0 {
			paceDelta = playerAvg - behind.avgPaceMs
		}
		data.CarBehind = &dto.StrategyCar{
			Name:         behind.name,
			Position:     behind.position,
			GapMs:        gapMs,
			TireCompound: behind.tireCompound,
			TireAge:      behind.tireAge,
			LastLapMs:    behind.lastLapMs,
			AvgPaceMs:    behind.avgPaceMs,
			PitStops:     behind.numPitStops,
			HasPitted:    behind.numPitStops > 0,
			PaceDeltaMs:  paceDelta,
		}
	}

	// ── Undercut / Overcut Viability ──
	// Undercut window (ms) varies by difficulty: easy=5000, medium=3500, hard=2000
	undercutWindow := 3500
	switch undercutDiff {
	case 1:
		undercutWindow = 5000
	case 3:
		undercutWindow = 2000
	}

	data.UndercutVerdict = "NO"
	data.OvercutVerdict = "NO"

	if ahead != nil && player.pitStatus == 0 && player.lapNum > 1 {
		gapMs := data.CarAhead.GapMs

		// Undercut: smaller gap + old tires = easier
		playerTireAge := 0
		if pm.carStatus != nil {
			playerTireAge = int(pm.carStatus.CarStatusData[playerIdx].TyresAgeLaps)
		}
		if gapMs > 0 && gapMs < undercutWindow && playerTireAge >= 10 &&
			(ahead.numPitStops == 0 || ahead.tireAge >= playerTireAge-3) {
			data.UndercutVerdict = "VIABLE"
		} else if gapMs > 0 && gapMs < undercutWindow*3/2 && playerTireAge >= 6 {
			data.UndercutVerdict = "RISKY"
		}

		// Overcut: player on newer tires, car ahead degrading
		if gapMs > 0 && gapMs < 3500 && playerTireAge < ahead.tireAge && ahead.tireAge >= 12 {
			data.OvercutVerdict = "VIABLE"
		} else if gapMs > 0 && gapMs < 5000 && playerTireAge < ahead.tireAge && ahead.tireAge >= 8 {
			data.OvercutVerdict = "RISKY"
		}
	}

	// ── Train Detection ──
	// Find chains of consecutive cars within 1.5s
	const trainThreshold = 1500
	type chain struct{ start, end int }
	var chains []chain
	chainStart := 0
	for i := 1; i < len(cars); i++ {
		gap := cars[i].deltaToFrontMs
		if gap <= 0 || gap > trainThreshold || cars[i].pitStatus != 0 {
			if i-chainStart >= 2 {
				chains = append(chains, chain{chainStart, i - 1})
			}
			chainStart = i
		}
	}
	if len(cars)-chainStart >= 2 {
		chains = append(chains, chain{chainStart, len(cars) - 1})
	}
	for _, ch := range chains {
		if playerPos >= ch.start && playerPos <= ch.end {
			data.TrainSize = ch.end - ch.start + 1
			data.InTrain = data.TrainSize >= 3
			break
		}
	}

	return data
}

func (pm *PitwallManager) effectiveNumCars() int {
	numCars := packets.MaxCars
	if pm.participants != nil {
		active := int(pm.participants.NumActiveCars)
		if pm.peakActiveCars > 0 && pm.peakActiveCars < numCars {
			numCars = pm.peakActiveCars
		}
		if active > numCars {
			numCars = active
		}
	}
	if int(pm.playerIndex) >= numCars {
		numCars = int(pm.playerIndex) + 1
	}
	if numCars > packets.MaxCars {
		numCars = packets.MaxCars
	}
	return numCars
}

// HasData returns true if at least session or motion data has been received
func (pm *PitwallManager) HasData() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.session != nil || pm.motion != nil
}

func weatherString(w uint8) string {
	switch w {
	case 0:
		return "clear"
	case 1:
		return "light_cloud"
	case 2:
		return "overcast"
	case 3:
		return "light_rain"
	case 4:
		return "heavy_rain"
	case 5:
		return "storm"
	default:
		return "unknown"
	}
}

func safetyCarString(s uint8) string {
	switch s {
	case 0:
		return "none"
	case 1:
		return "full"
	case 2:
		return "virtual"
	case 3:
		return "formation"
	default:
		return "unknown"
	}
}

func sessionTypeString(s uint8) string {
	types := map[uint8]string{
		0: "unknown", 1: "P1", 2: "P2", 3: "P3", 4: "Short P",
		5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Q", 9: "OSQ",
		10: "SS1", 11: "SS2", 12: "SS3", 13: "Short SS", 14: "OSS",
		15: "Race", 16: "Race 2", 17: "Race 3", 18: "Time Trial",
	}
	if t, ok := types[s]; ok {
		return t
	}
	return "unknown"
}

func clampDamage(v uint8) int {
	if v > 100 {
		return 100
	}
	return int(v)
}

func ersPercent(energy float32) int {
	const maxERSEnergy = 4_000_000.0
	pct := (float64(sanitize(energy)) / maxERSEnergy) * 100
	if pct < 0 {
		pct = 0
	} else if pct > 100 {
		pct = 100
	}
	return int(math.Round(pct))
}

func ersActualAvailable(participants *packets.PacketParticipantsData, playerIndex uint8, idx int) bool {
	if idx == int(playerIndex) {
		return true
	}
	if participants == nil || idx < 0 || idx >= len(participants.Participants) {
		return false
	}
	return participants.Participants[idx].YourTelemetry == 1
}

func tireCompoundString(v uint8) string {
	switch v {
	case 16:
		return "soft"
	case 17:
		return "medium"
	case 18:
		return "hard"
	case 7:
		return "inter"
	case 8:
		return "wet"
	default:
		return "unknown"
	}
}
