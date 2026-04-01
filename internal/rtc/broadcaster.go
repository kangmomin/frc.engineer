package rtc

import (
	"sync/atomic"

	"frc.engineer/internal/dto"
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

// DropRatio returns the fraction of peers that had messages dropped (0.0–1.0).
func (b *DataChannelBroadcaster) DropRatio() float64 {
	total := b.lastTotal.Load()
	if total == 0 {
		return 0
	}
	return float64(b.lastDrops.Load()) / float64(total)
}

// Binary returns true — DataChannel uses msgpack binary frames.
func (b *DataChannelBroadcaster) Binary() bool { return true }

// BroadcastFast sends a message over the fast (unreliable) DataChannel to all peers.
func (b *DataChannelBroadcaster) BroadcastFast(message []byte) {
	b.peerManager.BroadcastAllFast(message)
}

// Broadcast sends the message to all connected peers via DataChannel.
// Non-pitwallState messages are broadcast to all peers without filtering.
// PitwallState messages are filtered per-peer; if filtering fails, the message is dropped (fail-closed).
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	variants, ok := buildPitwallBroadcastVariants(message)
	if !ok {
		// Not a pitwallState message (raceControl, battleAlert, etc.) — safe to broadcast to all
		if isPitwallMessage(message) {
			// pitwallState but failed to parse for filtering — drop to prevent data leak
			return
		}
		b.peerManager.BroadcastAll(message)
		return
	}

	dropped, total := b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions) []byte {
		return variants.resolve(permissions)
	})
	b.lastDrops.Store(int32(dropped))
	b.lastTotal.Store(int32(total))
}

// isPitwallMessage does a lightweight check for pitwallState type marker in msgpack bytes.
func isPitwallMessage(data []byte) bool {
	// Check if the msgpack payload contains "pitwallState" as a string value.
	// The type field value "pitwallState" (12 bytes) appears as 0xac (fixstr len 12) + ASCII.
	marker := []byte{0xac, 'p', 'i', 't', 'w', 'a', 'l', 'l', 'S', 't', 'a', 't', 'e'}
	for i := range data {
		if i+len(marker) > len(data) {
			break
		}
		match := true
		for j := range marker {
			if data[i+j] != marker[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

type pitwallBroadcastVariants struct {
	cache map[string][]byte
	state dto.PitwallState
}

func (v *pitwallBroadcastVariants) resolve(permissions signaling.Permissions) []byte {
	if v == nil {
		return nil
	}

	key := "base"
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
	if permissions.ViewCommentary {
		key += "|commentary"
	}
	if permissions.ViewQualifying {
		key += "|qualifying"
	}
	if cached, ok := v.cache[key]; ok {
		return cached
	}

	state := v.state
	// Deep copy Drivers slice to avoid mutating the shared original
	if len(state.Drivers) > 0 {
		copied := make([]dto.DriverInfo, len(state.Drivers))
		copy(copied, state.Drivers)
		state.Drivers = copied
	}
	state.ERSComparisonEnabled = permissions.ViewERSActual && hasERSActualData(state.Drivers)
	// ERSEstimateEnabled is always true — estimates are derived from public telemetry
	for i := range state.Drivers {
		if !permissions.ViewERSActual {
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
		if !permissions.ViewCommentary && !permissions.ViewAdvancedStrategy {
			state.Drivers[i].TyreSetWear = nil
			state.Drivers[i].TyreLifeSpan = nil
			state.Drivers[i].TyreUsableLife = nil
			state.Drivers[i].AvailableSets = nil
			state.Drivers[i].BestSector1Ms = nil
			state.Drivers[i].BestSector2Ms = nil
			state.Drivers[i].BestSector3Ms = nil
			state.Drivers[i].DriverStatus = 0
		}
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

func buildPitwallBroadcastVariants(message []byte) (*pitwallBroadcastVariants, bool) {
	var envelope dto.WSResponse
	if err := dto.MsgpackUnmarshal(message, &envelope); err != nil {
		return nil, false
	}
	if envelope.Type != dto.MessageTypePitwallState {
		return nil, false
	}

	// Re-encode then decode the Data field to get a typed PitwallState
	dataBytes, err := dto.MsgpackMarshal(envelope.Data)
	if err != nil {
		return nil, false
	}
	var state dto.PitwallState
	if err := dto.MsgpackUnmarshal(dataBytes, &state); err != nil {
		return nil, false
	}

	return &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: state,
	}, true
}

func hasERSActualData(drivers []dto.DriverInfo) bool {
	for _, driver := range drivers {
		if driver.ERSActualReady {
			return true
		}
	}
	return false
}
