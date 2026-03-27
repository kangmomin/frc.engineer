package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"frc.engineer/internal/broadcast"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
)

// RaceSummaryCounts tracks race-control notification totals for persisted summaries.
type RaceSummaryCounts struct {
	Penalty int
	Warning int
	Info    int
}

// ReplayFrame is one timeline snapshot for dashboard replay.
type ReplayFrame struct {
	Timestamp    int64                         `json:"timestamp"`
	Pitwall      *dto.PitwallState             `json:"pitwall"`
	RaceControl  []dto.RaceControlNotification `json:"raceControl,omitempty"`
	BattleAlerts []dto.BattleAlertDTO          `json:"battleAlerts,omitempty"`
}

// ReplayTimeline is a complete replay payload for one session.
type ReplayTimeline struct {
	FrameIntervalMS int              `json:"frameIntervalMs"`
	TrackMap        *dto.TrackMapDTO `json:"trackMap,omitempty"`
	Session         *dto.SessionInfo `json:"session,omitempty"`
	Frames          []ReplayFrame    `json:"frames"`
}

const (
	maxReplayRaceControl  = 50
	maxReplayBattleAlert  = 10
	replayFrameIntervalMS = 500
)

// RaceSummarySaveCallback is invoked once per session on race-end events.
type RaceSummarySaveCallback func(sessionUID uint64, counts RaceSummaryCounts, state *dto.PitwallState) error

// Processor processes telemetry data and broadcasts to WebSocket clients
type Processor struct {
	parser          *udp.Parser
	hub             broadcast.Broadcaster
	deltaCalculator *DeltaCalculator
	pitwallManager  *PitwallManager
	battleDetector  *BattleDetector
	logger          *slog.Logger

	// Rate limiting
	minInterval     time.Duration
	lastSend        time.Time
	lastPitwallSend time.Time

	// Latest data cache
	mu              sync.RWMutex
	latestTelemetry *packets.CarTelemetryData
	latestLapData   *packets.LapData
	latestHeader    *packets.PacketHeader

	// Race summary persistence state
	raceSummaryMu       sync.Mutex
	raceSummaryEnabled  bool
	raceSummarySave     RaceSummarySaveCallback
	raceSummarySession  uint64
	raceSummarySaved    bool
	raceSummaryCounters RaceSummaryCounts

	// Atomic counter for unique race-control notification IDs
	rcSeq atomic.Int64

	// Replay timeline capture state (summary / advanced storage modes)
	replayMu          sync.Mutex
	replayEnabled     bool
	replaySessionUID  uint64
	replayFrames      []ReplayFrame
	replayRaceControl []dto.RaceControlNotification
	replayBattleAlert []dto.BattleAlertDTO
	replayTrackMap    *dto.TrackMapDTO
	replaySession     *dto.SessionInfo
	replayLastFrameTS int64
}

// NewProcessor creates a new telemetry processor
func NewProcessor(parser *udp.Parser, hub broadcast.Broadcaster, updateRateHz int, logger *slog.Logger, trackStore *tracks.TrackStore) *Processor {
	interval := time.Duration(0)
	if updateRateHz > 0 {
		interval = time.Second / time.Duration(updateRateHz)
	}

	return &Processor{
		parser:          parser,
		hub:             hub,
		deltaCalculator: NewDeltaCalculator(),
		pitwallManager:  NewPitwallManager(NewStrategyManager(), trackStore, nil),
		battleDetector:  NewBattleDetector(),
		logger:          logger,
		minInterval:     interval,
	}
}

// DeltaCalculator returns the processor's delta calculator for configuration
func (p *Processor) DeltaCalculator() *DeltaCalculator {
	return p.deltaCalculator
}

// PitwallManager returns the processor's pitwall manager
func (p *Processor) PitwallManager() *PitwallManager {
	return p.pitwallManager
}

// SetRaceSummarySaveCallback sets the callback used to persist race summaries.
func (p *Processor) SetRaceSummarySaveCallback(cb RaceSummarySaveCallback) {
	p.raceSummaryMu.Lock()
	p.raceSummarySave = cb
	p.raceSummaryMu.Unlock()
}

// SetRaceSummaryRecording toggles race summary persistence at runtime.
func (p *Processor) SetRaceSummaryRecording(enabled bool) {
	p.raceSummaryMu.Lock()
	p.raceSummaryEnabled = enabled
	p.raceSummaryMu.Unlock()
}

