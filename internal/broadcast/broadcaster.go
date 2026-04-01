package broadcast

// Broadcaster abstracts message delivery so that both WebSocket Hub
// and WebRTC DataChannel can be used interchangeably by the Processor.
type Broadcaster interface {
	Broadcast(message []byte)
	Binary() bool // true = msgpack, false = JSON
}

// CongestionReporter is optionally implemented by broadcasters that track backpressure.
type CongestionReporter interface {
	DropRatio() float64
}

// FastBroadcaster delivers high-frequency, loss-tolerant messages (e.g. car positions).
type FastBroadcaster interface {
	BroadcastFast(message []byte)
}
