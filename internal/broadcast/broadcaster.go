package broadcast

// Broadcaster abstracts message delivery so that both WebSocket Hub
// and WebRTC DataChannel can be used interchangeably by the Processor.
type Broadcaster interface {
	Broadcast(message []byte)
}

// FastBroadcaster delivers high-frequency, loss-tolerant messages (e.g. car positions).
type FastBroadcaster interface {
	BroadcastFast(message []byte)
}
