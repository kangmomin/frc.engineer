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

// marshalForHub encodes v as msgpack (binary hub) or JSON (text hub).
func marshalForHub(hub broadcast.Broadcaster, v interface{}) ([]byte, error) {
	if hub.Binary() {
		return dto.MsgpackMarshal(v)
	}
	return json.Marshal(v)
}

// RaceSummaryCounts tracks race-control notification totals for persisted summaries.
type RaceSummaryCounts struct {
	Penalty int
	Warning int
	Info    int
}

// ReplayFrame is one timeline snapshot for dashboard replay.
type ReplayFrame struct {
	Timestamp   int64                         `json:"timestamp"`
	Pitwall     *dto.PitwallState             `json:"pitwall"`
	RaceControl []dto.RaceControlNotification `json:"raceControl,omitempty"`
}

// ReplayTimeline is a complete replay payload for one session.
type ReplayTimeline struct {
	FrameIntervalMS int              `json:"frameIntervalMs"`
	TrackMap        *dto.TrackMapDTO `json:"trackMap,omitempty"`
	Session         *dto.SessionInfo `json:"session,omitempty"`
	Frames          []ReplayFrame    `json:"frames"`
}

const (
	maxReplayRaceControl       = 50
	maxRaceSummaryTimeline     = 20  // base Debrief.Timeline (broadcast + DataChannel)
	maxRaceSummaryRichTimeline = 150 // Detail.Events (persisted rich summary only)
	replayFrameIntervalMS      = 500
)

// RaceSummarySaveCallback is invoked once per session on race-end events. detail
// carries the rich, player-centric inputs (per-lap timings, setup, lap-tagged
// events) gathered from PitwallManager accessors; it is never nil.
type RaceSummarySaveCallback func(sessionUID uint64, counts RaceSummaryCounts, timeline []dto.RaceControlNotification, state *dto.PitwallState, detail *dto.RaceDetailInput) error

// PitwallStateObserver is invoked when a new pitwall snapshot is emitted.
type PitwallStateObserver func(sessionUID uint64, capturedAt time.Time, state *dto.PitwallState)

// Processor processes telemetry data and broadcasts to WebSocket clients
type Processor struct {
	parser          *udp.Parser
	hub             broadcast.Broadcaster
	deltaCalculator *DeltaCalculator
	pitwallManager  *PitwallManager
	logger          *slog.Logger

	// Fast broadcaster for high-frequency position data (optional)
	fastHub broadcast.FastBroadcaster

	// Rate limiting
	minInterval     time.Duration
	lastSend        time.Time
	lastPitwallSend time.Time
	pitwallInterval time.Duration // adaptive: 250ms (4Hz) ↔ 500ms (2Hz)
	noDropStreak    int           // consecutive broadcasts without drops

	// Latest data cache
	mu              sync.RWMutex
	latestTelemetry *packets.CarTelemetryData
	latestLapData   *packets.LapData
	latestHeader    *packets.PacketHeader
	latestPlayerCT2 *packets.CarTelemetry2Data // 2026 Season Pack: 플레이어 Overtake/Active Aero 상태

	// Race summary persistence state
	raceSummaryMu           sync.Mutex
	raceSummaryEnabled      bool
	raceSummarySave         RaceSummarySaveCallback
	raceSummarySession      uint64
	raceSummarySaved        bool
	raceSummaryCounters     RaceSummaryCounts
	raceSummaryTimeline     []dto.RaceControlNotification
	raceSummaryRichTimeline []dto.RaceControlNotification
	// finalSavePending holds the trigger of a FAILED final-class save so the idle
	// tick retries it as final (not mislabeled as a checkpoint). Guarded by
	// raceSummaryMu; cleared on session change and on successful final save.
	finalSavePending string

	// Checkpoint-save mode (sender only; cmd/server keeps legacy behavior).
	// Must be set before Start — read without a mutex from the processor goroutine,
	// same happens-before contract as SetBanChecker.
	checkpointSaves bool
	// done is closed when Start returns — lets the host wait for the shutdown
	// flush that runs inside Start's ctx.Done path.
	done chan struct{}
	// Idle-save bookkeeping, owned exclusively by the Start goroutine.
	lastPacketAt     time.Time
	lastCheckpointAt time.Time

	// Atomic counter for unique race-control notification IDs
	rcSeq atomic.Int64

	// Replay timeline capture state (summary / advanced storage modes)
	replayMu          sync.Mutex
	replayEnabled     bool
	replaySessionUID  uint64
	replayFrames      []ReplayFrame
	replayRaceControl []dto.RaceControlNotification
	replayTrackMap    *dto.TrackMapDTO
	replaySession     *dto.SessionInfo
	replayLastFrameTS int64
	pitwallObserver   PitwallStateObserver

	// Nickname ban gate (player-nickname hard ban)
	banLookup        func(playerName string) bool
	onBanStateChange func(banned bool)
	banned           atomic.Bool

	// Player-involved collision capture (own mutex inside; fed from processPacket)
	incidents *incidentRecorder
}

