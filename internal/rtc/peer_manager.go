package rtc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"frc.engineer/internal/signaling"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

const (
	maxBufferedAmount = 128 * 1024 // 128 KB — conservative for Chrome SCTP 256KB receive buffer

	sigWriteWait       = 10 * time.Second
	sigPongWait        = 60 * time.Second
	sigPingPeriod      = (sigPongWait * 9) / 10 // 54s
	sigHeartbeatPeriod = 30 * time.Second       // application-level keepalive to survive proxy idle timeouts
	reconnectBaseDelay = 1 * time.Second
	reconnectMaxDelay  = 30 * time.Second

	// DataChannel keepalive: pion의 ICE 타임아웃(수십 초)에만 의존하면 죽은
	// P2P 감지가 너무 느리다. 앱 레벨 ping/pong으로 15초 내 감지한다.
	dcPingPeriod       = 5 * time.Second
	dcPongRestartAfter = 15 * time.Second // ping 3회 연속 손실 → ICE restart
	dcPongDropAfter    = 30 * time.Second // restart로도 복구 실패 → peer 제거

	// ICE restart 정책: 재수집+재연결은 통상 2~5초 — 15초는 3배 마진이며
	// viewer의 disconnected watchdog(18s)보다 짧아 sender가 먼저 정리한다.
	iceRestartTimeout      = 15 * time.Second
	iceRestartMaxPerWindow = 2
	iceRestartWindow       = 60 * time.Second

	maxDataChannelMessageBytes = 256 * 1024
	maxPendingICECandidates    = 64
)

var defaultICEServers = []webrtc.ICEServer{
	{URLs: []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"}},
}

// sigDialer bounds the WebSocket handshake — DefaultDialer has no timeout and
// can hang forever on a black-holed route.
var sigDialer = &websocket.Dialer{HandshakeTimeout: 10 * time.Second}

// RequestHandler is called when an engineer sends a request over DataChannel.
// The returned bytes are sent back as a unicast response.
type RequestHandler func(peerID string, msg []byte) []byte

type IntercomTransportState struct {
	Generation      uint64
	Joined          bool
	IntercomVersion int
}

// peerMeta tracks per-peer keepalive and ICE-restart state. Guarded by pm.mu.
type peerMeta struct {
	lastPongAt   time.Time
	pongSeen     bool // 구버전 viewer(pong 미응답)에서는 워치독을 비활성화하는 안전망
	restarts     int
	windowStart  time.Time
	restartingAt time.Time // zero = restart 진행 중 아님
	restartTimer *time.Timer
	// Each DataChannel gets a serial send section. Pion channels can be touched
	// by telemetry, request responses, and keepalive goroutines concurrently.
	reliableSendMu sync.Mutex
	fastSendMu     sync.Mutex
	negotiationMu  sync.Mutex
	// Candidates are only passed to Pion after the current remote description,
	// and locally gathered candidates only leave after their offer is sent.
	remoteDescriptionSet     bool
	pendingRemoteCandidates  []pendingRemoteCandidate
	remoteCandidatesFlushing bool
	offerSent                bool
	pendingLocalCandidates   []json.RawMessage
	localCandidatesFlushing  bool
	candidateQueueFailed     bool
	negotiationGeneration    uint64
	generationAware          bool
}

type pendingRemoteCandidate struct {
	negotiationID uint64
	candidate     webrtc.ICECandidateInit
}

// PeerManager manages WebRTC peer connections for the sender (driver) side.
// It connects to the signaling server, creates rooms, and handles
// PeerConnection lifecycle for each engineer that joins.
type PeerManager struct {
	lifecycleMu    sync.Mutex // serializes short signaling lifecycle commit/cleanup sections
	signalingURL   string
	sigConn        *websocket.Conn
	sigMu          sync.Mutex
	signalingReady bool // current socket completed room_create/room_rejoin

	peers                   map[string]*webrtc.PeerConnection
	channels                map[string]*webrtc.DataChannel
	fastChannels            map[string]*webrtc.DataChannel
	peerViews               map[string]string // per-peer active view: "cockpit" or "qualifying"
	peerMeta                map[string]*peerMeta
	pendingPeers            map[string]uint64 // peer join → TURN-gated offer generation
	nextPeerOfferGeneration uint64
	pendingRemoteCandidates map[string][]pendingRemoteCandidate
	nextNegotiationID       uint64
	mu                      sync.RWMutex

	roomID        string
	roomCode      string
	roomName      string
	roomPassword  string
	turn          turnState
	onRequest     RequestHandler
	onCountChange func(int)    // called when engineer count changes
	onStatus      func(string) // signaling status text for tray tooltip 등
	logger        *slog.Logger
	done          chan struct{}
	closed        bool // guarded by sigMu; Connect() after Close() re-arms done
	reconnecting  bool
	playerName    string // current in-game player nickname (guarded by sigMu)
	ownerToken    string // H6: room ownership proof from room_created (guarded by sigMu)

	intercomGeneration  uint64
	intercomVersion     int
	intercomJoined      bool
	intercomLatestJoin  *signaling.Message
	intercomLatestState *signaling.Message
	onIntercom          func(signaling.Message)
	onIntercomState     func(IntercomTransportState)
}

// NewPeerManager creates a PeerManager. Call Connect() to start.
func NewPeerManager(signalingURL string, logger *slog.Logger) *PeerManager {
	return &PeerManager{
		signalingURL:            signalingURL,
		peers:                   make(map[string]*webrtc.PeerConnection),
		channels:                make(map[string]*webrtc.DataChannel),
		fastChannels:            make(map[string]*webrtc.DataChannel),
		peerViews:               make(map[string]string),
		peerMeta:                make(map[string]*peerMeta),
		pendingPeers:            make(map[string]uint64),
		pendingRemoteCandidates: make(map[string][]pendingRemoteCandidate),
		turn:                    newTurnState(defaultICEServers),
		logger:                  logger,
		done:                    make(chan struct{}),
	}
}

// SetRequestHandler registers a callback for incoming DataChannel requests.
func (pm *PeerManager) SetRequestHandler(h RequestHandler) {
	pm.onRequest = h
}

// SetCountChangeHandler registers a callback invoked when engineer count changes.
func (pm *PeerManager) SetCountChangeHandler(h func(int)) {
	pm.onCountChange = h
}

// SetStatusHandler registers a callback invoked with human-readable signaling
// status transitions (rtc 패키지가 systray에 의존하지 않도록 콜백 주입).
func (pm *PeerManager) SetStatusHandler(h func(string)) {
	pm.onStatus = h
}

// SetIntercomHandler registers the sender bridge's central-message callback.
// The latest joined/state authority can be replayed separately after a local
// renderer replacement without exposing owner or provider credentials.
func (pm *PeerManager) SetIntercomHandler(h func(signaling.Message)) {
	pm.sigMu.Lock()
	pm.onIntercom = h
	pm.sigMu.Unlock()
}

func (pm *PeerManager) SetIntercomStateHandler(h func(IntercomTransportState)) {
	pm.sigMu.Lock()
	pm.onIntercomState = h
	state := pm.intercomTransportStateLocked()
	pm.sigMu.Unlock()
	if h != nil {
		h(state)
	}
}

func (pm *PeerManager) IntercomReplay() (IntercomTransportState, []signaling.Message) {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	messages := make([]signaling.Message, 0, 2)
	if pm.intercomLatestJoin != nil {
		messages = append(messages, cloneSignalingMessage(*pm.intercomLatestJoin))
	}
	if pm.intercomLatestState != nil {
		messages = append(messages, cloneSignalingMessage(*pm.intercomLatestState))
	}
	return pm.intercomTransportStateLocked(), messages
}

func (pm *PeerManager) SendIntercom(message signaling.Message) bool {
	if !signaling.IsIntercomClientMessageType(message.Type) {
		return false
	}
	encoded, err := json.Marshal(message)
	if err != nil || len(encoded) > signaling.MaxIntercomEnvelopeBytes {
		return false
	}
	pm.sigMu.Lock()
	supported := pm.signalingReady && pm.intercomVersion == signaling.IntercomProtocolVersion
	conn := pm.sigConn
	pm.sigMu.Unlock()
	if !supported || conn == nil {
		return false
	}
	return pm.sendSignalingOn(conn, message)
}

func (pm *PeerManager) notifyStatus(status string) {
	if pm.onStatus != nil {
		pm.onStatus(status)
	}
}

// SetRoomMetadata stores room list metadata used for room creation and updates.
func (pm *PeerManager) SetRoomMetadata(name, password string) {
	pm.sigMu.Lock()
	pm.roomName = name
	pm.roomPassword = password
	pm.sigMu.Unlock()
}

// SetPlayerName updates the current in-game player nickname reported to the
// signaling server (room_create / room_rejoin / heartbeat) for IP auto-ban.
func (pm *PeerManager) SetPlayerName(name string) {
	pm.sigMu.Lock()
	pm.playerName = name
	pm.sigMu.Unlock()
}

func (pm *PeerManager) getPlayerName() string {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return pm.playerName
}

// getOwnerToken returns the room ownership token last issued by the server.
func (pm *PeerManager) getOwnerToken() string {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return pm.ownerToken
}

// setOwnerToken stores a room ownership token issued in a room_created response.
func (pm *PeerManager) setOwnerToken(token string) {
	pm.sigMu.Lock()
	pm.ownerToken = token
	pm.sigMu.Unlock()
}

// SetICEServers overrides the default STUN-only ICE server list.
func (pm *PeerManager) SetICEServers(servers []webrtc.ICEServer) {
	pm.turn.setStaticICEServers(servers)
}

// UpdateRoomMetadata updates the active signaling room metadata if connected.
func (pm *PeerManager) UpdateRoomMetadata(name, password string) {
	pm.sigMu.Lock()
	pm.roomName = name
	pm.roomPassword = password
	connected := pm.sigConn != nil && pm.signalingReady
	roomID := pm.roomID
	pm.sigMu.Unlock()

	if connected && roomID != "" {
		pm.sendSignaling(signaling.Message{
			Type:     signaling.TypeRoomUpdate,
			RoomID:   roomID,
			RoomName: name,
			Password: password,
		})
	}
}

// RoomID returns the stable room id assigned by the signaling server.
func (pm *PeerManager) RoomID() string {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return pm.roomID
}

// RoomCode returns the current room code assigned by the signaling server.
func (pm *PeerManager) RoomCode() string {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return pm.roomCode
}

// Connect establishes a WebSocket connection to the signaling server and sends room_create.
// Safe to call again after Close(): the done channel is re-armed so the
// read/write loops and reconnect logic work for the new session.
func (pm *PeerManager) Connect() error {
	pm.lifecycleMu.Lock()
	pm.sigMu.Lock()
	if pm.closed {
		pm.done = make(chan struct{})
		pm.closed = false
		pm.reconnecting = false
	}
	sessionDone := pm.done
	pm.sigMu.Unlock()
	pm.lifecycleMu.Unlock()

	if err := pm.dial(sessionDone); err != nil {
		return err
	}
	pm.sigMu.Lock()
	conn := pm.sigConn
	pm.sigMu.Unlock()
	if conn == nil {
		return fmt.Errorf("signaling connection unavailable")
	}

	// Send room_create
	create := pm.roomHandshakeMessage(signaling.TypeRoomCreate)
	if err := pm.writeSignalingHandshake(conn, sessionDone, create); err != nil {
		conn.Close()
		return fmt.Errorf("send room_create: %w", err)
	}

	// A fast engineer join can arrive before room_created on this connection.
	// Buffer bounded peer events until the ACK establishes the room generation.
	resp, pending, err := readRoomCreated(conn)
	if err != nil {
		conn.Close()
		return fmt.Errorf("read room_created: %w", err)
	}

	pm.lifecycleMu.Lock()
	if !pm.signalingLifecycleCurrent(conn, sessionDone) {
		pm.lifecycleMu.Unlock()
		_ = conn.Close()
		return fmt.Errorf("signaling session changed before room creation completed")
	}
	if resp.Type == signaling.TypeError {
		pm.lifecycleMu.Unlock()
		conn.Close()
		return fmt.Errorf("signaling error: %s", resp.Error)
	}
	if resp.Type != signaling.TypeRoomCreated {
		pm.lifecycleMu.Unlock()
		conn.Close()
		return fmt.Errorf("unexpected message: %s", resp.Type)
	}

	roomID, roomCode, _, applied := pm.applyRoomAcknowledgementLocked(conn, sessionDone, resp, true)
	if !applied {
		pm.lifecycleMu.Unlock()
		conn.Close()
		return fmt.Errorf("signaling connection replaced before room creation completed")
	}
	pm.logger.Info("room created on signaling server", "roomId", roomID, "roomCode", roomCode)
	pm.requestTurnCredentials(false)
	if pm.replayBufferedSignaling(pending) {
		pm.clearSignalingConnection(conn)
		pm.lifecycleMu.Unlock()
		conn.Close()
		return fmt.Errorf("room closed while establishing signaling")
	}

	pm.startLoops(conn, sessionDone)
	go pm.keepaliveLoop(sessionDone)
	pm.lifecycleMu.Unlock()
	return nil
}

// dial establishes a WebSocket connection and installs pong handler + read deadline.
func (pm *PeerManager) dial(expectedDone chan struct{}) error {
	conn, _, err := sigDialer.Dial(pm.signalingURL, nil)
	if err != nil {
		return fmt.Errorf("signaling connect: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(sigPongWait))
	conn.SetReadLimit(signaling.MaxIntercomEnvelopeBytes)
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(sigPongWait))
		return nil
	})

	pm.lifecycleMu.Lock()
	pm.sigMu.Lock()
	if pm.closed || pm.done != expectedDone {
		pm.sigMu.Unlock()
		pm.lifecycleMu.Unlock()
		_ = conn.Close()
		return fmt.Errorf("signaling session changed during connect")
	}
	pm.sigConn = conn
	pm.signalingReady = false
	pm.sigMu.Unlock()
	pm.lifecycleMu.Unlock()

	return nil
}

