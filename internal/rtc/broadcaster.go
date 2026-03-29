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

// Broadcast sends the message to all connected peers via DataChannel.
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	privileged, restricted, ok := buildPitwallBroadcastVariants(message)
	if !ok {
		b.peerManager.BroadcastAll(message)
		return
	}

	b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions) []byte {
		if permissions.ViewERSActual {
			return privileged
		}
		return restricted
	})
}

func buildPitwallBroadcastVariants(message []byte) ([]byte, []byte, bool) {
	var envelope struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(message, &envelope); err != nil {
		return nil, nil, false
	}
	if envelope.Type != dto.MessageTypePitwallState {
		return nil, nil, false
	}

	var state dto.PitwallState
	if err := json.Unmarshal(envelope.Data, &state); err != nil {
		return nil, nil, false
	}

	privilegedState := state
	privilegedState.ERSComparisonEnabled = hasERSActualData(privilegedState.Drivers)

	restrictedState := state
	restrictedState.ERSComparisonEnabled = false
	for i := range restrictedState.Drivers {
		restrictedState.Drivers[i].ERSActualPct = 0
		restrictedState.Drivers[i].ERSActualReady = false
	}

	privileged, err := json.Marshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: privilegedState,
	})
	if err != nil {
		return nil, nil, false
	}
	restricted, err := json.Marshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: restrictedState,
	})
	if err != nil {
		return nil, nil, false
	}

	return privileged, restricted, true
}

func hasERSActualData(drivers []dto.DriverInfo) bool {
	for _, driver := range drivers {
		if driver.ERSActualReady {
			return true
		}
	}
	return false
}