// NewProcessor creates a new telemetry processor
func NewProcessor(parser *udp.Parser, hub broadcast.Broadcaster, updateRateHz int, logger *slog.Logger, trackStore *tracks.TrackStore) *Processor {
	interval := time.Duration(0)
	if updateRateHz > 0 {
		interval = time.Second / time.Duration(updateRateHz)
	}

	p := &Processor{
		parser:          parser,
		hub:             hub,
		deltaCalculator: NewDeltaCalculator(),
		pitwallManager:  NewPitwallManager(NewStrategyManager(), trackStore, nil),
		logger:          logger,
		minInterval:     interval,
		pitwallInterval: 250 * time.Millisecond,
		done:            make(chan struct{}),
	}
	p.incidents = newIncidentRecorder(logger, p.pitwallManager.GetDriverName)
	return p
}

// SetFastBroadcaster sets the optional high-frequency broadcaster for position data.
func (p *Processor) SetFastBroadcaster(fb broadcast.FastBroadcaster) {
	p.fastHub = fb
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

// SetCheckpointSaves enables checkpoint-class summary saves (idle-timeout /
// session-switch / shutdown flush) and demotes CHQF/RCWN to checkpoints so a
// premature "race winner" event can no longer freeze the summary before the
// player finishes. cmd/sender enables this; cmd/server keeps legacy behavior.
// Must be called before Start (read lock-free from the processor goroutine).
func (p *Processor) SetCheckpointSaves(enabled bool) {
	p.checkpointSaves = enabled
}

// Done is closed when Start returns — after the shutdown flush has completed.
func (p *Processor) Done() <-chan struct{} {
	return p.done
}

// SetPitwallStateObserver sets an optional callback for emitted pitwall snapshots.
func (p *Processor) SetPitwallStateObserver(observer PitwallStateObserver) {
	p.mu.Lock()
	p.pitwallObserver = observer
	p.mu.Unlock()
}

// SetBanChecker installs the predicate used to test the player nickname against
// the ban list. Must be called before Start: the field is read without a mutex
// from the processor goroutine, and the `go Start(...)` establishes the
// happens-before relationship. Changing that ordering would introduce a data race.
func (p *Processor) SetBanChecker(fn func(playerName string) bool) {
	p.banLookup = fn
}

// SetBanStateChangeHandler installs a callback fired once per ban-state
// transition (true=banned, false=lifted). Must be called before Start (same
// no-mutex happens-before as SetBanChecker). Invoked from the processor
// goroutine, so it must not block.
func (p *Processor) SetBanStateChangeHandler(fn func(banned bool)) {
	p.onBanStateChange = fn
}

// IsBanned reports the most recent ban evaluation. Safe from any goroutine.
func (p *Processor) IsBanned() bool {
	return p.banned.Load()
}

// evaluateBan matches the current player nickname against the ban predicate,
// fires the transition callback on state changes, and returns whether the player
// is currently banned. Called only from the processor goroutine.
func (p *Processor) evaluateBan() bool {
	if p.banLookup == nil {
		return false
	}
	banned := p.banLookup(p.pitwallManager.GetPlayerName())
	if prev := p.banned.Swap(banned); prev != banned && p.onBanStateChange != nil {
		p.onBanStateChange(banned)
	}
	return banned
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
		frames[i] = frame
	}

	return &ReplayTimeline{
		FrameIntervalMS: replayFrameIntervalMS,
		TrackMap:        p.replayTrackMap,
		Session:         p.replaySession,
		Frames:          frames,
	}
}