const maxPreRoomCreatedMessages = 64

// readRoomCreated waits for the room ACK while retaining the small number of
// peer events that can legitimately race it. This avoids silently losing the
// first peer_joined when a just-created room is immediately joined.
func readRoomCreated(conn *websocket.Conn) (signaling.Message, []signaling.Message, error) {
	pending := make([]signaling.Message, 0, 4)
	for {
		var message signaling.Message
		if err := conn.ReadJSON(&message); err != nil {
			return signaling.Message{}, nil, err
		}
		switch message.Type {
		case signaling.TypeRoomCreated, signaling.TypeError:
			return message, pending, nil
		default:
			if len(pending) >= maxPreRoomCreatedMessages {
				return signaling.Message{}, nil, fmt.Errorf("too many signaling events before room_created")
			}
			pending = append(pending, message)
		}
	}
}

func (pm *PeerManager) replayBufferedSignaling(messages []signaling.Message) (roomClosed bool) {
	for _, message := range messages {
		if pm.handleSignalingMessage(message) {
			return true
		}
	}
	return false
}

// startLoops launches the read and write (ping) goroutines.
// writeDone은 세대-로컬 채널 — 재연결로 루프가 다시 뜰 때 이전 세대의
// close가 새 write 루프를 종료시키는 레이스를 막는다.
func (pm *PeerManager) startLoops(conn *websocket.Conn, done chan struct{}) {
	wd := make(chan struct{})
	go pm.readSignalingLoop(conn, done, wd)
	go pm.writeSignalingLoop(conn, done, wd)
}

// canQueueDataChannelMessage is the shared SCTP safety rule. A message larger
// than Chrome's 256KB receive-buffer ceiling is never sent. Within a channel's
// serial section, existing queue pressure above 128KB or a combined queued +
// outgoing size above 256KB is dropped (or waited on by buffered sends).
func canQueueDataChannelMessage(buffered uint64, outgoing int) bool {
	if outgoing < 0 || outgoing > maxDataChannelMessageBytes {
		return false
	}
	return buffered <= maxBufferedAmount && buffered+uint64(outgoing) <= maxDataChannelMessageBytes
}

func sendDataChannel(ch *webrtc.DataChannel, sendMu *sync.Mutex, message []byte, wait time.Duration) error {
	return sendDataChannelWith(ch, sendMu, len(message), wait, func() error {
		return ch.Send(message)
	})
}

func sendDataChannelText(ch *webrtc.DataChannel, sendMu *sync.Mutex, message string, wait time.Duration) error {
	return sendDataChannelWith(ch, sendMu, len(message), wait, func() error {
		return ch.SendText(message)
	})
}

func sendDataChannelWith(ch *webrtc.DataChannel, sendMu *sync.Mutex, outgoing int, wait time.Duration, send func() error) error {
	if outgoing > maxDataChannelMessageBytes {
		return fmt.Errorf("data channel message exceeds 256KB")
	}
	if ch == nil || sendMu == nil || ch.ReadyState() != webrtc.DataChannelStateOpen {
		return fmt.Errorf("peer data channel not open")
	}

	sendMu.Lock()
	defer sendMu.Unlock()
	deadline := time.Now().Add(wait)
	for {
		if ch.ReadyState() != webrtc.DataChannelStateOpen {
			return fmt.Errorf("peer data channel closed")
		}
		if canQueueDataChannelMessage(ch.BufferedAmount(), outgoing) {
			return send()
		}
		if wait <= 0 || !time.Now().Before(deadline) {
			return fmt.Errorf("peer data channel congested")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// BroadcastAll sends a binary message to all connected DataChannels.
// Channels are snapshotted under RLock so SCTP writes never run while holding
// the lock (a slow write would otherwise block removePeer and friends).
func (pm *PeerManager) BroadcastAll(message []byte) {
	type target struct {
		peerID  string
		channel *webrtc.DataChannel
		meta    *peerMeta
	}
	pm.mu.RLock()
	snapshot := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		snapshot = append(snapshot, target{peerID: peerID, channel: ch, meta: pm.peerMeta[peerID]})
	}
	pm.mu.RUnlock()

	for _, t := range snapshot {
		if t.meta == nil {
			continue
		}
		if err := sendDataChannel(t.channel, &t.meta.reliableSendMu, message, 0); err != nil {
			pm.logger.Debug("send failed", "peerId", t.peerID, "error", err)
		}
	}
}

// BroadcastAllFast sends a binary message to all connected fast DataChannels.
// Messages are silently dropped for slow peers (no log spam at 60Hz).
func (pm *PeerManager) BroadcastAllFast(message []byte) {
	pm.mu.RLock()
	type target struct {
		channel *webrtc.DataChannel
		meta    *peerMeta
	}
	snapshot := make([]target, 0, len(pm.fastChannels))
	for peerID, ch := range pm.fastChannels {
		snapshot = append(snapshot, target{channel: ch, meta: pm.peerMeta[peerID]})
	}
	pm.mu.RUnlock()

	for _, target := range snapshot {
		if target.meta == nil {
			continue
		}
		_ = sendDataChannel(target.channel, &target.meta.fastSendMu, message, 0)
	}
}

// BroadcastPerPeer sends a potentially different payload to each connected peer.
// Returns (dropped, total) counts of peers.
func (pm *PeerManager) BroadcastPerPeer(resolve func(peerID string, view string) []byte) (int, int) {
	pm.mu.RLock()
	type target struct {
		peerID  string
		channel *webrtc.DataChannel
		view    string
		meta    *peerMeta
	}
	targets := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		targets = append(targets, target{
			peerID:  peerID,
			channel: ch,
			view:    pm.peerViews[peerID],
			meta:    pm.peerMeta[peerID],
		})
	}
	pm.mu.RUnlock()

	dropped := 0
	total := len(targets)
	for _, target := range targets {
		if target.meta == nil || target.channel.ReadyState() != webrtc.DataChannelStateOpen {
			total--
			continue
		}
		message := resolve(target.peerID, target.view)
		if len(message) == 0 {
			continue
		}
		if err := sendDataChannel(target.channel, &target.meta.reliableSendMu, message, 0); err != nil {
			dropped++
			pm.logger.Debug("send failed", "peerId", target.peerID, "error", err)
		}
	}
	return dropped, total
}

// SendTo sends a message to a specific peer's DataChannel (unicast).
func (pm *PeerManager) SendTo(peerID string, message []byte) {
	pm.mu.RLock()
	ch, ok := pm.channels[peerID]
	meta := pm.peerMeta[peerID]
	pm.mu.RUnlock()
	if !ok || meta == nil {
		return
	}
	_ = sendDataChannel(ch, &meta.reliableSendMu, message, 0)
}

func (pm *PeerManager) peerChannelCurrent(peerID string, pc *webrtc.PeerConnection, ch *webrtc.DataChannel) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.peers[peerID] == pc && pm.channels[peerID] == ch
}

