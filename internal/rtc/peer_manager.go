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

// peerMeta tracks per-peer keepalive and ICE-restart state. Guarded by pm.mu.
type peerMeta struct {
	lastPongAt   time.Time
	pongSeen     bool // 구버전 viewer(pong 미응답)에서는 워치독을 비활성화하는 안전망
	restarts     int
	windowStart  time.Time
	restartingAt time.Time // zero = restart 진행 중 아님
	restartTimer *time.Timer
}

// PeerManager manages WebRTC peer connections for the sender (driver) side.
// It connects to the signaling server, creates rooms, and handles
// PeerConnection lifecycle for each engineer that joins.
type PeerManager struct {
	signalingURL string
	sigConn      *websocket.Conn
	sigMu        sync.Mutex

	peers        map[string]*webrtc.PeerConnection
	channels     map[string]*webrtc.DataChannel
	fastChannels map[string]*webrtc.DataChannel
	peerViews    map[string]string // per-peer active view: "cockpit" or "qualifying"
	peerMeta     map[string]*peerMeta
	mu           sync.RWMutex

	roomID        string
	roomCode      string
	roomName      string
	roomPassword  string
	iceServers    []webrtc.ICEServer
	onRequest     RequestHandler
	onCountChange func(int)    // called when engineer count changes
	onStatus      func(string) // signaling status text for tray tooltip 등
	logger        *slog.Logger
	done          chan struct{}
	closed        bool // guarded by sigMu; Connect() after Close() re-arms done
	reconnecting  bool
	playerName    string // current in-game player nickname (guarded by sigMu)
	ownerToken    string // H6: room ownership proof from room_created (guarded by sigMu)
}