// SetReplayRecording toggles timeline snapshot capture used by summary/advanced storage.
func (p *Processor) SetReplayRecording(enabled bool) {
	p.replayMu.Lock()
	defer p.replayMu.Unlock()
	p.replayEnabled = enabled
	if !enabled {
		p.replaySessionUID = 0
		p.replayFrames = nil
		p.replayRaceControl = nil
		p.replayBattleAlert = nil
		p.replayTrackMap = nil
		p.replaySession = nil
		p.replayLastFrameTS = 0
	}
}

// GetReplayTimeline returns a copy of captured replay frames for a specific session.
func (p *Processor) GetReplayTimeline(sessionUID uint64) *ReplayTimeline {
	p.replayMu.Lock()
	defer p.replayMu.Unlock()

	if !p.replayEnabled || sessionUID == 0 || p.replaySessionUID != sessionUID || len(p.replayFrames) == 0 {
		return nil
	}

	frames := make([]ReplayFrame, len(p.replayFrames))
	for i := range p.replayFrames {
		frame := p.replayFrames[i]
		if len(frame.RaceControl) > 0 {
			frame.RaceControl = append([]dto.RaceControlNotification(nil), frame.RaceControl...)
		}
		if len(frame.BattleAlerts) > 0 {
			frame.BattleAlerts = append([]dto.BattleAlertDTO(nil), frame.BattleAlerts...)
		}
		frames[i] = frame
	}

	return &ReplayTimeline{
		FrameIntervalMS: replayFrameIntervalMS,
		TrackMap:        p.replayTrackMap,
		Session:         p.replaySession,
		Frames:          frames,
	}
}

// Start begins processing packets from the UDP listener
func (p *Processor) Start(ctx context.Context, packets <-chan []byte) {
	updateHz := "unlimited"
	if p.minInterval > 0 {
		updateHz = fmt.Sprintf("%d", int(time.Second/p.minInterval))
	}
	p.logger.Info("telemetry processor started", "updateRateHz", updateHz)

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("telemetry processor shutting down")
			return

		case data, ok := <-packets:
			if !ok {
				return
			}
			p.processPacket(data)
		}
	}
}

// processPacket parses and processes a single UDP packet
func (p *Processor) processPacket(data []byte) {
	parsed, err := p.parser.Parse(data)
	if err != nil {
		p.logger.Debug("failed to parse packet", "error", err)
		return
	}

	if parsed == nil {
		return
	}

	p.observeSessionUID(parsed.Header.SessionUID)
	p.observeReplaySession(parsed.Header.SessionUID)

	// Handle event packets (penalties, warnings, race control)
	if parsed.Event != nil {
		p.handleEventPacket(parsed)
	}

	// Feed pitwall manager with new packet types
	if parsed.Motion != nil {
		p.pitwallManager.UpdateMotion(parsed.Motion, parsed.Header.PlayerCarIndex)
	}
	if parsed.Session != nil {
		p.pitwallManager.UpdateSession(parsed.Session)
	}
	if parsed.Participants != nil {
		p.pitwallManager.UpdateParticipants(parsed.Participants)
	}
	if parsed.CarStatus != nil {
		p.pitwallManager.UpdateCarStatus(parsed.CarStatus)
	}
	if parsed.Telemetry != nil {
		p.pitwallManager.UpdateTelemetry(parsed.Telemetry)
	}
	if parsed.LapData != nil {
		p.pitwallManager.UpdateLapData(parsed.LapData)
	}
	if parsed.CarDamage != nil {
		p.pitwallManager.UpdateCarDamage(parsed.CarDamage)
	}
	if parsed.CarSetups != nil {
		p.pitwallManager.UpdateCarSetups(parsed.CarSetups)
	}
	if parsed.MotionEx != nil {
		p.pitwallManager.UpdateMotionEx(parsed.MotionEx)
	}

	p.mu.Lock()

	// Update cached data for dashboard
	if parsed.Telemetry != nil {
		playerTelemetry := p.parser.GetPlayerTelemetry(parsed)
		if playerTelemetry != nil {
			p.latestTelemetry = playerTelemetry
			p.latestHeader = parsed.Header
		}
	}

	if parsed.LapData != nil {
		playerLapData := p.parser.GetPlayerLapData(parsed)
		if playerLapData != nil {
			p.latestLapData = playerLapData
			p.latestHeader = parsed.Header
		}
	}

	now := time.Now()

	// Broadcast pitwallState at ~4 Hz (250ms interval)
	if now.Sub(p.lastPitwallSend) >= 250*time.Millisecond && p.pitwallManager.HasData() {
		p.lastPitwallSend = now
		pitwallState := p.pitwallManager.BuildState()

		msg := dto.WSResponse{
			Type: dto.MessageTypePitwallState,
			Data: pitwallState,
		}
		pitwallJSON, err := json.Marshal(msg)
		if err != nil {
			p.logger.Error("failed to marshal pitwall state", "error", err)
		} else {
			p.hub.Broadcast(pitwallJSON)
		}

		// Battle detection: check gap trends on lap change
		p.checkBattleAlerts(pitwallState)
		p.recordReplayFrame(parsed.Header.SessionUID, now.UnixMilli(), pitwallState)
	}

	// Check rate limit for telemetry dashboard
	if now.Sub(p.lastSend) < p.minInterval {
		p.mu.Unlock()
		return
	}

	// Build and send dashboard data
	if p.latestTelemetry != nil && p.latestLapData != nil && p.latestHeader != nil {
		dashData := p.buildDashboardData()
		p.lastSend = now
		p.mu.Unlock()

		jsonData, err := json.Marshal(dashData)
		if err != nil {
			p.logger.Error("failed to marshal dashboard data", "error", err)
			return
		}

		p.hub.Broadcast(jsonData)
	} else {
		p.mu.Unlock()
	}
}