func (pm *PeerManager) sendToIfCurrent(peerID string, pc *webrtc.PeerConnection, ch *webrtc.DataChannel, message []byte) {
	pm.mu.RLock()
	meta := pm.peerMeta[peerID]
	current := pm.peers[peerID] == pc && pm.channels[peerID] == ch && meta != nil
	pm.mu.RUnlock()
	if current {
		_ = sendDataChannel(ch, &meta.reliableSendMu, message, 0)
	}
}

// SendToBuffered sends a message to a specific peer while waiting for channel backpressure to drain.
func (pm *PeerManager) SendToBuffered(peerID string, message []byte, wait time.Duration) error {
	pm.mu.RLock()
	ch, ok := pm.channels[peerID]
	meta := pm.peerMeta[peerID]
	pm.mu.RUnlock()
	if !ok || meta == nil {
		return fmt.Errorf("peer data channel not open")
	}
	return sendDataChannel(ch, &meta.reliableSendMu, message, wait)
}

// ConnectedCount returns the number of peers with open DataChannels.
func (pm *PeerManager) ConnectedCount() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	count := 0
	for _, ch := range pm.channels {
		if ch.ReadyState() == webrtc.DataChannelStateOpen {
			count++
		}
	}
	return count
}

// PeerDebugInfo returns debug information about connected peers.
type PeerDebugInfo struct {
	PeerID            string `json:"peerId"`
	State             string `json:"state"`
	ICEState          string `json:"iceState,omitempty"`
	ICESource         string `json:"iceSource,omitempty"`
	ICEExpiresAt      string `json:"iceExpiresAt,omitempty"`
	ICEFallbackReason string `json:"iceFallbackReason,omitempty"`
	CandidatePair     string `json:"candidatePair,omitempty"` // 예: "srflx -> host"
	Restarts          int    `json:"restarts,omitempty"`
	LastPongAgoMs     int64  `json:"lastPongAgoMs,omitempty"`
	View              string `json:"view,omitempty"`
}

// DebugPeers returns debug info for all tracked peers.
func (pm *PeerManager) DebugPeers() []PeerDebugInfo {
	iceSource, iceExpiresAt, iceFallbackReason := pm.turn.diagnostics()
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	var out []PeerDebugInfo
	for peerID, ch := range pm.channels {
		info := PeerDebugInfo{
			PeerID:            peerID,
			State:             ch.ReadyState().String(),
			View:              pm.peerViews[peerID],
			ICESource:         iceSource,
			ICEFallbackReason: iceFallbackReason,
		}
		if !iceExpiresAt.IsZero() {
			info.ICEExpiresAt = iceExpiresAt.Format(time.RFC3339)
		}
		if pc := pm.peers[peerID]; pc != nil {
			info.ICEState = pc.ICEConnectionState().String()
			info.CandidatePair = selectedCandidatePair(pc)
		}
		if meta := pm.peerMeta[peerID]; meta != nil {
			info.Restarts = meta.restarts
			if meta.pongSeen {
				info.LastPongAgoMs = time.Since(meta.lastPongAt).Milliseconds()
			}
		}
		out = append(out, info)
	}
	return out
}

// selectedCandidatePair summarizes the active ICE candidate pair types
// (e.g. "srflx -> host"); empty when not yet established.
func selectedCandidatePair(pc *webrtc.PeerConnection) string {
	sctp := pc.SCTP()
	if sctp == nil {
		return ""
	}
	transport := sctp.Transport()
	if transport == nil {
		return ""
	}
	ice := transport.ICETransport()
	if ice == nil {
		return ""
	}
	pair, err := ice.GetSelectedCandidatePair()
	if err != nil || pair == nil {
		return ""
	}
	return fmt.Sprintf("%s -> %s", pair.Local.Typ, pair.Remote.Typ)
}

// Close shuts down all peer connections and the signaling connection.
// Idempotent; a later Connect() re-arms the manager.
func (pm *PeerManager) Close() {
	pm.lifecycleMu.Lock()
	pm.sigMu.Lock()
	if pm.closed {
		pm.sigMu.Unlock()
		pm.lifecycleMu.Unlock()
		return
	}
	pm.closed = true
	pm.signalingReady = false
	pm.intercomGeneration++
	pm.intercomJoined = false
	pm.intercomLatestJoin = nil
	pm.intercomLatestState = nil
	done := pm.done
	conn := pm.sigConn
	pm.sigConn = nil
	pm.sigMu.Unlock()
	pm.notifyIntercomState()
	close(done)

	// Clear gated offers before closing their TURN gate. Otherwise a waiter can
	// wake on the gate and race shutdown with peer creation.
	pm.mu.Lock()
	clear(pm.pendingPeers)
	clear(pm.pendingRemoteCandidates)
	pm.mu.Unlock()
	pm.turn.close()

	pm.mu.Lock()
	peers := make([]*webrtc.PeerConnection, 0, len(pm.peers))
	for id, pc := range pm.peers {
		peers = append(peers, pc)
		if meta := pm.peerMeta[id]; meta != nil && meta.restartTimer != nil {
			meta.restartTimer.Stop()
		}
	}
	clear(pm.peers)
	clear(pm.channels)
	clear(pm.fastChannels)
	clear(pm.peerViews)
	clear(pm.peerMeta)
	clear(pm.pendingPeers)
	clear(pm.pendingRemoteCandidates)
	pm.mu.Unlock()
	pm.lifecycleMu.Unlock()

	// Pion may invoke callbacks synchronously from Close, so never close a peer
	// while holding pm.mu.
	for _, pc := range peers {
		_ = pc.Close()
	}
	if conn != nil {
		_ = conn.Close()
	}
}

// doneChan returns the current generation's done channel under lock.
// Goroutines capture it once at entry — after Close()+Connect() re-arms the
// channel, stale goroutines still observe their own (closed) generation.
func (pm *PeerManager) doneChan() chan struct{} {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return pm.done
}

// writeSignalingLoop sends periodic pings and heartbeat messages to keep the signaling connection alive.
func (pm *PeerManager) writeSignalingLoop(conn *websocket.Conn, done chan struct{}, writeDone chan struct{}) {
	pingTicker := time.NewTicker(sigPingPeriod)
	heartbeatTicker := time.NewTicker(sigHeartbeatPeriod)
	defer pingTicker.Stop()
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-done:
			return
		case <-writeDone:
			return
		case <-pingTicker.C:
			pm.sigMu.Lock()
			if pm.sigConn == conn && pm.signalingReady {
				conn.SetWriteDeadline(time.Now().Add(sigWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					if pm.sigConn == conn {
						pm.signalingReady = false
					}
					pm.sigMu.Unlock()
					_ = conn.Close()
					return
				}
			}
			pm.sigMu.Unlock()
		case <-heartbeatTicker.C:
			// Application-level keepalive (also carries the latest player nickname
			// for server-side IP auto-ban detection on nickname change).
			pm.sendSignalingOn(conn, signaling.Message{Type: signaling.TypeHeartbeat, PlayerName: pm.getPlayerName()})
		}
	}
}

func (pm *PeerManager) readSignalingLoop(conn *websocket.Conn, done chan struct{}, writeDone chan struct{}) {
	roomClosed := false
	defer func() {
		close(writeDone)
		if roomClosed {
			pm.clearSignalingConnection(conn)
		} else if pm.scheduleReconnect(conn, done) {
			pm.notifyStatus("Signaling 재연결 중")
		}
		pm.logger.Info("signaling read loop exited")
	}()

	for {
		select {
		case <-done:
			return
		default:
		}

		var msg signaling.Message
		if conn == nil {
			pm.logger.Error("signaling read loop missing connection")
			return
		}
		if err := conn.ReadJSON(&msg); err != nil {
			select {
			case <-done:
				return
			default:
				pm.logger.Error("signaling read error", "error", err)
				return
			}
		}

		if pm.handleSignalingMessage(msg) {
			roomClosed = true
			return
		}
	}
}

