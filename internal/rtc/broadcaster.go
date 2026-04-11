package rtc

import (
	"sync/atomic"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/signaling"
)

// DataChannelBroadcaster implements broadcast.Broadcaster using WebRTC DataChannels.
type DataChannelBroadcaster struct {
	peerManager *PeerManager
	lastDrops   atomic.Int32
	lastTotal   atomic.Int32
}

// NewDataChannelBroadcaster wraps a PeerManager as a Broadcaster.
func NewDataChannelBroadcaster(pm *PeerManager) *DataChannelBroadcaster {
	return &DataChannelBroadcaster{peerManager: pm}
}

// DroppedCount returns the number of peers that had messages dropped in the last broadcast cycle.
func (b *DataChannelBroadcaster) DroppedCount() int {
	return int(b.lastDrops.Load())
}

// DropRatio returns the fraction of peers that had messages dropped (0.0..1.0).
func (b *DataChannelBroadcaster) DropRatio() float64 {
	total := b.lastTotal.Load()
	if total == 0 {
		return 0
	}
	return float64(b.lastDrops.Load()) / float64(total)
}

// Binary returns true because DataChannel uses msgpack binary frames.
func (b *DataChannelBroadcaster) Binary() bool { return true }

// BroadcastFast sends a message over the fast (unreliable) DataChannel to all peers.
func (b *DataChannelBroadcaster) BroadcastFast(message []byte) {
	b.peerManager.BroadcastAllFast(message)
}

// BroadcastPitwallState accepts a typed PitwallState struct directly,
// avoiding the double marshal/unmarshal that loses bool fields via interface{}.
func (b *DataChannelBroadcaster) BroadcastPitwallState(state interface{}) {
	pitwallState, ok := state.(dto.PitwallState)
	if !ok {
		return
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: pitwallState,
	}

	dropped, total := b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions, view string) []byte {
		return variants.resolve(permissions, view)
	})
	b.lastDrops.Store(int32(dropped))
	b.lastTotal.Store(int32(total))
}

// Broadcast sends the message to all connected peers via DataChannel.
// For non-pitwallState messages only (raceControl, raceResult, etc.).
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	b.peerManager.BroadcastAll(message)
}

// BroadcastRaceResult sends a filtered race summary to each connected peer.
func (b *DataChannelBroadcaster) BroadcastRaceResult(summary *races.RaceSummary) {
	if summary == nil {
		return
	}

	variants := &raceResultBroadcastVariants{
		cache:   make(map[string][]byte),
		summary: summary,
	}

	dropped, total := b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions, _ string) []byte {
		return variants.resolve(permissions)
	})
	b.lastDrops.Store(int32(dropped))
	b.lastTotal.Store(int32(total))
}

type pitwallBroadcastVariants struct {
	cache map[string][]byte
	state dto.PitwallState
}

type raceResultBroadcastVariants struct {
	cache   map[string][]byte
	summary *races.RaceSummary
}

func (v *pitwallBroadcastVariants) resolve(permissions signaling.Permissions, view string) []byte {
	if v == nil {
		return nil
	}

	if view == "" {
		view = "cockpit"
	}

	key := view
	if permissions.ViewERSEstimate {
		key += "|ers-est"
	}
	if permissions.ViewERSActual {
		key += "|ers"
	}
	if permissions.ViewPitStatus {
		key += "|pit"
	}
	if permissions.ViewTopSpeed {
		key += "|top"
	}
	if permissions.ViewPlayerDelta {
		key += "|player-delta"
	}
	if permissions.ViewAdvancedStrategy {
		key += "|adv-strategy"
	}
	if cached, ok := v.cache[key]; ok {
		return cached
	}

	state := v.state
	if len(state.Drivers) > 0 {
		copied := make([]dto.DriverInfo, len(state.Drivers))
		copy(copied, state.Drivers)
		state.Drivers = copied
	}
	if state.Session != nil {
		sessionCopy := *state.Session
		state.Session = &sessionCopy
	}

	state.ERSComparisonEnabled = permissions.ViewERSEstimate && permissions.ViewERSActual && hasERSActualData(state.Drivers)
	state.ERSEstimateEnabled = permissions.ViewERSEstimate

	for i := range state.Drivers {
		if !permissions.ViewERSEstimate {
			state.Drivers[i].ERSEstimatePct = 0
			state.Drivers[i].ERSEstimateReady = false
		}
		if !permissions.ViewERSActual {
			state.Drivers[i].ERSStoreEnergy = 0
			state.Drivers[i].ERSDeployMode = 0
			state.Drivers[i].ERSDeployedThisLap = 0
			state.Drivers[i].ERSHarvestedThisLap = 0
			state.Drivers[i].ERSActualPct = 0
			state.Drivers[i].ERSActualReady = false
		}
		if !permissions.ViewPitStatus {
			state.Drivers[i].PitStatus = 0
			state.Drivers[i].PitStopTimer = 0
			state.Drivers[i].PitLaneTime = 0
		}
		if !permissions.ViewTopSpeed {
			state.Drivers[i].TopSpeed = 0
		}
		if !permissions.ViewPlayerDelta {
			state.Drivers[i].DeltaToPlayer = 0
		}
		if !permissions.ViewAdvancedStrategy {
			state.Drivers[i].TyreSetWear = nil
			state.Drivers[i].TyreLifeSpan = nil
			state.Drivers[i].TyreUsableLife = nil
			state.Drivers[i].AvailableSets = nil
			state.Drivers[i].BestSector1Ms = nil
			state.Drivers[i].BestSector2Ms = nil
			state.Drivers[i].BestSector3Ms = nil
		}
		if view != "qualifying" {
			state.Drivers[i].DriverStatus = 0
		}
		state.Drivers[i].ResultStatus = 0
	}

	payload, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: state,
	})
	if err != nil {
		return nil
	}
	v.cache[key] = payload
	return payload
}

func (v *raceResultBroadcastVariants) resolve(permissions signaling.Permissions) []byte {
	if v == nil || v.summary == nil {
		return nil
	}

	key := "basic"
	if permissions.ViewAdvancedStrategy {
		key = "advanced-strategy"
	}
	if cached, ok := v.cache[key]; ok {
		return cached
	}

	filtered := cloneRaceSummary(v.summary)
	if filtered == nil {
		return nil
	}
	if !permissions.ViewAdvancedStrategy && filtered.Debrief != nil {
		filtered.Debrief.Tyres.FinalSetWearPct = 0
		filtered.Debrief.Tyres.LifeSpan = 0
		filtered.Debrief.Tyres.UsableLife = 0
		filtered.Debrief.Tyres.LifeRemainingPct = 0
	}

	payload, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypeRaceResult,
		Data: filtered,
	})
	if err != nil {
		return nil
	}
	v.cache[key] = payload
	return payload
}

func cloneRaceSummary(summary *races.RaceSummary) *races.RaceSummary {
	if summary == nil {
		return nil
	}

	cloned := *summary
	if summary.Debrief != nil {
		debriefCopy := *summary.Debrief
		if len(summary.Debrief.Timeline) > 0 {
			debriefCopy.Timeline = append([]dto.RaceControlNotification(nil), summary.Debrief.Timeline...)
		}
		cloned.Debrief = &debriefCopy
	}
	return &cloned
}

func hasERSActualData(drivers []dto.DriverInfo) bool {
	for _, driver := range drivers {
		if driver.ERSActualReady {
			return true
		}
	}
	return false
}