// GetIncidentClips returns the session's captured incident clips, finalizing any
// still-open capture window first (race end can precede the +1s deadline).
// Non-destructive: repeat calls return the same clips, so the save callback's
// failure-retry path stays safe.
func (p *Processor) GetIncidentClips(sessionUID uint64) []dto.IncidentClip {
	return p.incidents.snapshot(sessionUID)
}

// idleSaveAfter / idleSaveTick drive the idle checkpoint: with no telemetry for
// idleSaveAfter (game closed or quit mid-session), the current session's summary
// is checkpoint-saved so the data survives even without a session-end event.
const (
	idleSaveAfter = 3 * time.Minute
	idleSaveTick  = 30 * time.Second
)

// Start begins processing packets from the UDP listener
func (p *Processor) Start(ctx context.Context, packets <-chan []byte) {
	defer close(p.done)

	updateHz := "unlimited"
	if p.minInterval > 0 {
		updateHz = fmt.Sprintf("%d", int(time.Second/p.minInterval))
	}
	p.logger.Info("telemetry processor started", "updateRateHz", updateHz)

	ticker := time.NewTicker(idleSaveTick)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			if p.checkpointSaves {
				p.flushOnShutdown()
			}
			p.logger.Info("telemetry processor shutting down")
			return

		case data, ok := <-packets:
			if !ok {
				if p.checkpointSaves {
					p.flushOnShutdown()
				}
				return
			}
			p.processPacket(data)

		case <-ticker.C:
			if p.checkpointSaves {
				p.idleCheck()
			}
		}
	}
}

// idleCheck runs on the Start goroutine: after idleSaveAfter without packets,
// checkpoint-save the active unsaved session (or retry a failed final save with
// its original trigger) so a silently dead session still leaves a summary.
func (p *Processor) idleCheck() {
	if p.lastPacketAt.IsZero() || time.Since(p.lastPacketAt) < idleSaveAfter {
		return
	}
	// Only save when something new arrived since the last successful checkpoint.
	if !p.lastCheckpointAt.Before(p.lastPacketAt) {
		return
	}

	p.raceSummaryMu.Lock()
	uid := p.raceSummarySession
	saved := p.raceSummarySaved
	pending := p.finalSavePending
	p.raceSummaryMu.Unlock()
	if uid == 0 || saved || !p.pitwallManager.PlayerHasCompletedLap() {
		return
	}

	ok := false
	if pending != "" {
		// A final-class save failed earlier — retry as final, not as a checkpoint,
		// so the summary keeps its final trigger and upload eligibility.
		ok = p.saveRaceSummary(uid, pending, true)
	} else {
		ok = p.saveRaceSummary(uid, "idle-timeout", false)
	}
	if ok {
		p.lastCheckpointAt = time.Now()
	}
}