// handleSignalingMessage is shared by the normal read loop and the bounded
// pre-room_created replay path. It returns true only for terminal room closure.
func (pm *PeerManager) handleSignalingMessage(msg signaling.Message) bool {
	switch msg.Type {
	case signaling.TypeHeartbeat:
		// Ignore heartbeat echo from server.
	case signaling.TypePeerJoined:
		pm.onPeerJoined(msg.PeerID)
	case signaling.TypePeerLeft:
		pm.onPeerLeft(msg.PeerID)
	case signaling.TypeAnswer:
		pm.handleAnswer(msg.PeerID, msg.NegotiationID, msg.Payload)
	case signaling.TypeICECandidate:
		pm.handleICECandidate(msg.PeerID, msg.NegotiationID, msg.Payload)
	case signaling.TypeTurnCredentials:
		pm.handleTurnCredentials(msg)
	case signaling.TypeIntercomJoined, signaling.TypeIntercomLeft, signaling.TypeIntercomState,
		signaling.TypeIntercomError, signaling.TypeIntercomSFUSession,
		signaling.TypeIntercomSFUPublished, signaling.TypeIntercomSFUSubscribed,
		signaling.TypeIntercomSFURenegotiated, signaling.TypeIntercomSFUClosed:
		pm.handleIntercomMessage(msg)
	case signaling.TypeRoomClosed:
		pm.logger.Info("room closed by signaling server")
		return true
	case signaling.TypeRoomUpdated:
		pm.sigMu.Lock()
		if msg.RoomID != "" {
			pm.roomID = msg.RoomID
		}
		if msg.RoomCode != "" {
			pm.roomCode = msg.RoomCode
		}
		roomID := pm.roomID
		roomCode := pm.roomCode
		pm.sigMu.Unlock()
		pm.logger.Info("room metadata updated on signaling server", "roomId", roomID, "roomCode", roomCode)
	case signaling.TypeError:
		pm.handleTurnRequestError(msg.Error)
		pm.logger.Warn("signaling error", "error", msg.Error)
	}
	return false
}

// scheduleReconnect claims reconnection only for the socket and lifecycle that
// actually exited. A delayed loop from before Close+Connect cannot replace the
// healthy socket of the new lifecycle.
func (pm *PeerManager) scheduleReconnect(expectedConn *websocket.Conn, expectedDone chan struct{}) bool {
	pm.lifecycleMu.Lock()
	defer pm.lifecycleMu.Unlock()
	pm.sigMu.Lock()
	if pm.sigConn != expectedConn || pm.done != expectedDone {
		pm.sigMu.Unlock()
		return false
	}
	pm.sigConn = nil
	pm.signalingReady = false
	pm.intercomGeneration++
	pm.intercomJoined = false
	pm.intercomLatestJoin = nil
	pm.intercomLatestState = nil
	if pm.closed || pm.reconnecting {
		pm.sigMu.Unlock()
		return false
	}
	pm.reconnecting = true
	pm.sigMu.Unlock()
	pm.notifyIntercomState()

	go pm.reconnectLoop(expectedDone)
	return true
}

// reconnectLoop attempts to re-establish the signaling connection with exponential backoff.
func (pm *PeerManager) reconnectLoop(done chan struct{}) {
	reconnectClaimReleased := false
	defer func() {
		if reconnectClaimReleased {
			return
		}
		pm.sigMu.Lock()
		if pm.done == done {
			pm.reconnecting = false
		}
		pm.sigMu.Unlock()
	}()

	delay := reconnectBaseDelay
	for {
		select {
		case <-done:
			return
		default:
		}

		pm.logger.Info("attempting signaling reconnection", "delay", delay)

		select {
		case <-done:
			return
		case <-time.After(delay):
		}

		if err := pm.dial(done); err != nil {
			pm.logger.Warn("signaling reconnect failed", "error", err)
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}
		pm.sigMu.Lock()
		conn := pm.sigConn
		pm.sigMu.Unlock()
		if conn == nil {
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}

		// Try room_rejoin with the stable room id.
		rejoin := pm.roomHandshakeMessage(signaling.TypeRoomRejoin)
		err := pm.writeSignalingHandshake(conn, done, rejoin)
		if err != nil {
			pm.logger.Warn("failed to send room_rejoin", "error", err)
			conn.Close()
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}

		resp, pending, err := readRoomCreated(conn)
		if err != nil {
			pm.logger.Warn("failed to read rejoin response", "error", err)
			conn.Close()
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}
		if !pm.signalingLifecycleCurrent(conn, done) {
			_ = conn.Close()
			return
		}

		rejoinFailed := false
		if resp.Type == signaling.TypeError {
			// Room expired or not found — fallback to room_create with the same stable room id.
			pm.logger.Warn("room_rejoin failed, creating new room", "error", resp.Error)
			rejoinFailed = true

			create := pm.roomHandshakeMessage(signaling.TypeRoomCreate)
			err = pm.writeSignalingHandshake(conn, done, create)
			if err != nil {
				conn.Close()
				delay *= 2
				if delay > reconnectMaxDelay {
					delay = reconnectMaxDelay
				}
				continue
			}

			createdResp, createdPending, err := readRoomCreated(conn)
			if err != nil {
				conn.Close()
				delay *= 2
				if delay > reconnectMaxDelay {
					delay = reconnectMaxDelay
				}
				continue
			}
			if !pm.signalingLifecycleCurrent(conn, done) {
				_ = conn.Close()
				return
			}
			resp = createdResp
			// Events observed before the failed rejoin belong to the old room.
			// Only replay events buffered while creating its replacement.
			pending = createdPending
		}

		if resp.Type == signaling.TypeRoomCreated {
			pm.lifecycleMu.Lock()
			if !pm.signalingLifecycleCurrent(conn, done) {
				pm.lifecycleMu.Unlock()
				_ = conn.Close()
				return
			}
			roomID, roomCode, turnGeneration, applied := pm.applyRoomAcknowledgementLocked(conn, done, resp, rejoinFailed)
			if !applied {
				pm.lifecycleMu.Unlock()
				conn.Close()
				continue
			}
			pm.logger.Info("signaling reconnected", "roomId", roomID, "roomCode", roomCode)
			pm.notifyStatus("Running")
			turnGate := pm.requestTurnCredentials(false)
			if rejoinFailed {
				// The replacement room has no old server memberships. Clear only
				// the previous room's peers before replaying any newly buffered
				// peer_joined event for this room.
				pm.closeAllPeers()
			}
			if pm.replayBufferedSignaling(pending) {
				pm.clearSignalingConnection(conn)
				pm.lifecycleMu.Unlock()
				conn.Close()
				delay *= 2
				if delay > reconnectMaxDelay {
					delay = reconnectMaxDelay
				}
				continue
			}
			pm.sigMu.Lock()
			if pm.done != done || pm.closed || pm.sigConn != conn {
				pm.sigMu.Unlock()
				pm.lifecycleMu.Unlock()
				_ = conn.Close()
				continue
			}
			pm.reconnecting = false
			reconnectClaimReleased = true
			pm.sigMu.Unlock()
			pm.startLoops(conn, done)
			pm.lifecycleMu.Unlock()
			if !rejoinFailed {
				// rejoin 성공: 살아있는 peer는 유지하고, 끊긴 peer만 ICE restart.
				go pm.recoverStalePeersAfterTurnGate(turnGate, turnGeneration)
			}
			return
		}

		pm.logger.Warn("unexpected reconnect response", "type", resp.Type)
		conn.Close()
		delay *= 2
		if delay > reconnectMaxDelay {
			delay = reconnectMaxDelay
		}
	}
}

func (pm *PeerManager) onPeerJoined(peerID string) {
	if peerID == "" {
		return
	}
	pm.sigMu.Lock()
	ready := !pm.closed && pm.signalingReady
	pm.sigMu.Unlock()
	if !ready {
		return
	}
	pm.mu.RLock()
	existingPC, existingPeer := pm.peers[peerID]
	existingDC := pm.channels[peerID]
	alreadyOpen := existingDC != nil && existingDC.ReadyState() == webrtc.DataChannelStateOpen
	_, pending := pm.pendingPeers[peerID]
	pm.mu.RUnlock()

	if alreadyOpen {
		pm.logger.Info("ignoring duplicate peer join for active connection", "peerId", peerID)
		return
	}
	if pending {
		pm.logger.Info("ignoring duplicate peer join while offer is gated", "peerId", peerID)
		return
	}
	if existingPeer {
		pcState := "nil"
		if existingPC != nil {
			pcState = existingPC.ConnectionState().String()
		}
		pm.logger.Warn("replacing stale peer state before creating new offer", "peerId", peerID, "pcState", pcState)
		pm.removePeerIf(peerID, existingPC)
	}

	pm.mu.Lock()
	if _, exists := pm.pendingPeers[peerID]; exists {
		pm.mu.Unlock()
		return
	}
	pm.nextPeerOfferGeneration++
	generation := pm.nextPeerOfferGeneration
	pm.pendingPeers[peerID] = generation
	pm.mu.Unlock()
	turnGeneration := pm.turn.currentGeneration()

	// Do not block the signaling read loop: it must receive the correlated
	// TURN response that releases this offer gate.
	gate := pm.requestTurnCredentials(false)
	go pm.createPeerAfterTurnGate(peerID, generation, turnGeneration, gate)
}

