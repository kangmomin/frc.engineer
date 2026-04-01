package rtc

import (
	"encoding/json"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/signaling"
)

// DataChannelBroadcaster implements broadcast.Broadcaster using WebRTC DataChannels.
type DataChannelBroadcaster struct {
	peerManager *PeerManager
}

// NewDataChannelBroadcaster wraps a PeerManager as a Broadcaster.
func NewDataChannelBroadcaster(pm *PeerManager) *DataChannelBroadcaster {
	return &DataChannelBroadcaster{peerManager: pm}
}

// BroadcastFast sends a message over the fast (unreliable) DataChannel to all peers.
func (b *DataChannelBroadcaster) BroadcastFast(message []byte) {
	b.peerManager.BroadcastAllFast(message)
}

// Broadcast sends the message to all connected peers via DataChannel.
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	variants, ok := buildPitwallBroadcastVariants(message)
	if !ok {
		b.peerManager.BroadcastAll(message)
		return
	}

	b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions) []byte {
		return variants.resolve(permissions)
	})
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
	state.ERSEstimateEnabled = permissions.ViewERSEstimate
	for i := range state.Drivers {
		if !permissions.ViewERSEstimate {
			state.Drivers[i].ERSEstimatePct = 0
			state.Drivers[i].ERSEstimateReady = false
		}
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

	payload, err := json.Marshal(dto.WSResponse{
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
	var envelope struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(message, &envelope); err != nil {
		return nil, false
	}
	if envelope.Type != dto.MessageTypePitwallState {
		return nil, false
	}

	var state dto.PitwallState
	if err := json.Unmarshal(envelope.Data, &state); err != nil {
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
