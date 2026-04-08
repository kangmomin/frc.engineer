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

type Permissions struct {
	ViewERSEstimate      bool `json:"viewERSEstimate"`
	ViewERSActual        bool `json:"viewERSActual"`
	ViewAdvancedStrategy bool `json:"viewAdvancedStrategy"`
	ViewPitStatus        bool `json:"viewPitStatus"`
	ViewTopSpeed         bool `json:"viewTopSpeed"`
	ViewPlayerDelta      bool `json:"viewPlayerDelta"`
	ViewCommentary       bool `json:"viewCommentary"`
	ViewQualifying       bool `json:"viewQualifying"`
	ViewCombat           bool `json:"viewCombat"`
	Pitwall              bool `json:"pitwall"`
	Overlay              bool `json:"overlay"`
	SetupSupport         bool `json:"setupSupport"`
}

type PermissionCode struct {
	Code        string      `json:"code"`
	Label       string      `json:"label,omitempty"`
	Permissions Permissions `json:"permissions"`
}

// Message is the JSON envelope for all signaling communication.
type Message struct {
	Type            string          `json:"type"`
	RoomID          string          `json:"roomId,omitempty"`
	RoomCode        string          `json:"roomCode,omitempty"`
	RoomName        string          `json:"roomName,omitempty"`
	Password               string          `json:"password,omitempty"`
	PermissionsCode        string          `json:"permissionsCode,omitempty"`
	DefaultPermissionsCode string          `json:"defaultPermissionsCode,omitempty"`
	Permissions            Permissions     `json:"permissions,omitempty"`
	PeerID          string          `json:"peerId,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	Error           string          `json:"error,omitempty"`
}