func (pm *PeerManager) createPeerAfterTurnGate(peerID string, generation, turnGeneration uint64, gate <-chan struct{}) {
	if !pm.waitForTurnGate(gate, turnGeneration) {
		pm.clearPendingPeer(peerID, generation)
		return
	}
	if !pm.pendingPeerCurrent(peerID, generation) {
		return
	}

	iceServers, source, expiresAt, fallbackReason := pm.turn.activeConfiguration()
	pm.logger.Info("engineer joined, creating peer connection", "peerId", peerID, "iceSource", source, "iceExpiresAt", expiresAt, "fallbackReason", fallbackReason)

	config := webrtc.Configuration{
		ICEServers: iceServers,
	}

	se := webrtc.SettingEngine{}
	se.SetSCTPMaxReceiveBufferSize(4 * 1024 * 1024) // 4MB
	// pion 기본 failed 타임아웃(25s)은 너무 느리다 — ICE restart 경로가 있으므로
	// 빠른 failed 전이(15s)가 유리하다. (disconnected 5s / keepalive 2s는 기본값 유지)
	se.SetICETimeouts(5*time.Second, 15*time.Second, 2*time.Second)
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(config)
	if err != nil {
		pm.logger.Error("failed to create peer connection", "peerId", peerID, "error", err)
		pm.clearPendingPeer(peerID, generation)
		return
	}

	// Create DataChannel (reliable, ordered) for pitwall state & events
	dc, err := pc.CreateDataChannel("data", &webrtc.DataChannelInit{
		Ordered: boolPtr(true),
	})
	if err != nil {
		pm.logger.Error("failed to create data channel", "peerId", peerID, "error", err)
		pc.Close()
		pm.clearPendingPeer(peerID, generation)
		return
	}

	// Create fast DataChannel (unreliable, unordered) for 60Hz position data
	maxRetransmits := uint16(0)
	fastDC, err := pc.CreateDataChannel("fast", &webrtc.DataChannelInit{
		Ordered:        boolPtr(false),
		MaxRetransmits: &maxRetransmits,
	})
	if err != nil {
		pm.logger.Error("failed to create fast data channel", "peerId", peerID, "error", err)
		// Non-fatal: proceed without fast channel
		fastDC = nil
	}

	pm.mu.Lock()
	if pm.pendingPeers[peerID] != generation || pm.peers[peerID] != nil {
		pm.mu.Unlock()
		_ = pc.Close()
		return
	}
	delete(pm.pendingPeers, peerID)
	preCandidates := append([]pendingRemoteCandidate(nil), pm.pendingRemoteCandidates[peerID]...)
	delete(pm.pendingRemoteCandidates, peerID)
	pm.peers[peerID] = pc
	pm.channels[peerID] = dc
	if fastDC != nil {
		pm.fastChannels[peerID] = fastDC
	}
	pm.peerMeta[peerID] = &peerMeta{windowStart: time.Now()}
	pm.mu.Unlock()

	dc.OnOpen(func() {
		pm.logger.Info("data channel opened", "peerId", peerID)
		if pm.onCountChange != nil {
			pm.onCountChange(pm.ConnectedCount())
		}
	})

	dc.OnClose(func() {
		pm.logger.Info("data channel closed", "peerId", peerID)
		if pm.onCountChange != nil {
			pm.onCountChange(pm.ConnectedCount())
		}
	})

	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		if !pm.peerChannelCurrent(peerID, pc, dc) {
			return
		}
		// Small JSON control messages: keepalive pong / view change
		if len(msg.Data) < 100 {
			var ctrlMsg struct {
				Type string `json:"type"`
				View string `json:"view"`
			}
			if json.Unmarshal(msg.Data, &ctrlMsg) == nil {
				switch ctrlMsg.Type {
				case "pong":
					pm.notePong(peerID, pc)
					return
				case "setView":
					switch ctrlMsg.View {
					case "cockpit", "qualifying":
						pm.mu.Lock()
						current := pm.peers[peerID] == pc && pm.channels[peerID] == dc
						if current {
							pm.peerViews[peerID] = ctrlMsg.View
						}
						pm.mu.Unlock()
						if current {
							pm.logger.Info("peer view changed", "peerId", peerID, "view", ctrlMsg.View)
						}
					}
					return
				}
			}
		}

		if pm.onRequest == nil {
			return
		}
		response := pm.onRequest(peerID, msg.Data)
		if response != nil {
			pm.sendToIfCurrent(peerID, pc, dc, response)
		}
	})

	// ICE candidate trickle
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		pm.queueOrSendLocalCandidate(peerID, pc, candidateJSON)
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		pm.logger.Info("peer connection state changed", "peerId", peerID, "state", state.String())
		switch state {
		case webrtc.PeerConnectionStateConnected:
			pm.noteConnected(peerID, pc)
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed:
			// 끊김 감지 즉시 ICE restart 시도 (캡 초과/실패 시 removePeer로 수렴).
			// 재접속 교체 후 도착한 stale 콜백이면 무시 (M12).
			pm.mu.RLock()
			current := pm.peers[peerID]
			pm.mu.RUnlock()
			if current == pc {
				// pc를 넘겨 goroutine 실행 시점에 재검증 — 이 가드와 실행 사이에
				// rejoin으로 피어가 교체되면 새 연결에 stale restart가 가지 않는다.
				go pm.restartICE(peerID, pc)
			}
		case webrtc.PeerConnectionStateClosed:
			pm.removePeerIf(peerID, pc)
		}
	})

	offerGeneration, err := pm.createAndSendOffer(peerID, pc, false)
	if err != nil {
		pm.logger.Error("failed to create offer", "peerId", peerID, "error", err)
		pm.removePeerIf(peerID, pc)
		return
	}
	pm.queuePrePeerCandidates(peerID, pc, offerGeneration, preCandidates)
}

func (pm *PeerManager) onPeerLeft(peerID string) {
	pm.logger.Info("engineer left", "peerId", peerID)
	pm.clearPendingPeer(peerID, 0)
	pm.removePeer(peerID)
}

func (pm *PeerManager) clearPendingPeer(peerID string, generation uint64) {
	pm.mu.Lock()
	if current, ok := pm.pendingPeers[peerID]; ok && (generation == 0 || current == generation) {
		delete(pm.pendingPeers, peerID)
		delete(pm.pendingRemoteCandidates, peerID)
	}
	pm.mu.Unlock()
}

func (pm *PeerManager) pendingPeerCurrent(peerID string, generation uint64) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.pendingPeers[peerID] == generation
}

func (pm *PeerManager) lockPeerNegotiation(peerID string, pc *webrtc.PeerConnection) (*peerMeta, bool) {
	pm.mu.RLock()
	meta := pm.peerMeta[peerID]
	current := pm.peers[peerID] == pc && meta != nil
	pm.mu.RUnlock()
	if !current {
		return nil, false
	}
	meta.negotiationMu.Lock()
	pm.mu.RLock()
	current = pm.peers[peerID] == pc && pm.peerMeta[peerID] == meta
	pm.mu.RUnlock()
	if !current {
		meta.negotiationMu.Unlock()
		return nil, false
	}
	return meta, true
}

func (pm *PeerManager) beginNegotiation(peerID string, pc *webrtc.PeerConnection) (uint64, bool) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if pm.peers[peerID] != pc {
		return 0, false
	}
	meta := pm.peerMeta[peerID]
	if meta == nil {
		return 0, false
	}
	pm.nextNegotiationID++
	if pm.nextNegotiationID == 0 {
		pm.nextNegotiationID++
	}
	meta.negotiationGeneration = pm.nextNegotiationID
	meta.remoteDescriptionSet = false
	meta.pendingRemoteCandidates = nil
	meta.remoteCandidatesFlushing = false
	meta.offerSent = false
	meta.pendingLocalCandidates = nil
	meta.localCandidatesFlushing = false
	meta.candidateQueueFailed = false
	return meta.negotiationGeneration, true
}

// createAndSendOffer establishes the ordering boundary for candidate trickle:
// an offer is written first, then locally gathered candidates are flushed.
func (pm *PeerManager) createAndSendOffer(peerID string, pc *webrtc.PeerConnection, restart bool) (uint64, error) {
	meta, current := pm.lockPeerNegotiation(peerID, pc)
	if !current {
		return 0, fmt.Errorf("peer connection replaced before offer")
	}
	defer meta.negotiationMu.Unlock()

	generation, ok := pm.beginNegotiation(peerID, pc)
	if !ok {
		return 0, fmt.Errorf("peer connection replaced before offer")
	}
	offerOptions := (*webrtc.OfferOptions)(nil)
	if restart {
		offerOptions = &webrtc.OfferOptions{ICERestart: true}
	}
	offer, err := pc.CreateOffer(offerOptions)
	if err != nil {
		return 0, err
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		return 0, err
	}
	offerJSON, err := json.Marshal(offer)
	if err != nil {
		return 0, err
	}
	if !pm.sendSignaling(signaling.Message{
		Type:          signaling.TypeOffer,
		PeerID:        peerID,
		Payload:       offerJSON,
		Restart:       restart,
		NegotiationID: generation,
	}) {
		return 0, fmt.Errorf("signaling connection unavailable for offer")
	}
	pm.markOfferSent(peerID, pc, generation)
	return generation, nil
}

func (pm *PeerManager) markOfferSent(peerID string, pc *webrtc.PeerConnection, generation uint64) {
	pm.mu.Lock()
	if pm.peers[peerID] != pc || pm.peerMeta[peerID] == nil || pm.peerMeta[peerID].negotiationGeneration != generation {
		pm.mu.Unlock()
		return
	}
	meta := pm.peerMeta[peerID]
	if meta.candidateQueueFailed {
		pm.mu.Unlock()
		return
	}
	meta.offerSent = true
	meta.localCandidatesFlushing = true
	pm.mu.Unlock()
	pm.flushLocalCandidates(peerID, pc, generation)
}

func (pm *PeerManager) flushLocalCandidates(peerID string, pc *webrtc.PeerConnection, generation uint64) {
	for {
		pm.mu.Lock()
		meta := pm.peerMeta[peerID]
		if pm.peers[peerID] != pc || meta == nil || meta.negotiationGeneration != generation || meta.candidateQueueFailed {
			pm.mu.Unlock()
			return
		}
		candidates := append([]json.RawMessage(nil), meta.pendingLocalCandidates...)
		meta.pendingLocalCandidates = nil
		if len(candidates) == 0 {
			meta.localCandidatesFlushing = false
			pm.mu.Unlock()
			return
		}
		pm.mu.Unlock()

		for _, candidate := range candidates {
			if !pm.sendSignaling(signaling.Message{Type: signaling.TypeICECandidate, PeerID: peerID, NegotiationID: generation, Payload: candidate}) {
				pm.logger.Warn("failed to send queued ICE candidate, dropping peer", "peerId", peerID, "direction", "local")
				go pm.removePeerIf(peerID, pc)
				return
			}
		}
	}
}