// buildDashboardData creates a dashboard DTO from the latest cached data
// Must be called with p.mu held
func (p *Processor) buildDashboardData() *dto.Dashboard {
	tel := p.latestTelemetry
	lap := p.latestLapData
	header := p.latestHeader

	// Calculate delta to personal best with full telemetry data for precise interpolation
	deltaPersonalBest := p.deltaCalculator.UpdateWithTelemetry(header, lap, tel)

	return &dto.Dashboard{
		Speed:             tel.Speed,
		Gear:              tel.Gear,
		RPM:               tel.EngineRPM,
		Throttle:          sanitizeF32(tel.Throttle),
		Brake:             sanitizeF32(tel.Brake),
		DeltaPersonalBest: deltaPersonalBest,
		DeltaCarInFront:   int32(lap.DeltaToCarInFrontMSPart),
		DeltaRaceLeader:   int32(lap.DeltaToRaceLeaderMSPart),
		CurrentLap:        lap.CurrentLapNum,
		CurrentLapTime:    lap.CurrentLapTimeInMS,
		LastLapTime:       lap.LastLapTimeInMS,
		BestLapTime:       p.deltaCalculator.GetBestLapTime(),
		Position:          lap.CarPosition,
		DRS:               tel.DRS == 1,
		RevLights:         tel.RevLightsPercent,
		Sector:            lap.Sector,
		LapInvalid:        lap.CurrentLapInvalid == 1,
		Timestamp:         time.Now().UnixMilli(),
	}
}

// checkBattleAlerts runs the battle detector against the latest pitwall state
func (p *Processor) checkBattleAlerts(state *dto.PitwallState) {
	if state == nil || len(state.Drivers) == 0 {
		return
	}

	playerIdx := state.PlayerIndex
	if playerIdx < 0 || playerIdx >= len(state.Drivers) {
		return
	}
	player := &state.Drivers[playerIdx]

	// Find drivers immediately ahead and behind by position
	var driverAheadName, driverBehindName string
	var gapAheadMs, gapBehindMs int

	for i := range state.Drivers {
		d := &state.Drivers[i]
		if d.Position == player.Position-1 {
			driverAheadName = d.Name
			gapAheadMs = player.DeltaToCarInFront
		}
		if d.Position == player.Position+1 {
			driverBehindName = d.Name
			gapBehindMs = d.DeltaToCarInFront
		}
	}

	alerts := p.battleDetector.Check(player.CurrentLapNum, gapAheadMs, gapBehindMs, driverAheadName, driverBehindName)
	for i := range alerts {
		alert := alerts[i]
		if alert.Timestamp == 0 {
			alert.Timestamp = time.Now().UnixMilli()
		}
		if alert.ID == "" {
			alert.ID = fmt.Sprintf("ba_%d_%s_%s", alert.Timestamp, alert.Side, alert.DriverBehind)
		}
		msg := dto.WSResponse{
			Type: dto.MessageTypeBattleAlert,
			Data: alert,
		}
		jsonData, err := json.Marshal(msg)
		if err != nil {
			p.logger.Error("failed to marshal battle alert", "error", err)
			continue
		}
		p.hub.Broadcast(jsonData)
		p.recordReplayBattleAlert(alert)
		p.logger.Info("battle alert",
			"side", alert.Side,
			"gap", alert.GapSeconds,
			"closingRate", alert.ClosingRate,
			"estLaps", alert.EstOvertakeLap,
		)
	}
}

