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

// Processor processes telemetry data and broadcasts to WebSocket clients
type Processor struct {
	parser          *udp.Parser
	hub             *websocket.Hub
	deltaCalculator *DeltaCalculator
	pitwallManager  *PitwallManager
	logger          *slog.Logger

	// Rate limiting
	minInterval     time.Duration
	lastSend        time.Time
	lastPitwallSend time.Time

	// Latest data cache
	mu             sync.RWMutex
	latestTelemetry *packets.CarTelemetryData
	latestLapData   *packets.LapData
	latestHeader    *packets.PacketHeader
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

// handleEventPacket processes event packets and broadcasts race control notifications
func (p *Processor) handleEventPacket(parsed *udp.ParsedData) {
	event := parsed.Event
	playerIdx := parsed.Header.PlayerCarIndex

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
		vehicle, ok := event.EventDetails.(*packets.GenericVehicleEvent)
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
}