func (pm *PeerManager) queueOrSendLocalCandidate(peerID string, pc *webrtc.PeerConnection, candidate json.RawMessage) {
	pm.mu.Lock()
	if pm.peers[peerID] != pc || pm.peerMeta[peerID] == nil {
		pm.mu.Unlock()
		return
	}
	meta := pm.peerMeta[peerID]
	if meta.candidateQueueFailed {
		pm.mu.Unlock()
		return
	}
	generation := meta.negotiationGeneration
	if !meta.offerSent || meta.localCandidatesFlushing {
		if len(meta.pendingLocalCandidates) >= maxPendingICECandidates {
			meta.candidateQueueFailed = true
			pm.mu.Unlock()
			pm.logger.Warn("ICE candidate queue overflow, dropping peer", "peerId", peerID, "direction", "local")
			go pm.removePeerIf(peerID, pc)
			return
		}
		meta.pendingLocalCandidates = append(meta.pendingLocalCandidates, append(json.RawMessage(nil), candidate...))
		pm.mu.Unlock()
		return
	}
	pm.mu.Unlock()
	if !pm.sendSignaling(signaling.Message{Type: signaling.TypeICECandidate, PeerID: peerID, NegotiationID: generation, Payload: candidate}) {
		pm.logger.Warn("failed to send ICE candidate, dropping peer", "peerId", peerID, "direction", "local")
		go pm.removePeerIf(peerID, pc)
	}
}

func (pm *PeerManager) queuePrePeerCandidates(peerID string, pc *webrtc.PeerConnection, generation uint64, candidates []pendingRemoteCandidate) {
	if len(candidates) == 0 {
		return
	}
	pm.mu.Lock()
	meta := pm.peerMeta[peerID]
	if pm.peers[peerID] != pc || meta == nil || meta.negotiationGeneration != generation {
		pm.mu.Unlock()
		return
	}
	for _, candidate := range candidates {
		// A compliant new client can identify the exact offer. Generation-less
		// candidates received before any offer can only belong to an old PC, so
		// they are intentionally discarded rather than applied to a replacement.
		if candidate.negotiationID != generation {
			continue
		}
		if len(meta.pendingRemoteCandidates) >= maxPendingICECandidates {
			meta.candidateQueueFailed = true
			pm.mu.Unlock()
			pm.logger.Warn("pre-peer ICE candidate replay overflow, dropping peer", "peerId", peerID, "direction", "remote")
			go pm.removePeerIf(peerID, pc)
			return
		}
		meta.generationAware = true
		meta.pendingRemoteCandidates = append(meta.pendingRemoteCandidates, candidate)
	}
	pm.mu.Unlock()
}

func negotiationMessageMatches(meta *peerMeta, negotiationID uint64) bool {
	if meta == nil {
		return false
	}
	if negotiationID == 0 {
		return !meta.generationAware
	}
	return negotiationID == meta.negotiationGeneration
}

func (pm *PeerManager) handleAnswer(peerID string, negotiationID uint64, payload json.RawMessage) {
	var answer webrtc.SessionDescription
	if err := json.Unmarshal(payload, &answer); err != nil {
		pm.logger.Error("failed to unmarshal answer", "peerId", peerID, "error", err)
		return
	}
	pm.mu.RLock()
	pc, ok := pm.peers[peerID]
	meta := pm.peerMeta[peerID]
	pm.mu.RUnlock()
	if !ok || meta == nil {
		return
	}
	meta.negotiationMu.Lock()
	defer meta.negotiationMu.Unlock()

	pm.mu.Lock()
	if pm.peers[peerID] != pc || pm.peerMeta[peerID] != meta || !negotiationMessageMatches(meta, negotiationID) {
		pm.mu.Unlock()
		pm.logger.Warn("ignored stale SDP answer", "peerId", peerID, "negotiationId", negotiationID)
		return
	}
	generation := meta.negotiationGeneration
	pm.mu.Unlock()

	if err := pc.SetRemoteDescription(answer); err != nil {
		pm.logger.Error("failed to set remote description", "peerId", peerID, "error", err)
		return
	}

	pm.mu.Lock()
	if pm.peers[peerID] != pc || pm.peerMeta[peerID] != meta || meta.negotiationGeneration != generation {
		pm.mu.Unlock()
		return
	}
	if meta.candidateQueueFailed {
		pm.mu.Unlock()
		return
	}
	if negotiationID != 0 {
		meta.generationAware = true
	}
	meta.remoteDescriptionSet = true
	meta.remoteCandidatesFlushing = true
	pm.mu.Unlock()
	pm.flushRemoteCandidates(peerID, pc, generation)
}

func (pm *PeerManager) handleICECandidate(peerID string, negotiationID uint64, payload json.RawMessage) {
	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(payload, &candidate); err != nil {
		pm.logger.Error("failed to unmarshal ICE candidate", "peerId", peerID, "error", err)
		return
	}

	pm.mu.Lock()
	pc, ok := pm.peers[peerID]
	meta := pm.peerMeta[peerID]
	if !ok || meta == nil {
		if _, pending := pm.pendingPeers[peerID]; pending {
			queued := pm.pendingRemoteCandidates[peerID]
			if len(queued) >= maxPendingICECandidates {
				delete(pm.pendingPeers, peerID)
				delete(pm.pendingRemoteCandidates, peerID)
				pm.mu.Unlock()
				pm.logger.Warn("pre-peer ICE candidate queue overflow, cancelling offer", "peerId", peerID, "direction", "remote")
				return
			}
			pm.pendingRemoteCandidates[peerID] = append(queued, pendingRemoteCandidate{
				negotiationID: negotiationID,
				candidate:     candidate,
			})
		}
		pm.mu.Unlock()
		return
	}
	if !negotiationMessageMatches(meta, negotiationID) {
		pm.mu.Unlock()
		pm.logger.Warn("ignored stale ICE candidate", "peerId", peerID, "negotiationId", negotiationID)
		return
	}
	if negotiationID != 0 {
		meta.generationAware = true
	}
	if meta.candidateQueueFailed {
		pm.mu.Unlock()
		return
	}
	if !meta.remoteDescriptionSet || meta.remoteCandidatesFlushing {
		if len(meta.pendingRemoteCandidates) >= maxPendingICECandidates {
			meta.candidateQueueFailed = true
			pm.mu.Unlock()
			pm.logger.Warn("ICE candidate queue overflow, dropping peer", "peerId", peerID, "direction", "remote")
			go pm.removePeerIf(peerID, pc)
			return
		}
		meta.pendingRemoteCandidates = append(meta.pendingRemoteCandidates, pendingRemoteCandidate{
			negotiationID: negotiationID,
			candidate:     candidate,
		})
		pm.mu.Unlock()
		return
	}
	generation := meta.negotiationGeneration
	pm.mu.Unlock()
	pm.addRemoteCandidate(peerID, pc, generation, candidate)
}

func (pm *PeerManager) flushRemoteCandidates(peerID string, pc *webrtc.PeerConnection, generation uint64) {
	for {
		pm.mu.Lock()
		meta := pm.peerMeta[peerID]
		if pm.peers[peerID] != pc || meta == nil || meta.negotiationGeneration != generation || meta.candidateQueueFailed || !meta.remoteDescriptionSet {
			pm.mu.Unlock()
			return
		}
		queued := append([]pendingRemoteCandidate(nil), meta.pendingRemoteCandidates...)
		meta.pendingRemoteCandidates = nil
		if len(queued) == 0 {
			meta.remoteCandidatesFlushing = false
			pm.mu.Unlock()
			return
		}
		pm.mu.Unlock()

		for _, queuedCandidate := range queued {
			pm.mu.RLock()
			currentMeta := pm.peerMeta[peerID]
			valid := pm.peers[peerID] == pc &&
				currentMeta == meta &&
				currentMeta.negotiationGeneration == generation &&
				negotiationMessageMatches(currentMeta, queuedCandidate.negotiationID)
			pm.mu.RUnlock()
			if valid {
				pm.addRemoteCandidate(peerID, pc, generation, queuedCandidate.candidate)
			}
		}
	}
}

func (pm *PeerManager) addRemoteCandidate(peerID string, pc *webrtc.PeerConnection, generation uint64, candidate webrtc.ICECandidateInit) {
	pm.mu.RLock()
	meta := pm.peerMeta[peerID]
	current := pm.peers[peerID] == pc && meta != nil && meta.negotiationGeneration == generation
	pm.mu.RUnlock()
	if !current {
		return
	}
	if err := pc.AddICECandidate(candidate); err != nil {
		pm.logger.Warn("failed to add ICE candidate", "peerId", peerID)
	}
}

func (pm *PeerManager) removePeer(peerID string) {
	pm.removePeerIf(peerID, nil)
}

// removePeerIf removes the peer only when the tracked PeerConnection still
// matches expected (nil = 무조건 제거). 재접속 교체 직후 옛 연결의 비동기
// Closed 콜백이 새 PeerConnection을 파괴하는 것을 막는다 (M12).
func (pm *PeerManager) removePeerIf(peerID string, expected *webrtc.PeerConnection) {
	pm.mu.Lock()
	pc, ok := pm.peers[peerID]
	if !ok {
		if expected == nil {
			delete(pm.pendingPeers, peerID)
			delete(pm.pendingRemoteCandidates, peerID)
		}
		pm.mu.Unlock()
		return
	}
	if expected != nil && pc != expected {
		pm.mu.Unlock()
		return
	}
	pm.detachPeerLocked(peerID)
	pm.mu.Unlock()
	pm.closeRemovedPeer(peerID, pc)
}