// NewPeerManager creates a PeerManager. Call Connect() to start.
func NewPeerManager(signalingURL string, logger *slog.Logger) *PeerManager {
	return &PeerManager{
		signalingURL: signalingURL,
		peers:        make(map[string]*webrtc.PeerConnection),
		channels:     make(map[string]*webrtc.DataChannel),
		fastChannels: make(map[string]*webrtc.DataChannel),
		peerViews:    make(map[string]string),
		peerMeta:     make(map[string]*peerMeta),
		iceServers:   cloneICEServers(defaultICEServers),
		logger:       logger,
		done:         make(chan struct{}),
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
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if len(servers) == 0 {
		pm.iceServers = cloneICEServers(defaultICEServers)
		return
	}
	pm.iceServers = cloneICEServers(servers)
}

// UpdateRoomMetadata updates the active signaling room metadata if connected.
func (pm *PeerManager) UpdateRoomMetadata(name, password string) {
	pm.sigMu.Lock()
	pm.roomName = name
	pm.roomPassword = password
	connected := pm.sigConn != nil
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
func (pm *PeerManager) RoomID() string { return pm.roomID }

// RoomCode returns the current room code assigned by the signaling server.
func (pm *PeerManager) RoomCode() string { return pm.roomCode }

// Connect establishes a WebSocket connection to the signaling server and sends room_create.
// Safe to call again after Close(): the done channel is re-armed so the
// read/write loops and reconnect logic work for the new session.
func (pm *PeerManager) Connect() error {
	pm.sigMu.Lock()
	if pm.closed {
		pm.done = make(chan struct{})
		pm.closed = false
		pm.reconnecting = false
	}
	pm.sigMu.Unlock()

	if err := pm.dial(); err != nil {
		return err
	}

	// Send room_create
	create := signaling.Message{
		Type:       signaling.TypeRoomCreate,
		RoomID:     pm.roomID,
		RoomName:   pm.roomName,
		Password:   pm.roomPassword,
		PlayerName: pm.getPlayerName(),
		OwnerToken: pm.getOwnerToken(),
	}
	if err := pm.sigConn.WriteJSON(create); err != nil {
		pm.sigConn.Close()
		return fmt.Errorf("send room_create: %w", err)
	}

	// Read room_created response
	var resp signaling.Message
	if err := pm.sigConn.ReadJSON(&resp); err != nil {
		pm.sigConn.Close()
		return fmt.Errorf("read room_created: %w", err)
	}
	if resp.Type == signaling.TypeError {
		pm.sigConn.Close()
		return fmt.Errorf("signaling error: %s", resp.Error)
	}
	if resp.Type != signaling.TypeRoomCreated {
		pm.sigConn.Close()
		return fmt.Errorf("unexpected message: %s", resp.Type)
	}

	pm.roomID = resp.RoomID
	pm.roomCode = resp.RoomCode
	if resp.OwnerToken != "" {
		pm.setOwnerToken(resp.OwnerToken)
	}
	pm.logger.Info("room created on signaling server", "roomId", pm.roomID, "roomCode", pm.roomCode)

	pm.startLoops()
	go pm.keepaliveLoop()
	return nil
}

// dial establishes a WebSocket connection and installs pong handler + read deadline.
func (pm *PeerManager) dial() error {
	conn, _, err := sigDialer.Dial(pm.signalingURL, nil)
	if err != nil {
		return fmt.Errorf("signaling connect: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(sigPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(sigPongWait))
		return nil
	})

	pm.sigMu.Lock()
	pm.sigConn = conn
	pm.sigMu.Unlock()

	return nil
}

// startLoops launches the read and write (ping) goroutines.
// writeDone은 세대-로컬 채널 — 재연결로 루프가 다시 뜰 때 이전 세대의
// close가 새 write 루프를 종료시키는 레이스를 막는다.
func (pm *PeerManager) startLoops() {
	wd := make(chan struct{})
	go pm.readSignalingLoop(wd)
	go pm.writeSignalingLoop(wd)
}

// BroadcastAll sends a binary message to all connected DataChannels.
// Channels are snapshotted under RLock so SCTP writes never run while holding
// the lock (a slow write would otherwise block removePeer and friends).
func (pm *PeerManager) BroadcastAll(message []byte) {
	type target struct {
		peerID  string
		channel *webrtc.DataChannel
	}
	pm.mu.RLock()
	snapshot := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		snapshot = append(snapshot, target{peerID: peerID, channel: ch})
	}
	pm.mu.RUnlock()

	for _, t := range snapshot {
		if t.channel.ReadyState() != webrtc.DataChannelStateOpen {
			continue
		}
		if t.channel.BufferedAmount() > maxBufferedAmount {
			pm.logger.Debug("dropping message for slow peer", "peerId", t.peerID)
			continue
		}
		if err := t.channel.Send(message); err != nil {
			pm.logger.Debug("send failed", "peerId", t.peerID, "error", err)
		}
	}
}

// BroadcastAllFast sends a binary message to all connected fast DataChannels.
// Messages are silently dropped for slow peers (no log spam at 60Hz).
func (pm *PeerManager) BroadcastAllFast(message []byte) {
	pm.mu.RLock()
	snapshot := make([]*webrtc.DataChannel, 0, len(pm.fastChannels))
	for _, ch := range pm.fastChannels {
		snapshot = append(snapshot, ch)
	}
	pm.mu.RUnlock()

	for _, ch := range snapshot {
		if ch.ReadyState() != webrtc.DataChannelStateOpen {
			continue
		}
		if ch.BufferedAmount() > maxBufferedAmount {
			continue
		}
		_ = ch.Send(message)
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
	}
	targets := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		targets = append(targets, target{
			peerID:  peerID,
			channel: ch,
			view:    pm.peerViews[peerID],
		})
	}
	pm.mu.RUnlock()

	dropped := 0
	total := len(targets)
	for _, target := range targets {
		if target.channel.ReadyState() != webrtc.DataChannelStateOpen {
			total--
			continue
		}
		if target.channel.BufferedAmount() > maxBufferedAmount {
			pm.logger.Debug("dropping message for slow peer", "peerId", target.peerID)
			dropped++
			continue
		}
		message := resolve(target.peerID, target.view)
		if len(message) == 0 {
			continue
		}
		if err := target.channel.Send(message); err != nil {
			pm.logger.Debug("send failed", "peerId", target.peerID, "error", err)
		}
	}
	return dropped, total
}

