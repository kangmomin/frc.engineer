package signaling

import (
	"encoding/json"
	"time"

	"frc.engineer/internal/turncredentials"
)

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
	// TypeTurnCredentialsRequest is optional: older servers return their normal
	// unknown-message error and clients continue with static/default ICE.
	TypeTurnCredentialsRequest = "turn_credentials_request" // client → server
	TypeTurnCredentials        = "turn_credentials"         // server → client
	TypeError                  = "error"                    // server → either
	TypeHeartbeat              = "heartbeat"                // bidirectional keepalive

	// Intercom client -> server messages. They are feature-gated by
	// Features.IntercomVersion so older signaling servers and clients continue
	// to interoperate without sending unknown commands.
	TypeIntercomGroupCreate    = "intercom_group_create"
	TypeIntercomJoin           = "intercom_join"
	TypeIntercomLeave          = "intercom_leave"
	TypeIntercomActivity       = "intercom_activity"
	TypeIntercomPrivateSet     = "intercom_private_set"
	TypeIntercomPrivateReady   = "intercom_private_ready"
	TypeIntercomSFUSessionNew  = "intercom_sfu_session_new"
	TypeIntercomSFUPublish     = "intercom_sfu_publish"
	TypeIntercomSFUSubscribe   = "intercom_sfu_subscribe"
	TypeIntercomSFURenegotiate = "intercom_sfu_renegotiate"
	TypeIntercomSFUClose       = "intercom_sfu_close"

	// Intercom server -> client messages.
	TypeIntercomJoined          = "intercom_joined"
	TypeIntercomLeft            = "intercom_left"
	TypeIntercomState           = "intercom_state"
	TypeIntercomError           = "intercom_error"
	TypeIntercomSFUSession      = "intercom_sfu_session"
	TypeIntercomSFUPublished    = "intercom_sfu_published"
	TypeIntercomSFUSubscribed   = "intercom_sfu_subscribed"
	TypeIntercomSFURenegotiated = "intercom_sfu_renegotiated"
	TypeIntercomSFUClosed       = "intercom_sfu_closed"

	// TypeIntercomBridgeState exists only on the loopback sender bridge. It is
	// never forwarded to the central signaling service.
	TypeIntercomBridgeState = "intercom_bridge_state"
)

const (
	IntercomProtocolVersion    = 1
	MaxIntercomEnvelopeBytes   = 96 * 1024
	MaxIntercomSessionSDPBytes = 64 * 1024
	MaxIntercomSafeInteger     = uint64(1<<53 - 1)
)

func IsIntercomClientMessageType(messageType string) bool {
	switch messageType {
	case TypeIntercomGroupCreate, TypeIntercomJoin, TypeIntercomLeave, TypeIntercomActivity,
		TypeIntercomPrivateSet, TypeIntercomPrivateReady, TypeIntercomSFUSessionNew,
		TypeIntercomSFUPublish, TypeIntercomSFUSubscribe, TypeIntercomSFURenegotiate,
		TypeIntercomSFUClose:
		return true
	default:
		return false
	}
}

type IntercomRole string

const (
	IntercomRoleDriver   IntercomRole = "driver"
	IntercomRoleEngineer IntercomRole = "engineer"
	IntercomRoleChief    IntercomRole = "chief"
)

type IntercomTrackClass string

const (
	IntercomTrackDriverEngineer IntercomTrackClass = "driver_engineer"
	IntercomTrackDriverChief    IntercomTrackClass = "driver_chief"
	IntercomTrackEngineerBus    IntercomTrackClass = "engineer_bus"
	IntercomTrackDriverRadio    IntercomTrackClass = "driver_radio"
	IntercomTrackChiefPrivate   IntercomTrackClass = "chief_private"
)

type IntercomPrivatePhase string

const (
	IntercomPrivatePreparing IntercomPrivatePhase = "preparing"
	IntercomPrivateActive    IntercomPrivatePhase = "active"
)

type IntercomSDPType string

const (
	IntercomSDPOffer  IntercomSDPType = "offer"
	IntercomSDPAnswer IntercomSDPType = "answer"
)

// Features advertises optional signaling capabilities. An absent intercom
// version means the peer must not send intercom messages.
type Features struct {
	IntercomVersion int `json:"intercomVersion,omitempty"`
}

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
	// RequestID correlates TURN and intercom RPCs across reconnects. It is opaque
	// to the server and echoed unchanged on both success and typed errors.
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error,omitempty"`
	// NegotiationID identifies one sender-authored offer generation. New clients
	// echo it on answers/candidates; zero remains the legacy compatibility path.
	NegotiationID uint64 `json:"negotiationId,omitempty"`
	// Restart marks an offer as an ICE restart for an existing peer session.
	// 서버 Relay는 구조체 전체를 그대로 전달하므로 서버 변경 없이 통과한다.
	Restart bool `json:"restart,omitempty"`
	// OwnerToken proves room ownership for room_rejoin and room reuse (room_create
	// with an existing roomId). The server issues it in room_created; the sender
	// stores it in memory and echoes it so a party that only knows the roomId
	// cannot hijack the room (H6).
	OwnerToken string `json:"ownerToken,omitempty"`
	// Features is omitted by older servers. Clients treat an absent feature as
	// unsupported rather than changing the telemetry connection state.
	Features *Features `json:"features,omitempty"`
}

// Intercom client payloads.

