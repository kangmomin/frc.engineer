package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

// RaceSummaryCounts tracks race-control notification totals for persisted summaries.
type RaceSummaryCounts struct {
	Penalty int
	Warning int
	Info    int
}

// RaceSummarySaveCallback is invoked once per session on race-end events.
type RaceSummarySaveCallback func(sessionUID uint64, counts RaceSummaryCounts, state *dto.PitwallState) error

// Processor processes telemetry data and broadcasts to WebSocket clients
type Processor struct {
	parser          *udp.Parser
	hub             *websocket.Hub
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
}

// NewProcessor creates a new telemetry processor
func NewProcessor(parser *udp.Parser, hub *websocket.Hub, updateRateHz int, logger *slog.Logger, trackStore *tracks.TrackStore) *Processor {
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
	for _, alert := range alerts {
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
	playerIdx := parsed.Header.PlayerCarIndex

	if isRaceEndEvent(event.EventStringCode) {
		p.trySaveRaceSummary(parsed.Header.SessionUID, event.EventStringCode)
	}

	var notification *dto.RaceControlNotification

	switch event.EventStringCode {
	case packets.EventPenalty:
		penalty, ok := event.EventDetails.(*packets.PenaltyEvent)
		if !ok || penalty.VehicleIdx != playerIdx {
			return
		}
		penaltyStr := packets.PenaltyTypeString(penalty.PenaltyType)
		infringementStr := packets.InfringementTypeString(penalty.InfringementType)

		severity := "warning"
		category := "warning"
		// Drive through, stop-go, disqualification, black flag are critical
		if penalty.PenaltyType <= 1 || penalty.PenaltyType == 6 || penalty.PenaltyType == 17 {
			severity = "critical"
			category = "penalty"
		} else if penalty.PenaltyType == 4 { // Time penalty
			category = "penalty"
		}

		msg := fmt.Sprintf("%s: %s", penaltyStr, infringementStr)
		if penalty.Time > 0 {
			msg = fmt.Sprintf("%s (%ds)", msg, penalty.Time)
		}

		notification = &dto.RaceControlNotification{
			Category: category,
			Message:  msg,
			Severity: severity,
		}

	case packets.EventRaceWinner:
		winner, ok := event.EventDetails.(*packets.RaceWinnerEvent)
		if !ok || winner.VehicleIdx != playerIdx {
			return
		}
		notification = &dto.RaceControlNotification{
			Category: "info",
			Message:  "Race Winner!",
			Severity: "info",
		}

	case packets.EventDriveThroughServed:
		vehicle, ok := event.EventDetails.(*packets.GenericVehicleEvent)
		if !ok || vehicle.VehicleIdx != playerIdx {
			return
		}
		notification = &dto.RaceControlNotification{
			Category: "info",
			Message:  "Drive-through penalty served",
			Severity: "info",
		}

	case packets.EventStopGoServed:
		vehicle, ok := event.EventDetails.(*packets.StopGoServedEvent)
		if !ok || vehicle.VehicleIdx != playerIdx {
			return
		}
		notification = &dto.RaceControlNotification{
			Category: "info",
			Message:  "Stop-go penalty served",
			Severity: "info",
		}

	default:
		return
	}

	if notification == nil {
		return
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