// flushOnShutdown checkpoint-saves the active unsaved session on the way out of
// Start (processor goroutine — single-owner access to all state). A pending
// failed final keeps its final trigger.
func (p *Processor) flushOnShutdown() {
	p.raceSummaryMu.Lock()
	uid := p.raceSummarySession
	saved := p.raceSummarySaved
	pending := p.finalSavePending
	p.raceSummaryMu.Unlock()
	if uid == 0 || saved || !p.pitwallManager.PlayerHasCompletedLap() {
		return
	}
	if pending != "" {
		p.saveRaceSummary(uid, pending, true)
		return
	}
	p.saveRaceSummary(uid, "shutdown", false)
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

	if parsed.Header.SessionUID != 0 {
		// Idle-save clock (Start-goroutine-owned). Only UID-bearing packets count —
		// stray/unset-UID artifacts must not suppress the idle checkpoint.
		p.lastPacketAt = time.Now()
	}
	if p.checkpointSaves {
		// Finalize the previous session BEFORE observeSessionUID resets the summary
		// state and before this packet feeds pitwallManager (which still holds the
		// previous session's data here) — a session that was switched away from can
		// never resume, so its last observed state is final.
		p.maybeFinalizePreviousSession(parsed.Header.SessionUID)
	}
	p.observeSessionUID(parsed.Header.SessionUID)
	p.observeReplaySession(parsed.Header.SessionUID)
	p.incidents.observeSession(parsed.Header.SessionUID)

	// Feed pitwall manager with all packet types first, so ban evaluation and
	// every downstream broadcast observe the latest participants / player index.
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
	if parsed.TyreSets != nil {
		p.pitwallManager.UpdateTyreSets(parsed.TyreSets)
	}
	if parsed.SessionHistory != nil {
		p.pitwallManager.UpdateSessionHistory(parsed.SessionHistory)
	}
	if parsed.MotionEx != nil {
		p.pitwallManager.UpdateMotionEx(parsed.MotionEx)
	}
	if parsed.CarTelemetry2 != nil {
		p.pitwallManager.UpdateCarTelemetry2(parsed.CarTelemetry2)
	}

	// Hard ban gate: when the player's nickname is on the ban list, skip ALL
	// event handling and broadcasts (positions / pitwall / dashboard / replay).
	// The pitwall manager was still updated above, so a nickname or list change
	// automatically lifts the ban on a subsequent packet.
	if p.evaluateBan() {
		return
	}

	// Incident recorder feed: full-grid latest caches + ~20Hz motion sampling.
	// Deliberately after the ban gate — a banned sender must not capture.
	if parsed.Telemetry != nil {
		p.incidents.noteTelemetry(parsed.Telemetry)
	}
	if parsed.LapData != nil {
		p.incidents.noteLapData(parsed.LapData)
	}
	if parsed.Motion != nil {
		p.incidents.noteMotion(parsed.Motion, parsed.Header)
	}

	// Handle event packets (penalties, warnings, race control)
	if parsed.Event != nil {
		p.handleEventPacket(parsed)
	}

	// Broadcast positions at full rate (60Hz) over fast channel
	if parsed.Motion != nil && p.fastHub != nil {
		if positions := p.pitwallManager.BuildPositions(); positions != nil {
			msg := dto.WSResponse{
				Type: dto.MessageTypePositionUpdate,
				Data: positions,
			}
			if fastData, err := dto.MsgpackMarshal(msg); err == nil {
				p.fastHub.BroadcastFast(fastData)
			}
		}
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

	if parsed.CarTelemetry2 != nil {
		if idx := int(parsed.Header.PlayerCarIndex); idx < packets.MaxCars {
			ct2 := parsed.CarTelemetry2.CarTelemetry2Data[idx]
			p.latestPlayerCT2 = &ct2
		}
	}

	now := time.Now()
	var (
		pitwallState    *dto.PitwallState
		pitwallObserver PitwallStateObserver
		dashData        *dto.Dashboard
	)

	// Broadcast pitwallState at adaptive rate (4Hz ↔ 2Hz based on congestion)
	if now.Sub(p.lastPitwallSend) >= p.pitwallInterval && p.pitwallManager.HasData() {
		p.lastPitwallSend = now
		pitwallState = p.pitwallManager.BuildState()
		pitwallObserver = p.pitwallObserver
	}

	// Check rate limit for telemetry dashboard
	if now.Sub(p.lastSend) < p.minInterval {
		p.mu.Unlock()
	} else {
		// Build and send dashboard data
		if p.latestTelemetry != nil && p.latestLapData != nil && p.latestHeader != nil {
			dashData = p.buildDashboardData()
			p.lastSend = now
		}
		p.mu.Unlock()
	}

	if pitwallState != nil {
		// Use typed path if available (avoids double marshal/unmarshal losing bool fields)
		if pb, ok := p.hub.(broadcast.PitwallBroadcaster); ok {
			pb.BroadcastPitwallState(*pitwallState)
		} else {
			msg := dto.WSResponse{
				Type: dto.MessageTypePitwallState,
				Data: pitwallState,
			}
			pitwallData, err := marshalForHub(p.hub, msg)
			if err != nil {
				p.logger.Error("failed to marshal pitwall state", "error", err)
			} else {
				p.hub.Broadcast(pitwallData)
			}
		}

		{
			// Adaptive rate: slow down if ≥25% peers dropping, speed up when clear
			if cr, ok := p.hub.(broadcast.CongestionReporter); ok {
				if cr.DropRatio() >= 0.25 {
					p.pitwallInterval = 500 * time.Millisecond
					p.noDropStreak = 0
				} else {
					p.noDropStreak++
					if p.noDropStreak >= 8 && p.pitwallInterval > 250*time.Millisecond {
						p.pitwallInterval = 250 * time.Millisecond
					}
				}
			}
		}

		p.recordReplayFrame(parsed.Header.SessionUID, now.UnixMilli(), pitwallState)
		if pitwallObserver != nil {
			pitwallObserver(parsed.Header.SessionUID, now, pitwallState)
		}
	}

	if dashData != nil {
		dashBytes, err := marshalForHub(p.hub, dashData)
		if err != nil {
			p.logger.Error("failed to marshal dashboard data", "error", err)
			return
		}
		p.hub.Broadcast(dashBytes)
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
		// 2026 모드에서는 DRS가 폐지되어 Overtake(Manual Override)가 부스트 인디케이터다.
		DRS:        tel.DRS == 1 || (p.latestPlayerCT2 != nil && p.latestPlayerCT2.OvertakeActive == 1),
		RevLights:  tel.RevLightsPercent,
		Sector:     lap.Sector,
		LapInvalid: lap.CurrentLapInvalid == 1,
		Timestamp:  time.Now().UnixMilli(),
	}
}

// handleEventPacket processes event packets and broadcasts race control notifications
func (p *Processor) handleEventPacket(parsed *udp.ParsedData) {
	event := parsed.Event
	shouldFinalize := isRaceEndEvent(event.EventStringCode)

	var notification *dto.RaceControlNotification

	switch event.EventStringCode {
	case packets.EventPenalty:
		penalty, ok := event.EventDetails.(*packets.PenaltyEvent)
		if !ok {
			return
		}
		// Log for the leaderboard per-driver penalty hover detail (independent of the
		// transient race-control notification below). Pass the event's own SessionUID
		// so a PENA for a new session that lands before that session's first Session
		// packet resets the stale log itself.
		p.pitwallManager.RecordPenalty(penalty, event.Header.SessionUID)
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

	case packets.EventCollision:
		// 이벤트 헤더의 PlayerCarIndex를 직접 쓴다 — pm.playerIndex는 Motion 미수신 시 0.
		if coll, ok := event.EventDetails.(*packets.CollisionEvent); ok {
			p.incidents.onCollision(&event.Header, coll.Vehicle1Idx, coll.Vehicle2Idx)
		}
		return

	case packets.EventFlashback:
		p.incidents.onFlashback()
		return

	default:
		if shouldFinalize {
			p.saveRaceSummaryForEvent(parsed.Header.SessionUID, event.EventStringCode)
		}
		return
	}

	if notification == nil {
		if shouldFinalize {
			p.saveRaceSummaryForEvent(parsed.Header.SessionUID, event.EventStringCode)
		}
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
	rcData, err := marshalForHub(p.hub, msg)
	if err != nil {
		p.logger.Error("failed to marshal race control notification", "error", err)
		return
	}
	p.hub.Broadcast(rcData)
	p.recordReplayRaceControl(notification)
	p.recordRaceSummaryNotification(notification)
	if shouldFinalize {
		p.saveRaceSummaryForEvent(parsed.Header.SessionUID, event.EventStringCode)
	}
}

func isRaceEndEvent(eventCode string) bool {
	switch eventCode {
	case packets.EventSessionEnded, packets.EventChequeredFlag, packets.EventRaceWinner:
		return true
	default:
		return false
	}
}

// saveRaceSummaryForEvent maps a race-end event to a save. Under checkpoint mode
// only SEND is final — CHQF/RCWN fire when the LEADER finishes, so treating them
// as final would freeze the summary before the player's remaining laps land in
// the session history. Legacy mode (cmd/server) keeps all three final.
func (p *Processor) saveRaceSummaryForEvent(sessionUID uint64, eventCode string) {
	final := !p.checkpointSaves || eventCode == packets.EventSessionEnded
	p.saveRaceSummary(sessionUID, eventCode, final)
}

func (p *Processor) observeSessionUID(sessionUID uint64) {
	if sessionUID == 0 {
		return
	}

	p.raceSummaryMu.Lock()
	changed := p.raceSummarySession != sessionUID
	if changed {
		p.raceSummarySession = sessionUID
		p.raceSummarySaved = false
		p.raceSummaryCounters = RaceSummaryCounts{}
		p.raceSummaryTimeline = nil
		p.raceSummaryRichTimeline = nil
		p.finalSavePending = ""
	}
	p.raceSummaryMu.Unlock()
	// 랩 다이내믹스 누적치의 세션 전환 리셋은 pitwallManager.noteSessionLocked이
	// 매 Update 경로에서 SessionUID 변경 시 수행하므로 여기서 별도 호출하지 않는다.
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

	replayState := p.pitwallManager.BuildReplayState()
	if replayState == nil {
		replayState = pitwallState
	}

	pitwallCopy := copyPitwallForReplay(replayState)

	frame := ReplayFrame{
		Timestamp: ts,
		Pitwall:   pitwallCopy,
	}
	if len(p.replayRaceControl) > 0 {
		frame.RaceControl = append([]dto.RaceControlNotification(nil), p.replayRaceControl...)
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

func (p *Processor) recordRaceSummaryNotification(notification *dto.RaceControlNotification) {
	if notification == nil {
		return
	}

	// Lap-tag at emit time (the race lap this event occurred on). "When" for the
	// event timeline; "where" (track position) is not carried by the event packet.
	tagged := *notification
	if tagged.Lap == 0 {
		tagged.Lap = p.pitwallManager.GetPlayerCurrentLap()
	}

	p.raceSummaryMu.Lock()
	defer p.raceSummaryMu.Unlock()

	switch tagged.Category {
	case "penalty":
		p.raceSummaryCounters.Penalty++
	case "warning":
		p.raceSummaryCounters.Warning++
	default:
		p.raceSummaryCounters.Info++
	}

	p.raceSummaryTimeline = append(p.raceSummaryTimeline, tagged)
	if len(p.raceSummaryTimeline) > maxRaceSummaryTimeline {
		p.raceSummaryTimeline = append([]dto.RaceControlNotification(nil), p.raceSummaryTimeline[len(p.raceSummaryTimeline)-maxRaceSummaryTimeline:]...)
	}

	// Separate, larger buffer for the persisted rich summary's event timeline.
	// Kept apart from the base timeline so raising its cap never grows the base
	// Debrief.Timeline that rides the broadcast / DataChannel payload.
	p.raceSummaryRichTimeline = append(p.raceSummaryRichTimeline, tagged)
	if len(p.raceSummaryRichTimeline) > maxRaceSummaryRichTimeline {
		p.raceSummaryRichTimeline = append([]dto.RaceControlNotification(nil), p.raceSummaryRichTimeline[len(p.raceSummaryRichTimeline)-maxRaceSummaryRichTimeline:]...)
	}
}

// maybeFinalizePreviousSession runs on the processor goroutine right before
// observeSessionUID would reset the summary state for a new UID: an unsaved
// previous session with at least one completed lap gets a final save (it can
// never resume). Must be called BEFORE this packet feeds pitwallManager — its
// caches still hold the previous session's data at that point.
func (p *Processor) maybeFinalizePreviousSession(newUID uint64) {
	if newUID == 0 {
		return
	}
	p.raceSummaryMu.Lock()
	prev := p.raceSummarySession
	saved := p.raceSummarySaved
	p.raceSummaryMu.Unlock()
	if prev == 0 || prev == newUID || saved {
		return
	}
	if !p.pitwallManager.PlayerHasCompletedLap() {
		return
	}
	if !p.saveRaceSummary(prev, "session-switch", true) {
		// 직후 상태 리셋으로 이 세션 데이터가 사라지므로 1회 즉시 재시도 —
		// 그래도 실패하면 유실 (수용된 한계: 로컬 디스크 오류 한정).
		p.saveRaceSummary(prev, "session-switch", true)
	}
}

// saveRaceSummary persists the session's summary via the save callback.
// markSaved=true is a final save: it locks the session (raceSummarySaved) and on
// failure rolls the lock back AND records the trigger in finalSavePending so the
// idle tick retries as final. markSaved=false is a checkpoint: the session stays
// open for the real end-of-session save. Returns whether the save succeeded.
func (p *Processor) saveRaceSummary(sessionUID uint64, trigger string, markSaved bool) bool {
	p.observeSessionUID(sessionUID)

	p.raceSummaryMu.Lock()
	if !p.raceSummaryEnabled || p.raceSummarySave == nil || p.raceSummarySaved || p.raceSummarySession != sessionUID {
		p.raceSummaryMu.Unlock()
		return false
	}
	save := p.raceSummarySave
	counts := p.raceSummaryCounters
	timeline := append([]dto.RaceControlNotification(nil), p.raceSummaryTimeline...)
	richEvents := append([]dto.RaceControlNotification(nil), p.raceSummaryRichTimeline...)
	if markSaved {
		p.raceSummarySaved = true
	}
	p.raceSummaryMu.Unlock()

	// Gather rich, player-centric inputs after BuildState releases the lock (this
	// runs on the processor's single goroutine, so no TOCTOU on the player index).
	state := p.pitwallManager.BuildState()
	playerIdx := state.PlayerIndex
	detail := &dto.RaceDetailInput{
		PlayerLaps:      p.pitwallManager.PlayerLapTimings(playerIdx),
		PlayerSetup:     p.pitwallManager.PlayerSetup(playerIdx),
		RichEvents:      richEvents,
		CaptureStartLap: p.pitwallManager.CaptureStartLap(),
		FinalizeTrigger: trigger,
	}
	if err := save(sessionUID, counts, timeline, state, detail); err != nil {
		p.logger.Error("failed to save race summary", "sessionUID", sessionUID, "trigger", trigger, "error", err)
		if markSaved {
			p.raceSummaryMu.Lock()
			if p.raceSummarySession == sessionUID {
				p.raceSummarySaved = false
				p.finalSavePending = trigger
			}
			p.raceSummaryMu.Unlock()
		}
		return false
	}

	if markSaved {
		p.raceSummaryMu.Lock()
		if p.raceSummarySession == sessionUID {
			p.finalSavePending = ""
		}
		p.raceSummaryMu.Unlock()
	}
	p.logger.Info("race summary saved", "sessionUID", sessionUID, "trigger", trigger, "final", markSaved)
	return true
}

func copyPitwallForReplay(src *dto.PitwallState) *dto.PitwallState {
	if src == nil {
		return nil
	}

	out := &dto.PitwallState{
		PlayerIndex:          src.PlayerIndex,
		GameFormat:           src.GameFormat,
		TrackMap:             nil,
		ERSEstimateEnabled:   src.ERSEstimateEnabled,
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