// handleEventPacket processes event packets and broadcasts race control notifications
func (p *Processor) handleEventPacket(parsed *udp.ParsedData) {
	event := parsed.Event

	if isRaceEndEvent(event.EventStringCode) {
		p.trySaveRaceSummary(parsed.Header.SessionUID, event.EventStringCode)
	}

	var notification *dto.RaceControlNotification

	switch event.EventStringCode {
	case packets.EventPenalty:
		penalty, ok := event.EventDetails.(*packets.PenaltyEvent)
		if !ok {
			return
		}
		driverName := p.pitwallManager.GetDriverName(penalty.VehicleIdx)
		penaltyStr := packets.PenaltyTypeString(penalty.PenaltyType)
		infringementStr := packets.InfringementTypeString(penalty.InfringementType)

		severity := "warning"
		category := "warning"
		// Drive through, stop-go, disqualification, black flag are critical
		if penalty.PenaltyType <= 1 || penalty.PenaltyType == 6 || penalty.PenaltyType == 17 {
			severity = "critical"
			category = "penalty"
		} else if penalty.PenaltyType == 4 { // Time penalty
			severity = "critical"
			category = "penalty"
		}

		msg := fmt.Sprintf("%s: %s", penaltyStr, infringementStr)
		if penalty.Time > 0 {
			msg = fmt.Sprintf("%s (%ds)", msg, penalty.Time)
		}
		if driverName != "" {
			msg = fmt.Sprintf("[%s] %s", driverName, msg)
		}

		notification = &dto.RaceControlNotification{
			Category:   category,
			Message:    msg,
			Severity:   severity,
			DriverName: driverName,
		}

	case packets.EventRaceWinner:
		winner, ok := event.EventDetails.(*packets.RaceWinnerEvent)
		if !ok {
			return
		}
		driverName := p.pitwallManager.GetDriverName(winner.VehicleIdx)
		winnerMsg := "Race Winner!"
		if driverName != "" {
			winnerMsg = fmt.Sprintf("[%s] Race Winner!", driverName)
		}
		notification = &dto.RaceControlNotification{
			Category:   "info",
			Message:    winnerMsg,
			Severity:   "info",
			DriverName: driverName,
		}

	case packets.EventDriveThroughServed:
		vehicle, ok := event.EventDetails.(*packets.GenericVehicleEvent)
		if !ok {
			return
		}
		driverName := p.pitwallManager.GetDriverName(vehicle.VehicleIdx)
		dtMsg := "Drive-through penalty served"
		if driverName != "" {
			dtMsg = fmt.Sprintf("[%s] Drive-through penalty served", driverName)
		}
		notification = &dto.RaceControlNotification{
			Category:   "info",
			Message:    dtMsg,
			Severity:   "info",
			DriverName: driverName,
		}

	case packets.EventStopGoServed:
		vehicle, ok := event.EventDetails.(*packets.StopGoServedEvent)
		if !ok {
			return
		}
		driverName := p.pitwallManager.GetDriverName(vehicle.VehicleIdx)
		sgMsg := "Stop-go penalty served"
		if driverName != "" {
			sgMsg = fmt.Sprintf("[%s] Stop-go penalty served", driverName)
		}
		notification = &dto.RaceControlNotification{
			Category:   "info",
			Message:    sgMsg,
			Severity:   "info",
			DriverName: driverName,
		}

	default:
		return
	}

	if notification == nil {
		return
	}
	if notification.Timestamp == 0 {
		notification.Timestamp = time.Now().UnixMilli()
	}
	if notification.ID == "" {
		notification.ID = fmt.Sprintf("rc_%d_%s_%d", notification.Timestamp, notification.Category, p.rcSeq.Add(1))
	}

	msg := dto.WSResponse{
		Type: dto.MessageTypeRaceControl,
		Data: notification,
	}
	jsonData, err := json.Marshal(msg)
	if err != nil {
		p.logger.Error("failed to marshal race control notification", "error", err)
		return
	}
	p.hub.Broadcast(jsonData)
	p.recordReplayRaceControl(notification)
	p.countRaceControlNotification(notification)
}

