package signaling

import "encoding/json"

// Signaling message types exchanged between sender, receiver, and signaling server.
const (
	TypeRoomCreate   = "room_create"   // sender → server
	TypeRoomCreated  = "room_created"  // server → sender
	TypeRoomRejoin   = "room_rejoin"   // sender → server (reconnect to existing room)
	TypeRoomJoin     = "room_join"     // receiver → server
	TypeRoomJoined   = "room_joined"   // server → receiver
	TypePeerJoined   = "peer_joined"   // server → sender
	TypePeerLeft     = "peer_left"     // server → sender
	TypeRoomClosed   = "room_closed"   // server → all
	TypeOffer        = "offer"         // sender → receiver (relayed)
	TypeAnswer       = "answer"        // receiver → sender (relayed)
	TypeICECandidate = "ice_candidate" // bidirectional (relayed)
	TypeError        = "error"         // server → either
)

// Message is the JSON envelope for all signaling communication.
type Message struct {
	Type     string          `json:"type"`
	RoomCode string          `json:"roomCode,omitempty"`
	PeerID   string          `json:"peerId,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	Error    string          `json:"error,omitempty"`
}