type IntercomGroupCreatePayload struct {
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

type IntercomJoinPayload struct {
	GroupCode   string       `json:"groupCode"`
	Password    string       `json:"password"`
	ChiefCode   string       `json:"chiefCode,omitempty"`
	ResumeToken string       `json:"resumeToken,omitempty"`
	Role        IntercomRole `json:"role"`
	DisplayName string       `json:"displayName"`
}

type IntercomLeavePayload struct{}

type IntercomActivityPayload struct {
	Speaking   bool `json:"speaking"`
	PTT        bool `json:"ptt"`
	BusEnabled bool `json:"busEnabled"`
}

type IntercomPrivateSetPayload struct {
	DriverKey string `json:"driverKey"`
	Active    bool   `json:"active"`
}

type IntercomPrivateReadyPayload struct {
	Revision uint64 `json:"revision"`
}

type IntercomSFUSessionNewPayload struct{}

type IntercomSessionDescription struct {
	Type IntercomSDPType `json:"type"`
	SDP  string          `json:"sdp"`
}

type IntercomPublishTrack struct {
	MID             string             `json:"mid"`
	Class           IntercomTrackClass `json:"class"`
	TargetDriverKey string             `json:"targetDriverKey,omitempty"`
}

type IntercomSFUPublishPayload struct {
	SessionHandle      string                     `json:"sessionHandle"`
	SessionDescription IntercomSessionDescription `json:"sessionDescription"`
	Tracks             []IntercomPublishTrack     `json:"tracks"`
}

type IntercomSFUSubscribePayload struct {
	SessionHandle string `json:"sessionHandle"`
}

type IntercomSFURenegotiatePayload struct {
	SessionHandle      string                     `json:"sessionHandle"`
	SessionDescription IntercomSessionDescription `json:"sessionDescription"`
}

type IntercomSFUClosePayload struct {
	SessionHandle string `json:"sessionHandle"`
}

// Intercom server payloads.

type IntercomPrivateSession struct {
	Phase     IntercomPrivatePhase `json:"phase"`
	DriverKey string               `json:"driverKey"`
}

type IntercomParticipant struct {
	ID                  string       `json:"id"`
	Role                IntercomRole `json:"role"`
	DisplayName         string       `json:"displayName"`
	DriverKey           string       `json:"driverKey,omitempty"`
	AssignmentDriverKey string       `json:"assignmentDriverKey,omitempty"`
	Online              bool         `json:"online"`
	Speaking            bool         `json:"speaking"`
	PTT                 bool         `json:"ptt"`
	BusEnabled          bool         `json:"busEnabled"`
	ForcedMuted         bool         `json:"forcedMuted"`
	TalkingTo           []string     `json:"talkingTo"`
}

type IntercomSnapshot struct {
	Revision         uint64                  `json:"revision"`
	TopologyRevision uint64                  `json:"topologyRevision"`
	GroupCode        string                  `json:"groupCode"`
	Participants     []IntercomParticipant   `json:"participants"`
	PrivateSession   *IntercomPrivateSession `json:"privateSession,omitempty"`
}

type IntercomJoinedPayload struct {
	MembershipGeneration uint64           `json:"membershipGeneration"`
	ParticipantID        string           `json:"participantId"`
	ResumeToken          string           `json:"resumeToken"`
	GroupCode            string           `json:"groupCode"`
	ChiefCode            string           `json:"chiefCode,omitempty"`
	Snapshot             IntercomSnapshot `json:"snapshot"`
	SFUEnabled           bool             `json:"sfuEnabled"`
}

type IntercomLeftPayload struct{}

type IntercomErrorPayload struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type IntercomSFUSessionPayload struct {
	SessionHandle string `json:"sessionHandle"`
}

type IntercomPublishedTrack struct {
	MID      string             `json:"mid"`
	TrackKey string             `json:"trackKey"`
	Class    IntercomTrackClass `json:"class"`
}

type IntercomSFUPublishedPayload struct {
	SessionDescription             *IntercomSessionDescription `json:"sessionDescription,omitempty"`
	RequiresImmediateRenegotiation bool                        `json:"requiresImmediateRenegotiation"`
	Tracks                         []IntercomPublishedTrack    `json:"tracks"`
}

type IntercomSubscribedTrack struct {
	MID             string             `json:"mid"`
	TrackKey        string             `json:"trackKey"`
	ParticipantID   string             `json:"participantId"`
	Class           IntercomTrackClass `json:"class"`
	TargetDriverKey string             `json:"targetDriverKey,omitempty"`
}

type IntercomSFUSubscribedPayload struct {
	SessionDescription             *IntercomSessionDescription `json:"sessionDescription,omitempty"`
	RequiresImmediateRenegotiation bool                        `json:"requiresImmediateRenegotiation"`
	Tracks                         []IntercomSubscribedTrack   `json:"tracks"`
	RemovedTrackKeys               []string                    `json:"removedTrackKeys"`
}

type IntercomSFURenegotiatedPayload struct{}

type IntercomSFUClosedPayload struct{}

type IntercomBridgeStatePayload struct {
	Generation      uint64 `json:"generation"`
	Joined          bool   `json:"joined"`
	IntercomVersion int    `json:"intercomVersion,omitempty"`
}

// TurnCredentialsPayload is the typed payload for TypeTurnCredentials. A
// cloudflare payload always carries servers and expiry; a fallback payload
// omits both and has one stable reason (disabled or temporarily_unavailable).
type TurnCredentialsPayload struct {
	ICEServers []turncredentials.ICEServer `json:"iceServers,omitempty"`
	ExpiresAt  *time.Time                  `json:"expiresAt,omitempty"`
	Source     string                      `json:"source"`
	Reason     string                      `json:"reason,omitempty"`
}