func isRaceEndEvent(eventCode string) bool {
	switch eventCode {
	case packets.EventSessionEnded, packets.EventChequeredFlag, packets.EventRaceWinner:
		return true
	default:
		return false
	}
}

func (p *Processor) observeSessionUID(sessionUID uint64) {
	p.raceSummaryMu.Lock()
	defer p.raceSummaryMu.Unlock()

	if sessionUID == 0 {
		return
	}
	if p.raceSummarySession != sessionUID {
		p.raceSummarySession = sessionUID
		p.raceSummarySaved = false
		p.raceSummaryCounters = RaceSummaryCounts{}
	}
}

func (p *Processor) observeReplaySession(sessionUID uint64) {
	if sessionUID == 0 {
		return
	}

	p.replayMu.Lock()
	defer p.replayMu.Unlock()

	if p.replaySessionUID != sessionUID {
		p.replaySessionUID = sessionUID
		p.replayFrames = nil
		p.replayRaceControl = nil
		p.replayBattleAlert = nil
		p.replayTrackMap = nil
		p.replaySession = nil
		p.replayLastFrameTS = 0
	}
}

func (p *Processor) recordReplayFrame(sessionUID uint64, ts int64, pitwallState *dto.PitwallState) {
	if pitwallState == nil || sessionUID == 0 {
		return
	}

	p.replayMu.Lock()
	defer p.replayMu.Unlock()

	if !p.replayEnabled || p.replaySessionUID != sessionUID {
		return
	}
	if p.replayTrackMap == nil && pitwallState.TrackMap != nil {
		p.replayTrackMap = pitwallState.TrackMap
	}
	if p.replaySession == nil && pitwallState.Session != nil {
		p.replaySession = copySessionInfo(pitwallState.Session)
	}
	if p.replayLastFrameTS != 0 && ts-p.replayLastFrameTS < int64(replayFrameIntervalMS) {
		return
	}
	p.replayLastFrameTS = ts

	pitwallCopy := copyPitwallForReplay(pitwallState)

	frame := ReplayFrame{
		Timestamp: ts,
		Pitwall:   pitwallCopy,
	}
	if len(p.replayRaceControl) > 0 {
		frame.RaceControl = append([]dto.RaceControlNotification(nil), p.replayRaceControl...)
	}
	if len(p.replayBattleAlert) > 0 {
		frame.BattleAlerts = append([]dto.BattleAlertDTO(nil), p.replayBattleAlert...)
	}
	p.replayFrames = append(p.replayFrames, frame)
}

func (p *Processor) recordReplayRaceControl(notification *dto.RaceControlNotification) {
	if notification == nil {
		return
	}

	p.replayMu.Lock()
	defer p.replayMu.Unlock()
	if !p.replayEnabled {
		return
	}

	p.replayRaceControl = append([]dto.RaceControlNotification{*notification}, p.replayRaceControl...)
	if len(p.replayRaceControl) > maxReplayRaceControl {
		p.replayRaceControl = p.replayRaceControl[:maxReplayRaceControl]
	}
}

func (p *Processor) recordReplayBattleAlert(alert dto.BattleAlertDTO) {
	p.replayMu.Lock()
	defer p.replayMu.Unlock()
	if !p.replayEnabled {
		return
	}

	p.replayBattleAlert = append([]dto.BattleAlertDTO{alert}, p.replayBattleAlert...)
	if len(p.replayBattleAlert) > maxReplayBattleAlert {
		p.replayBattleAlert = p.replayBattleAlert[:maxReplayBattleAlert]
	}
}

func (p *Processor) countRaceControlNotification(notification *dto.RaceControlNotification) {
	if notification == nil {
		return
	}

	p.raceSummaryMu.Lock()
	defer p.raceSummaryMu.Unlock()

	switch notification.Category {
	case "penalty":
		p.raceSummaryCounters.Penalty++
	case "warning":
		p.raceSummaryCounters.Warning++
	default:
		p.raceSummaryCounters.Info++
	}
}

