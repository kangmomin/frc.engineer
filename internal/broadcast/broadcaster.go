package broadcast

// Broadcaster abstracts message delivery so that both WebSocket Hub
// and WebRTC DataChannel can be used interchangeably by the Processor.
type Broadcaster interface {
	Broadcast(message []byte)
}