// SendTo sends a message to a specific peer's DataChannel (unicast).
func (pm *PeerManager) SendTo(peerID string, message []byte) {
	pm.mu.RLock()
	ch, ok := pm.channels[peerID]
	pm.mu.RUnlock()
	if !ok || ch.ReadyState() != webrtc.DataChannelStateOpen {
		return
	}
	_ = ch.Send(message)
}

// SendToBuffered sends a message to a specific peer while waiting for channel backpressure to drain.
func (pm *PeerManager) SendToBuffered(peerID string, message []byte, wait time.Duration) error {
	pm.mu.RLock()
	ch, ok := pm.channels[peerID]
	pm.mu.RUnlock()
	if !ok || ch.ReadyState() != webrtc.DataChannelStateOpen {
		return fmt.Errorf("peer data channel not open")
	}

	deadline := time.Now().Add(wait)
	for ch.BufferedAmount() > maxBufferedAmount {
		if ch.ReadyState() != webrtc.DataChannelStateOpen {
			return fmt.Errorf("peer data channel closed")
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("peer data channel congested")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if err := ch.Send(message); err != nil {
		return err
	}
	return nil
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
	PeerID        string `json:"peerId"`
	State         string `json:"state"`
	ICEState      string `json:"iceState,omitempty"`
	CandidatePair string `json:"candidatePair,omitempty"` // 예: "srflx -> host"
	Restarts      int    `json:"restarts,omitempty"`
	LastPongAgoMs int64  `json:"lastPongAgoMs,omitempty"`
	View          string `json:"view,omitempty"`
}

// DebugPeers returns debug info for all tracked peers.
func (pm *PeerManager) DebugPeers() []PeerDebugInfo {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	var out []PeerDebugInfo
	for peerID, ch := range pm.channels {
		info := PeerDebugInfo{
			PeerID: peerID,
			State:  ch.ReadyState().String(),
			View:   pm.peerViews[peerID],
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
	pm.sigMu.Lock()
	if pm.closed {
		pm.sigMu.Unlock()
		return
	}
	pm.closed = true
	done := pm.done
	pm.sigMu.Unlock()
	close(done)

	pm.mu.Lock()
	for id, pc := range pm.peers {
		pc.Close()
		delete(pm.peers, id)
		delete(pm.channels, id)
		delete(pm.fastChannels, id)
	}
	pm.mu.Unlock()

	pm.sigMu.Lock()
	if pm.sigConn != nil {
		pm.sigConn.Close()
	}
	pm.sigMu.Unlock()
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
func (pm *PeerManager) writeSignalingLoop(writeDone chan struct{}) {
	done := pm.doneChan()
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
			if pm.sigConn != nil {
				pm.sigConn.SetWriteDeadline(time.Now().Add(sigWriteWait))
				if err := pm.sigConn.WriteMessage(websocket.PingMessage, nil); err != nil {
					pm.sigMu.Unlock()
					return
				}
			}
			pm.sigMu.Unlock()
		case <-heartbeatTicker.C:
			// Application-level keepalive (also carries the latest player nickname
			// for server-side IP auto-ban detection on nickname change).
			pm.sendSignaling(signaling.Message{Type: signaling.TypeHeartbeat, PlayerName: pm.getPlayerName()})
		}
	}
}

func (pm *PeerManager) readSignalingLoop(writeDone chan struct{}) {
	done := pm.doneChan()
	roomClosed := false
	pm.sigMu.Lock()
	conn := pm.sigConn
	pm.sigMu.Unlock()
	defer func() {
		close(writeDone)
		pm.sigMu.Lock()
		if pm.sigConn == conn {
			pm.sigConn = nil
		}
		pm.sigMu.Unlock()
		if !roomClosed {
			pm.notifyStatus("Signaling 재연결 중")
			pm.scheduleReconnect()
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

		switch msg.Type {
		case signaling.TypeHeartbeat:
			// Ignore heartbeat echo from server.
		case signaling.TypePeerJoined:
			pm.onPeerJoined(msg.PeerID)
		case signaling.TypePeerLeft:
			pm.onPeerLeft(msg.PeerID)
		case signaling.TypeAnswer:
			pm.handleAnswer(msg.PeerID, msg.Payload)
		case signaling.TypeICECandidate:
			pm.handleICECandidate(msg.PeerID, msg.Payload)
		case signaling.TypeRoomClosed:
			pm.logger.Info("room closed by signaling server")
			roomClosed = true
			return
		case signaling.TypeRoomUpdated:
			if msg.RoomID != "" {
				pm.roomID = msg.RoomID
			}
			if msg.RoomCode != "" {
				pm.roomCode = msg.RoomCode
			}
			pm.logger.Info("room metadata updated on signaling server", "roomId", pm.roomID, "roomCode", pm.roomCode)
		case signaling.TypeError:
			pm.logger.Warn("signaling error", "error", msg.Error)
		}
	}
}

// scheduleReconnect initiates a reconnection attempt if not already in progress.
func (pm *PeerManager) scheduleReconnect() {
	pm.sigMu.Lock()
	if pm.closed || pm.reconnecting {
		pm.sigMu.Unlock()
		return
	}
	pm.reconnecting = true
	pm.sigMu.Unlock()

	go pm.reconnectLoop()
}

// reconnectLoop attempts to re-establish the signaling connection with exponential backoff.
func (pm *PeerManager) reconnectLoop() {
	done := pm.doneChan()
	defer func() {
		pm.sigMu.Lock()
		pm.reconnecting = false
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

		if err := pm.dial(); err != nil {
			pm.logger.Warn("signaling reconnect failed", "error", err)
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}

		// Try room_rejoin with the stable room id.
		rejoin := signaling.Message{
			Type:       signaling.TypeRoomRejoin,
			RoomID:     pm.roomID,
			RoomName:   pm.roomName,
			Password:   pm.roomPassword,
			PlayerName: pm.getPlayerName(),
			OwnerToken: pm.getOwnerToken(),
		}
		pm.sigMu.Lock()
		err := pm.sigConn.WriteJSON(rejoin)
		pm.sigMu.Unlock()
		if err != nil {
			pm.logger.Warn("failed to send room_rejoin", "error", err)
			pm.sigConn.Close()
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}

		var resp signaling.Message
		if err := pm.sigConn.ReadJSON(&resp); err != nil {
			pm.logger.Warn("failed to read rejoin response", "error", err)
			pm.sigConn.Close()
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
			continue
		}

		rejoinFailed := false
		if resp.Type == signaling.TypeError {
			// Room expired or not found — fallback to room_create with the same stable room id.
			pm.logger.Warn("room_rejoin failed, creating new room", "error", resp.Error)
			rejoinFailed = true

			create := signaling.Message{
				Type:       signaling.TypeRoomCreate,
				RoomID:     pm.roomID,
				RoomName:   pm.roomName,
				Password:   pm.roomPassword,
				PlayerName: pm.getPlayerName(),
				OwnerToken: pm.getOwnerToken(),
			}
			pm.sigMu.Lock()
			err = pm.sigConn.WriteJSON(create)
			pm.sigMu.Unlock()
			if err != nil {
				pm.sigConn.Close()
				delay *= 2
				if delay > reconnectMaxDelay {
					delay = reconnectMaxDelay
				}
				continue
			}

			if err := pm.sigConn.ReadJSON(&resp); err != nil {
				pm.sigConn.Close()
				delay *= 2
				if delay > reconnectMaxDelay {
					delay = reconnectMaxDelay
				}
				continue
			}
		}

		if resp.Type == signaling.TypeRoomCreated {
			if resp.RoomID != "" {
				pm.roomID = resp.RoomID
			}
			pm.roomCode = resp.RoomCode
			// rejoin 성공 응답은 토큰을 싣지 않아 기존 토큰을 유지하고, 폴백 create가
			// 새 방을 만든 경우에만 새 토큰으로 갱신한다(H6).
			if resp.OwnerToken != "" {
				pm.setOwnerToken(resp.OwnerToken)
			}
			pm.logger.Info("signaling reconnected", "roomId", pm.roomID, "roomCode", pm.roomCode)
			pm.notifyStatus("Running")
			pm.startLoops()
			if rejoinFailed {
				// 방이 만료되어 새로 생성됨 — 서버에 엔지니어 세션이 없으므로
				// 기존 peer를 정리하고 viewer 재조인을 기다린다.
				pm.closeAllPeers()
			} else {
				// rejoin 성공: 살아있는 peer는 유지하고, 끊긴 peer만 ICE restart.
				pm.recoverStalePeers()
			}
			return
		}

		pm.logger.Warn("unexpected reconnect response", "type", resp.Type)
		pm.sigConn.Close()
		delay *= 2
		if delay > reconnectMaxDelay {
			delay = reconnectMaxDelay
		}
	}
}

func (pm *PeerManager) onPeerJoined(peerID string) {
	pm.mu.RLock()
	existingPC, existingPeer := pm.peers[peerID]
	existingDC := pm.channels[peerID]
	alreadyOpen := existingDC != nil && existingDC.ReadyState() == webrtc.DataChannelStateOpen
	pm.mu.RUnlock()

	if alreadyOpen {
		pm.logger.Info("ignoring duplicate peer join for active connection", "peerId", peerID)
		return
	}
	if existingPeer {
		pcState := "nil"
		if existingPC != nil {
			pcState = existingPC.ConnectionState().String()
		}
		pm.logger.Warn("replacing stale peer state before creating new offer", "peerId", peerID, "pcState", pcState)
		pm.removePeer(peerID)
	}

	pm.logger.Info("engineer joined, creating peer connection", "peerId", peerID)

	pm.mu.RLock()
	iceServers := cloneICEServers(pm.iceServers)
	pm.mu.RUnlock()

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
		return
	}

	// Create DataChannel (reliable, ordered) for pitwall state & events
	dc, err := pc.CreateDataChannel("data", &webrtc.DataChannelInit{
		Ordered: boolPtr(true),
	})
	if err != nil {
		pm.logger.Error("failed to create data channel", "peerId", peerID, "error", err)
		pc.Close()
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
		// Small JSON control messages: keepalive pong / view change
		if len(msg.Data) < 100 {
			var ctrlMsg struct {
				Type string `json:"type"`
				View string `json:"view"`
			}
			if json.Unmarshal(msg.Data, &ctrlMsg) == nil {
				switch ctrlMsg.Type {
				case "pong":
					pm.notePong(peerID)
					return
				case "setView":
					switch ctrlMsg.View {
					case "cockpit", "qualifying":
						pm.mu.Lock()
						pm.peerViews[peerID] = ctrlMsg.View
						pm.mu.Unlock()
						pm.logger.Info("peer view changed", "peerId", peerID, "view", ctrlMsg.View)
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
			pm.SendTo(peerID, response)
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
		pm.sendSignaling(signaling.Message{
			Type:    signaling.TypeICECandidate,
			PeerID:  peerID,
			Payload: candidateJSON,
		})
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		pm.logger.Info("peer connection state changed", "peerId", peerID, "state", state.String())
		switch state {
		case webrtc.PeerConnectionStateConnected:
			pm.noteConnected(peerID)
		case webrtc.PeerConnectionStateDisconnected, webrtc.PeerConnectionStateFailed:
			// 끊김 감지 즉시 ICE restart 시도 (캡 초과/실패 시 removePeer로 수렴).
			// 재접속 교체 후 도착한 stale 콜백이면 무시 (M12).
			pm.mu.RLock()
			current := pm.peers[peerID]
			pm.mu.RUnlock()
			if current == pc {
				go pm.restartICE(peerID)
			}
		case webrtc.PeerConnectionStateClosed:
			pm.removePeerIf(peerID, pc)
		}
	})

	// Create offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pm.logger.Error("failed to create offer", "peerId", peerID, "error", err)
		pm.removePeer(peerID)
		return
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		pm.logger.Error("failed to set local description", "peerId", peerID, "error", err)
		pm.removePeer(peerID)
		return
	}

	offerJSON, err := json.Marshal(offer)
	if err != nil {
		pm.logger.Error("failed to marshal offer", "peerId", peerID, "error", err)
		return
	}

	pm.sendSignaling(signaling.Message{
		Type:    signaling.TypeOffer,
		PeerID:  peerID,
		Payload: offerJSON,
	})
}

func (pm *PeerManager) onPeerLeft(peerID string) {
	pm.logger.Info("engineer left", "peerId", peerID)
	pm.removePeer(peerID)
}

func (pm *PeerManager) handleAnswer(peerID string, payload json.RawMessage) {
	pm.mu.RLock()
	pc, ok := pm.peers[peerID]
	pm.mu.RUnlock()
	if !ok {
		return
	}

	var answer webrtc.SessionDescription
	if err := json.Unmarshal(payload, &answer); err != nil {
		pm.logger.Error("failed to unmarshal answer", "peerId", peerID, "error", err)
		return
	}

	if err := pc.SetRemoteDescription(answer); err != nil {
		pm.logger.Error("failed to set remote description", "peerId", peerID, "error", err)
	}
}

func (pm *PeerManager) handleICECandidate(peerID string, payload json.RawMessage) {
	pm.mu.RLock()
	pc, ok := pm.peers[peerID]
	pm.mu.RUnlock()
	if !ok {
		return
	}

	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(payload, &candidate); err != nil {
		pm.logger.Error("failed to unmarshal ICE candidate", "peerId", peerID, "error", err)
		return
	}

	if err := pc.AddICECandidate(candidate); err != nil {
		pm.logger.Error("failed to add ICE candidate", "peerId", peerID, "error", err)
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
	if !ok || (expected != nil && pc != expected) {
		pm.mu.Unlock()
		return
	}
	delete(pm.peers, peerID)
	delete(pm.channels, peerID)
	delete(pm.fastChannels, peerID)
	delete(pm.peerViews, peerID)
	if meta := pm.peerMeta[peerID]; meta != nil && meta.restartTimer != nil {
		meta.restartTimer.Stop()
	}
	delete(pm.peerMeta, peerID)
	pm.mu.Unlock()

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
func (pm *PeerManager) notePong(peerID string) {
	pm.mu.Lock()
	if meta := pm.peerMeta[peerID]; meta != nil {
		meta.lastPongAt = time.Now()
		meta.pongSeen = true
	}
	pm.mu.Unlock()
}

// noteConnected clears any in-flight ICE restart state for the peer.
func (pm *PeerManager) noteConnected(peerID string) {
	pm.mu.Lock()
	if meta := pm.peerMeta[peerID]; meta != nil {
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
func (pm *PeerManager) restartICE(peerID string) {
	pm.mu.Lock()
	pc, ok := pm.peers[peerID]
	meta := pm.peerMeta[peerID]
	if !ok || meta == nil {
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
		pm.removePeer(peerID)
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

	offer, err := pc.CreateOffer(&webrtc.OfferOptions{ICERestart: true})
	if err != nil {
		pm.logger.Error("failed to create ICE restart offer", "peerId", peerID, "error", err)
		pm.removePeer(peerID)
		return
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		pm.logger.Error("failed to set ICE restart local description", "peerId", peerID, "error", err)
		pm.removePeer(peerID)
		return
	}
	offerJSON, err := json.Marshal(offer)
	if err != nil {
		pm.logger.Error("failed to marshal ICE restart offer", "peerId", peerID, "error", err)
		pm.removePeer(peerID)
		return
	}

	pm.logger.Info("sending ICE restart offer", "peerId", peerID)
	pm.sendSignaling(signaling.Message{
		Type:    signaling.TypeOffer,
		PeerID:  peerID,
		Payload: offerJSON,
		Restart: true,
	})

	// restart 포기 타이머: 기한 내 Connected로 복귀하지 못하면 정리하고
	// viewer의 full rejoin에 맡긴다.
	timer := time.AfterFunc(iceRestartTimeout, func() {
		pm.mu.RLock()
		current, exists := pm.peers[peerID]
		pm.mu.RUnlock()
		if !exists || current != pc {
			return
		}
		if pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
			pm.logger.Warn("ICE restart did not recover in time, dropping peer", "peerId", peerID)
			pm.removePeer(peerID)
		}
	})

	pm.mu.Lock()
	// 락을 푼 사이 noteConnected가 restart 상태를 정리했을 수 있다(ICE 자가 복구).
	// restartingAt이 비워졌으면 이 restart는 이미 끝난 것 — 새 타이머를 버린다.
	if m := pm.peerMeta[peerID]; m != nil && !m.restartingAt.IsZero() {
		if m.restartTimer != nil {
			m.restartTimer.Stop()
		}
		m.restartTimer = timer
	} else {
		timer.Stop()
	}
	pm.mu.Unlock()
}

// keepaliveLoop pings every peer's data channel and reacts to missing pongs.
func (pm *PeerManager) keepaliveLoop() {
	done := pm.doneChan()
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
		channel    *webrtc.DataChannel
		pongSeen   bool
		lastPongAt time.Time
		restarting bool
	}

	pm.mu.RLock()
	targets := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		meta := pm.peerMeta[peerID]
		t := target{peerID: peerID, channel: ch}
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
		if t.channel.ReadyState() == webrtc.DataChannelStateOpen {
			_ = t.channel.SendText(ping)
		}
		if !t.pongSeen {
			continue // 구버전 viewer: pong을 보내지 않으므로 워치독 비활성
		}
		silent := now.Sub(t.lastPongAt)
		switch {
		case silent > dcPongDropAfter:
			pm.logger.Warn("peer keepalive lost, dropping peer", "peerId", t.peerID, "silentFor", silent)
			pm.removePeer(t.peerID)
		case silent > dcPongRestartAfter && !t.restarting:
			pm.logger.Warn("peer keepalive stalled, attempting ICE restart", "peerId", t.peerID, "silentFor", silent)
			go pm.restartICE(t.peerID)
		}
	}
}

// recoverStalePeers re-offers (ICE restart) to peers that are not connected.
// 시그널링 단절 중 유실된 offer/answer/candidate는 큐잉하지 않는다 — 복구 후
// 재협상 한 번이 전부 무효화·재생성하기 때문.
func (pm *PeerManager) recoverStalePeers() {
	pm.mu.RLock()
	stale := make([]string, 0, len(pm.peers))
	for peerID, pc := range pm.peers {
		if pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
			stale = append(stale, peerID)
		}
	}
	pm.mu.RUnlock()

	for _, peerID := range stale {
		pm.logger.Info("recovering stale peer after signaling reconnect", "peerId", peerID)
		go pm.restartICE(peerID)
	}
}

// closeAllPeers tears down every peer connection but keeps the signaling link.
// room_rejoin 실패로 방을 새로 만든 경우 서버에 엔지니어 엔트리가 없으므로
// viewer의 재조인(새 협상)에 맡긴다.
func (pm *PeerManager) closeAllPeers() {
	pm.mu.Lock()
	ids := make([]string, 0, len(pm.peers))
	for peerID := range pm.peers {
		ids = append(ids, peerID)
	}
	pm.mu.Unlock()

	for _, peerID := range ids {
		pm.removePeer(peerID)
	}
}

func (pm *PeerManager) sendSignaling(msg signaling.Message) {
	pm.sigMu.Lock()
	conn := pm.sigConn
	if conn == nil {
		pm.sigMu.Unlock()
		return
	}
	conn.SetWriteDeadline(time.Now().Add(sigWriteWait))
	err := conn.WriteJSON(msg)
	pm.sigMu.Unlock()
	if err != nil {
		pm.logger.Error("failed to send signaling message", "type", msg.Type, "error", err)
		_ = conn.Close()
	}
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