func (p *Processor) trySaveRaceSummary(sessionUID uint64, trigger string) {
	p.observeSessionUID(sessionUID)

	p.raceSummaryMu.Lock()
	if !p.raceSummaryEnabled || p.raceSummarySave == nil || p.raceSummarySaved || p.raceSummarySession != sessionUID {
		p.raceSummaryMu.Unlock()
		return
	}
	save := p.raceSummarySave
	counts := p.raceSummaryCounters
	p.raceSummarySaved = true
	p.raceSummaryMu.Unlock()

	state := p.pitwallManager.BuildState()
	if err := save(sessionUID, counts, state); err != nil {
		p.logger.Error("failed to save race summary", "sessionUID", sessionUID, "trigger", trigger, "error", err)
		p.raceSummaryMu.Lock()
		if p.raceSummarySession == sessionUID {
			p.raceSummarySaved = false
		}
		p.raceSummaryMu.Unlock()
		return
	}

	p.logger.Info("race summary saved", "sessionUID", sessionUID, "trigger", trigger)
}

func copyPitwallForReplay(src *dto.PitwallState) *dto.PitwallState {
	if src == nil {
		return nil
	}

	out := &dto.PitwallState{
		PlayerIndex:          src.PlayerIndex,
		TrackMap:             nil,
		ERSComparisonEnabled: src.ERSComparisonEnabled,
	}

	if src.Session != nil {
		out.Session = &dto.SessionInfo{
			Weather:                src.Session.Weather,
			TrackTemp:              src.Session.TrackTemp,
			AirTemp:                src.Session.AirTemp,
			SafetyCar:              src.Session.SafetyCar,
			SessionType:            src.Session.SessionType,
			TotalLaps:              src.Session.TotalLaps,
			TrackID:                src.Session.TrackID,
			TrackName:              src.Session.TrackName,
			TrackLength:            src.Session.TrackLength,
			PitStopWindowIdealLap:  src.Session.PitStopWindowIdealLap,
			PitStopWindowLatestLap: src.Session.PitStopWindowLatestLap,
			PitStopRejoinPosition:  src.Session.PitStopRejoinPosition,
			CrossoverPrediction:    copyCrossoverPrediction(src.Session.CrossoverPrediction),
		}
		if len(src.Session.MarshalZones) > 0 {
			out.Session.MarshalZones = append([]dto.MarshalZoneDTO(nil), src.Session.MarshalZones...)
		}
		if len(src.Session.WeatherForecast) > 0 {
			out.Session.WeatherForecast = append([]dto.WeatherForecastDTO(nil), src.Session.WeatherForecast...)
		}
	}

	if len(src.Positions) > 0 {
		out.Positions = append([]dto.CarPosition(nil), src.Positions...)
	}

	if len(src.Drivers) > 0 {
		out.Drivers = make([]dto.DriverInfo, len(src.Drivers))
		for i := range src.Drivers {
			driver := src.Drivers[i]
			// Omit per-lap analysis from replay frames (large and repeated).
			driver.Dynamics = nil
			if len(driver.StintHistory) > 0 {
				driver.StintHistory = append([]dto.StintInfoDTO(nil), driver.StintHistory...)
			}
			if driver.Damage != nil {
				damageCopy := *driver.Damage
				driver.Damage = &damageCopy
			}
			out.Drivers[i] = driver
		}
	}

	return out
}

func copySessionInfo(src *dto.SessionInfo) *dto.SessionInfo {
	if src == nil {
		return nil
	}

	out := &dto.SessionInfo{
		Weather:                src.Weather,
		TrackTemp:              src.TrackTemp,
		AirTemp:                src.AirTemp,
		SafetyCar:              src.SafetyCar,
		SessionType:            src.SessionType,
		TotalLaps:              src.TotalLaps,
		TrackID:                src.TrackID,
		TrackName:              src.TrackName,
		TrackLength:            src.TrackLength,
		PitStopWindowIdealLap:  src.PitStopWindowIdealLap,
		PitStopWindowLatestLap: src.PitStopWindowLatestLap,
		PitStopRejoinPosition:  src.PitStopRejoinPosition,
		CrossoverPrediction:    copyCrossoverPrediction(src.CrossoverPrediction),
	}
	if len(src.MarshalZones) > 0 {
		out.MarshalZones = append([]dto.MarshalZoneDTO(nil), src.MarshalZones...)
	}
	if len(src.WeatherForecast) > 0 {
		out.WeatherForecast = append([]dto.WeatherForecastDTO(nil), src.WeatherForecast...)
	}
	return out
}

func copyCrossoverPrediction(src *dto.CrossoverPredictionDTO) *dto.CrossoverPredictionDTO {
	if src == nil {
		return nil
	}
	dst := *src
	return &dst
}
