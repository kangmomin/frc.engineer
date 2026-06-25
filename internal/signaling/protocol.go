package signaling

import "encoding/json"

// Signaling message types exchanged between sender, receiver, and signaling server.
const (
	TypeRoomCreate   = "room_create"   // sender → server
	TypeRoomCreated  = "room_created"  // server → sender
	TypeRoomRejoin   = "room_rejoin"   // sender → server (reconnect to existing room)
	TypeRoomUpdate   = "room_update"   // sender → server
	TypeRoomUpdated  = "room_updated"  // server → sender
	TypeRoomJoin     = "room_join"     // receiver → server
	TypeRoomJoined   = "room_joined"   // server → receiver
	TypePeerJoined   = "peer_joined"   // server → sender
	TypePeerLeft     = "peer_left"     // server → sender
	TypeRoomClosed   = "room_closed"   // server → all
	TypeOffer        = "offer"         // sender → receiver (relayed)
	TypeAnswer       = "answer"        // receiver → sender (relayed)
	TypeICECandidate = "ice_candidate" // bidirectional (relayed)
	TypeError        = "error"         // server → either
	TypeHeartbeat    = "heartbeat"     // bidirectional keepalive
)

// Message is the JSON envelope for all signaling communication.
type Message struct {
	Type     string `json:"type"`
	RoomID   string `json:"roomId,omitempty"`
	RoomCode string `json:"roomCode,omitempty"`
	RoomName string `json:"roomName,omitempty"`
	Password string `json:"password,omitempty"`
	PeerID   string `json:"peerId,omitempty"`
	// PlayerName is the sender's current in-game player nickname (sender→server),
	// used for server-side IP auto-ban matching. omitempty keeps older senders
	// (which don't send it) compatible.
	PlayerName string          `json:"playerName,omitempty"`
	Payload    json.RawMessage `json:"payload,omitempty"`
	Error      string          `json:"error,omitempty"`
	// Restart marks an offer as an ICE restart for an existing peer session.
	// 서버 Relay는 구조체 전체를 그대로 전달하므로 서버 변경 없이 통과한다.
	Restart bool `json:"restart,omitempty"`
}
