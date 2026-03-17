package rtc

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
	b.peerManager.BroadcastAll(message)
}