// detachPeerLocked removes only map/timer state. The caller holds pm.mu and
// closes Pion objects afterward so synchronous callbacks cannot deadlock.
func (pm *PeerManager) detachPeerLocked(peerID string) {
	delete(pm.peers, peerID)
	delete(pm.channels, peerID)
	delete(pm.fastChannels, peerID)
	delete(pm.peerViews, peerID)
	delete(pm.pendingPeers, peerID)
	delete(pm.pendingRemoteCandidates, peerID)
	if meta := pm.peerMeta[peerID]; meta != nil && meta.restartTimer != nil {
		meta.restartTimer.Stop()
	}
	delete(pm.peerMeta, peerID)
}

func (pm *PeerManager) closeRemovedPeer(peerID string, pc *webrtc.PeerConnection) {
	// pc.Close()는 락 밖에서 — SCTP teardown이 느려도 60Hz 브로드캐스트를
	// 정지시키지 않는다 (L5).
	if err := pc.Close(); err != nil {
		pm.logger.Error("failed to close peer connection", "peerId", peerID, "error", err)
	}

	if pm.onCountChange != nil {
		pm.onCountChange(pm.ConnectedCount())
	}
}

// notePong records a keepalive pong from the peer.
func (pm *PeerManager) notePong(peerID string, expected *webrtc.PeerConnection) {
	pm.mu.Lock()
	if meta := pm.peerMeta[peerID]; meta != nil && pm.peers[peerID] == expected {
		meta.lastPongAt = time.Now()
		meta.pongSeen = true
	}
	pm.mu.Unlock()
}

// noteConnected clears any in-flight ICE restart state for the peer.
func (pm *PeerManager) noteConnected(peerID string, expected *webrtc.PeerConnection) {
	pm.mu.Lock()
	if meta := pm.peerMeta[peerID]; meta != nil && pm.peers[peerID] == expected {
		meta.restartingAt = time.Time{}
		if meta.restartTimer != nil {
			meta.restartTimer.Stop()
			meta.restartTimer = nil
		}
		// 복구 직후의 stale pong 타임아웃 오탐 방지
		meta.lastPongAt = time.Now()
	}
	pm.mu.Unlock()
}

// restartICE renegotiates the connection for an existing peer using an ICE
// restart offer. The offer travels over the regular signaling relay with the
// Restart flag so the viewer reuses its live PeerConnection (no DC teardown).
// expected가 non-nil이면 실행 시점에 등록된 PeerConnection과 일치할 때만 진행한다
// — 호출측 가드와 goroutine 실행 사이에 rejoin으로 피어가 교체된 경우 방금 맺어진
// 새 연결에 stale restart offer를 얹지 않는다 (M12의 지연 창 보완).
func (pm *PeerManager) restartICE(peerID string, expected *webrtc.PeerConnection) {
	pm.mu.Lock()
	pc, ok := pm.peers[peerID]
	meta := pm.peerMeta[peerID]
	if !ok || meta == nil || (expected != nil && pc != expected) {
		pm.mu.Unlock()
		return
	}
	if !meta.restartingAt.IsZero() {
		pm.mu.Unlock()
		return // restart already in flight
	}
	now := time.Now()
	if now.Sub(meta.windowStart) > iceRestartWindow {
		meta.windowStart = now
		meta.restarts = 0
	}
	if meta.restarts >= iceRestartMaxPerWindow {
		pm.mu.Unlock()
		pm.logger.Warn("ICE restart cap reached, dropping peer", "peerId", peerID)
		pm.removePeerIf(peerID, pc)
		return
	}
	if pc.SignalingState() != webrtc.SignalingStateStable {
		// 직전 협상이 미완(answer 미도착 등)이면 restart offer를 얹을 수 없다.
		// keepalive/ICE failed 경로가 결국 removePeer로 수렴한다.
		pm.mu.Unlock()
		pm.logger.Warn("skipping ICE restart in non-stable signaling state", "peerId", peerID, "state", pc.SignalingState().String())
		return
	}
	meta.restarts++
	meta.restartingAt = now
	pm.mu.Unlock()

	// Apply the newest runtime/static configuration before gathering restart
	// candidates. A late TURN response therefore takes effect on the next
	// restart without forcing a disruptive full rebuild.
	pm.applyCurrentICEConfiguration(pc, peerID)
	pm.logger.Info("sending ICE restart offer", "peerId", peerID)
	if _, err := pm.createAndSendOffer(peerID, pc, true); err != nil {
		pm.logger.Error("failed to create ICE restart offer", "peerId", peerID, "error", err)
		pm.removePeerIf(peerID, pc)
		return
	}

	// restart 포기 타이머: 기한 내 Connected로 복귀하지 못하면 정리하고
	// viewer의 full rejoin에 맡긴다.
	timer := time.AfterFunc(iceRestartTimeout, func() {
		pm.removePeerAfterRestartTimeout(peerID, pc, meta, now)
	})

	pm.installRestartTimer(peerID, pc, meta, now, timer)
}

func (pm *PeerManager) installRestartTimer(peerID string, pc *webrtc.PeerConnection, meta *peerMeta, startedAt time.Time, timer *time.Timer) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	// 락을 푼 사이 peer 교체, noteConnected, 또는 후속 restart가 시작될 수 있다.
	// 이 restart 시도와 정확히 같은 상태일 때만 타이머를 설치한다.
	currentMeta := pm.peerMeta[peerID]
	if pm.peers[peerID] != pc || currentMeta != meta || currentMeta == nil || !currentMeta.restartingAt.Equal(startedAt) {
		timer.Stop()
		return
	}
	if currentMeta.restartTimer != nil {
		currentMeta.restartTimer.Stop()
	}
	currentMeta.restartTimer = timer
}

func (pm *PeerManager) removePeerAfterRestartTimeout(peerID string, pc *webrtc.PeerConnection, meta *peerMeta, startedAt time.Time) {
	pm.mu.Lock()
	currentMeta := pm.peerMeta[peerID]
	if pm.peers[peerID] != pc || currentMeta == nil || currentMeta != meta ||
		!currentMeta.restartingAt.Equal(startedAt) || pc.ConnectionState() == webrtc.PeerConnectionStateConnected {
		pm.mu.Unlock()
		return
	}
	pm.detachPeerLocked(peerID)
	pm.mu.Unlock()

	pm.logger.Warn("ICE restart did not recover in time, dropping peer", "peerId", peerID)
	pm.closeRemovedPeer(peerID, pc)
}

// keepaliveLoop pings every peer's data channel and reacts to missing pongs.
func (pm *PeerManager) keepaliveLoop(done chan struct{}) {
	ticker := time.NewTicker(dcPingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			pm.pingPeers()
		}
	}
}

func (pm *PeerManager) pingPeers() {
	type target struct {
		peerID     string
		pc         *webrtc.PeerConnection
		channel    *webrtc.DataChannel
		meta       *peerMeta
		pongSeen   bool
		lastPongAt time.Time
		restarting bool
	}

	pm.mu.RLock()
	targets := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		meta := pm.peerMeta[peerID]
		t := target{peerID: peerID, pc: pm.peers[peerID], channel: ch, meta: meta}
		if meta != nil {
			t.pongSeen = meta.pongSeen
			t.lastPongAt = meta.lastPongAt
			t.restarting = !meta.restartingAt.IsZero()
		}
		targets = append(targets, t)
	}
	pm.mu.RUnlock()

	now := time.Now()
	ping := fmt.Sprintf(`{"type":"ping","ts":%d}`, now.UnixMilli())

	for _, t := range targets {
		if t.pc == nil || !pm.peerChannelCurrent(t.peerID, t.pc, t.channel) {
			continue
		}
		if t.meta != nil {
			_ = sendDataChannelText(t.channel, &t.meta.reliableSendMu, ping, 0)
		}
		if !t.pongSeen {
			continue // 구버전 viewer: pong을 보내지 않으므로 워치독 비활성
		}
		silent := now.Sub(t.lastPongAt)
		switch {
		case silent > dcPongDropAfter:
			pm.logger.Warn("peer keepalive lost, dropping peer", "peerId", t.peerID, "silentFor", silent)
			pm.removePeerIf(t.peerID, t.pc)
		case silent > dcPongRestartAfter && !t.restarting:
			pm.logger.Warn("peer keepalive stalled, attempting ICE restart", "peerId", t.peerID, "silentFor", silent)
			go pm.restartICE(t.peerID, t.pc)
		}
	}
}

// recoverStalePeers re-offers (ICE restart) to peers that are not connected.
// 시그널링 단절 중 유실된 offer/answer/candidate는 큐잉하지 않는다 — 복구 후
// 재협상 한 번이 전부 무효화·재생성하기 때문.
func (pm *PeerManager) recoverStalePeers() {
	type stalePeer struct {
		id string
		pc *webrtc.PeerConnection
	}
	pm.mu.RLock()
	stale := make([]stalePeer, 0, len(pm.peers))
	for peerID, pc := range pm.peers {
		if pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
			stale = append(stale, stalePeer{id: peerID, pc: pc})
		}
	}
	pm.mu.RUnlock()

	for _, s := range stale {
		pm.logger.Info("recovering stale peer after signaling reconnect", "peerId", s.id)
		go pm.restartICE(s.id, s.pc)
	}
}

func (pm *PeerManager) waitForTurnGate(gate <-chan struct{}, generation uint64) bool {
	if gate != nil {
		select {
		case <-gate:
		case <-pm.doneChan():
			return false
		}
	}
	return pm.turn.generationCurrent(generation)
}

func (pm *PeerManager) recoverStalePeersAfterTurnGate(gate <-chan struct{}, generation uint64) {
	if pm.waitForTurnGate(gate, generation) {
		pm.recoverStalePeers()
	}
}

