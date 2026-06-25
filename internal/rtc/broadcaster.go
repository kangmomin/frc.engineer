package rtc

import (
	"sync/atomic"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
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
//
// Payloads still differ per peer by active view ("cockpit" vs "qualifying"),
// which controls DriverStatus visibility; the cache keys on that view.
func (b *DataChannelBroadcaster) BroadcastPitwallState(state interface{}) {
	pitwallState, ok := state.(dto.PitwallState)
	if !ok {
		return
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: pitwallState,
	}

	dropped, total := b.peerManager.BroadcastPerPeer(func(_ string, view string) []byte {
		return variants.resolve(view)
	})
	b.lastDrops.Store(int32(dropped))
	b.lastTotal.Store(int32(total))
}

// Broadcast sends the message to all connected peers via DataChannel.
// For non-pitwallState messages only (raceControl, raceResult, etc.).
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	b.peerManager.BroadcastAll(message)
}

// BroadcastRaceResult sends the race summary to every connected peer.
func (b *DataChannelBroadcaster) BroadcastRaceResult(summary *races.RaceSummary) {
	if summary == nil {
		return
	}
	if b.peerManager.ConnectedCount() == 0 {
		return // no open data channels — skip the marshal entirely
	}

	payload, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypeRaceResult,
		Data: summary,
	})
	if err != nil {
		b.peerManager.logger.Warn("failed to marshal race result", "error", err)
		return
	}
	b.peerManager.BroadcastAll(payload)
}

type pitwallBroadcastVariants struct {
	cache map[string][]byte
	state dto.PitwallState
}

// resolve builds the pitwall payload for a given peer view. The only per-peer
// dimension is the view: a non-qualifying view hides DriverStatus. All
// telemetry is sent unconditionally.
func (v *pitwallBroadcastVariants) resolve(view string) []byte {
	if v == nil {
		return nil
	}

	if view == "" {
		view = "cockpit"
	}

	if cached, ok := v.cache[view]; ok {
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

	state.ERSEstimateEnabled = true
	state.ERSComparisonEnabled = hasERSActualData(state.Drivers)

	for i := range state.Drivers {
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
	v.cache[view] = payload
	return payload
}

func hasERSActualData(drivers []dto.DriverInfo) bool {
	for _, driver := range drivers {
		if driver.ERSActualReady {
			return true
		}
	}
	return false
}