// closeAllPeers tears down every peer connection but keeps the signaling link.
// room_rejoin 실패로 방을 새로 만든 경우 서버에 엔지니어 엔트리가 없으므로
// viewer의 재조인(새 협상)에 맡긴다.
func (pm *PeerManager) closeAllPeers() {
	pm.mu.Lock()
	targets := make(map[string]*webrtc.PeerConnection, len(pm.peers))
	for peerID, pc := range pm.peers {
		targets[peerID] = pc
	}
	clear(pm.pendingPeers)
	clear(pm.pendingRemoteCandidates)
	pm.mu.Unlock()

	for peerID, pc := range targets {
		pm.removePeerIf(peerID, pc)
	}
}

func (pm *PeerManager) sendSignaling(msg signaling.Message) bool {
	return pm.sendSignalingOn(nil, msg)
}

func (pm *PeerManager) roomHandshakeMessage(messageType string) signaling.Message {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return signaling.Message{
		Type:       messageType,
		RoomID:     pm.roomID,
		RoomName:   pm.roomName,
		Password:   pm.roomPassword,
		PlayerName: pm.playerName,
		OwnerToken: pm.ownerToken,
	}
}

func (pm *PeerManager) signalingLifecycleCurrent(conn *websocket.Conn, done chan struct{}) bool {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	return !pm.closed && pm.sigConn == conn && pm.done == done
}

// applyRoomAcknowledgementLocked commits a blocking handshake result only to
// the lifecycle that issued it. The caller holds lifecycleMu through buffered
// event replay so Close+Connect cannot interleave a newer room/TURN generation.
func (pm *PeerManager) applyRoomAcknowledgementLocked(
	conn *websocket.Conn,
	done chan struct{},
	msg signaling.Message,
	freshRoom bool,
) (roomID, roomCode string, turnGeneration uint64, ok bool) {
	if !pm.signalingLifecycleCurrent(conn, done) {
		return "", "", 0, false
	}
	pm.sigMu.Lock()
	if msg.RoomID != "" {
		pm.roomID = msg.RoomID
	}
	pm.roomCode = msg.RoomCode
	pm.intercomGeneration++
	pm.intercomVersion = 0
	if msg.Features != nil {
		pm.intercomVersion = msg.Features.IntercomVersion
	}
	pm.intercomJoined = false
	pm.intercomLatestJoin = nil
	pm.intercomLatestState = nil
	// A successful rejoin omits the token; a fallback room_create replaces it.
	if msg.OwnerToken != "" {
		pm.ownerToken = msg.OwnerToken
	}
	roomID = pm.roomID
	roomCode = pm.roomCode
	pm.sigMu.Unlock()

	if freshRoom {
		turnGeneration = pm.activateFreshTurnRoom(roomID)
	} else {
		turnGeneration = pm.activateTurnRoom(roomID)
	}
	if !pm.markSignalingReady(conn) {
		return "", "", 0, false
	}
	pm.notifyIntercomState()
	return roomID, roomCode, turnGeneration, true
}

func (pm *PeerManager) writeSignalingHandshake(conn *websocket.Conn, done chan struct{}, msg signaling.Message) error {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	if pm.closed || pm.sigConn != conn || pm.done != done {
		return fmt.Errorf("signaling session changed")
	}
	conn.SetWriteDeadline(time.Now().Add(sigWriteWait))
	return conn.WriteJSON(msg)
}

func (pm *PeerManager) currentReadySignalingConnection() *websocket.Conn {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	if !pm.signalingReady {
		return nil
	}
	return pm.sigConn
}

// sendSignalingOn writes only to the expected authenticated socket. TURN
// requests use this identity guard so an old request cannot cross a reconnect
// and land on a newly installed room session.
func (pm *PeerManager) sendSignalingOn(expected *websocket.Conn, msg signaling.Message) bool {
	pm.sigMu.Lock()
	conn := pm.sigConn
	if conn == nil || !pm.signalingReady || (expected != nil && conn != expected) {
		pm.sigMu.Unlock()
		return false
	}
	conn.SetWriteDeadline(time.Now().Add(sigWriteWait))
	err := conn.WriteJSON(msg)
	if err != nil && pm.sigConn == conn {
		pm.signalingReady = false
		pm.intercomGeneration++
		pm.intercomJoined = false
		pm.intercomLatestJoin = nil
		pm.intercomLatestState = nil
	}
	pm.sigMu.Unlock()
	if err != nil {
		pm.notifyIntercomState()
		pm.logger.Error("failed to send signaling message", "type", msg.Type, "error", err)
		_ = conn.Close()
		return false
	}
	return true
}

func (pm *PeerManager) markSignalingReady(conn *websocket.Conn) bool {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	if conn == nil || pm.sigConn != conn {
		return false
	}
	pm.signalingReady = true
	return true
}

func (pm *PeerManager) clearSignalingConnection(conn *websocket.Conn) {
	pm.sigMu.Lock()
	if pm.sigConn == conn {
		pm.sigConn = nil
		pm.signalingReady = false
		pm.intercomGeneration++
		pm.intercomJoined = false
		pm.intercomLatestJoin = nil
		pm.intercomLatestState = nil
	}
	pm.sigMu.Unlock()
	pm.notifyIntercomState()
}

func (pm *PeerManager) handleIntercomMessage(message signaling.Message) {
	pm.sigMu.Lock()
	switch message.Type {
	case signaling.TypeIntercomJoined:
		generation, revision, valid := intercomJoinedAuthority(message)
		currentGeneration, currentRevision, currentValid := intercomJoinedAuthorityPointer(pm.intercomLatestJoin)
		if valid && (!pm.intercomJoined || !currentValid || generation > currentGeneration) {
			copyMessage := cloneSignalingMessage(message)
			pm.intercomLatestJoin = &copyMessage
			pm.intercomLatestState = nil
			pm.intercomJoined = true
		} else if valid && generation == currentGeneration {
			if revision >= currentRevision {
				copyMessage := cloneSignalingMessage(message)
				pm.intercomLatestJoin = &copyMessage
			}
			if stateRevision, stateValid := intercomStateAuthorityPointer(pm.intercomLatestState); stateValid && stateRevision <= revision {
				pm.intercomLatestState = nil
			}
			pm.intercomJoined = true
		}
	case signaling.TypeIntercomState:
		revision, valid := intercomStateAuthority(message)
		_, joinedRevision, joinedValid := intercomJoinedAuthorityPointer(pm.intercomLatestJoin)
		currentRevision, currentValid := intercomStateAuthorityPointer(pm.intercomLatestState)
		if pm.intercomJoined && valid && (!joinedValid || revision >= joinedRevision) && (!currentValid || revision > currentRevision) {
			copyMessage := cloneSignalingMessage(message)
			pm.intercomLatestState = &copyMessage
		}
	case signaling.TypeIntercomLeft:
		pm.intercomJoined = false
		pm.intercomLatestJoin = nil
		pm.intercomLatestState = nil
	}
	handler := pm.onIntercom
	stateHandler := pm.onIntercomState
	state := pm.intercomTransportStateLocked()
	pm.sigMu.Unlock()
	if handler != nil {
		handler(cloneSignalingMessage(message))
	}
	if stateHandler != nil && (message.Type == signaling.TypeIntercomJoined || message.Type == signaling.TypeIntercomLeft) {
		stateHandler(state)
	}
}

func intercomJoinedAuthorityPointer(message *signaling.Message) (uint64, uint64, bool) {
	if message == nil {
		return 0, 0, false
	}
	return intercomJoinedAuthority(*message)
}

func intercomJoinedAuthority(message signaling.Message) (uint64, uint64, bool) {
	var payload signaling.IntercomJoinedPayload
	if message.Type != signaling.TypeIntercomJoined || json.Unmarshal(message.Payload, &payload) != nil || payload.MembershipGeneration == 0 || payload.MembershipGeneration > signaling.MaxIntercomSafeInteger || payload.Snapshot.Revision > signaling.MaxIntercomSafeInteger {
		return 0, 0, false
	}
	return payload.MembershipGeneration, payload.Snapshot.Revision, true
}

func intercomStateAuthorityPointer(message *signaling.Message) (uint64, bool) {
	if message == nil {
		return 0, false
	}
	return intercomStateAuthority(*message)
}

func intercomStateAuthority(message signaling.Message) (uint64, bool) {
	var payload signaling.IntercomSnapshot
	if message.Type != signaling.TypeIntercomState || json.Unmarshal(message.Payload, &payload) != nil || payload.Revision > signaling.MaxIntercomSafeInteger {
		return 0, false
	}
	return payload.Revision, true
}

func (pm *PeerManager) intercomTransportStateLocked() IntercomTransportState {
	version := 0
	if pm.signalingReady {
		version = pm.intercomVersion
	}
	// Joined describes the authenticated central room transport, not intercom
	// membership. A fresh renderer must be able to send its first group_create or
	// join before an intercom_joined response exists.
	return IntercomTransportState{Generation: pm.intercomGeneration, Joined: pm.signalingReady, IntercomVersion: version}
}

func (pm *PeerManager) notifyIntercomState() {
	pm.sigMu.Lock()
	handler := pm.onIntercomState
	state := pm.intercomTransportStateLocked()
	pm.sigMu.Unlock()
	if handler != nil {
		handler(state)
	}
}

func cloneSignalingMessage(message signaling.Message) signaling.Message {
	message.Payload = append(json.RawMessage(nil), message.Payload...)
	if message.Features != nil {
		features := *message.Features
		message.Features = &features
	}
	return message
}

func boolPtr(b bool) *bool { return &b }

func cloneICEServers(servers []webrtc.ICEServer) []webrtc.ICEServer {
	cloned := make([]webrtc.ICEServer, 0, len(servers))
	for _, server := range servers {
		copyServer := server
		if len(server.URLs) > 0 {
			copyServer.URLs = append([]string(nil), server.URLs...)
		}
		cloned = append(cloned, copyServer)
	}
	return cloned
}
