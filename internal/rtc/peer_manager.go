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
)

// RequestHandler is called when an engineer sends a request over DataChannel.
// The returned bytes are sent back as a unicast response.
type RequestHandler func(peerID string, msg []byte) []byte

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
	permits      map[string]signaling.Permissions
	peerViews    map[string]string // per-peer active view: "cockpit", "commentary", "qualifying"
	mu           sync.RWMutex

	roomID        string
	roomCode      string
	roomName      string
	roomPassword  string
	onRequest     RequestHandler
	onCountChange func(int) // called when engineer count changes
	logger        *slog.Logger
	done          chan struct{}
	reconnecting  bool
	writeDone     chan struct{}
}

// NewPeerManager creates a PeerManager. Call Connect() to start.
func NewPeerManager(signalingURL string, logger *slog.Logger) *PeerManager {
	return &PeerManager{
		signalingURL: signalingURL,
		peers:        make(map[string]*webrtc.PeerConnection),
		channels:     make(map[string]*webrtc.DataChannel),
		fastChannels: make(map[string]*webrtc.DataChannel),
		permits:      make(map[string]signaling.Permissions),
		peerViews:    make(map[string]string),
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

// SetRoomMetadata stores room list metadata used for room creation and updates.
func (pm *PeerManager) SetRoomMetadata(name, password string) {
	pm.sigMu.Lock()
	pm.roomName = name
	pm.roomPassword = password
	pm.sigMu.Unlock()
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
func (pm *PeerManager) Connect() error {
	if err := pm.dial(); err != nil {
		return err
	}

	// Send room_create
	create := signaling.Message{
		Type:     signaling.TypeRoomCreate,
		RoomID:   pm.roomID,
		RoomName: pm.roomName,
		Password: pm.roomPassword,
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
	pm.logger.Info("room created on signaling server", "roomId", pm.roomID, "roomCode", pm.roomCode)

	pm.startLoops()
	return nil
}

// dial establishes a WebSocket connection and installs pong handler + read deadline.
func (pm *PeerManager) dial() error {
	conn, _, err := websocket.DefaultDialer.Dial(pm.signalingURL, nil)
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
func (pm *PeerManager) startLoops() {
	pm.writeDone = make(chan struct{})
	go pm.readSignalingLoop()
	go pm.writeSignalingLoop()
}

// BroadcastAll sends a binary message to all connected DataChannels.
func (pm *PeerManager) BroadcastAll(message []byte) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	for peerID, ch := range pm.channels {
		if ch.ReadyState() != webrtc.DataChannelStateOpen {
			continue
		}
		if ch.BufferedAmount() > maxBufferedAmount {
			pm.logger.Debug("dropping message for slow peer", "peerId", peerID)
			continue
		}
		if err := ch.Send(message); err != nil {
			pm.logger.Debug("send failed", "peerId", peerID, "error", err)
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
func (pm *PeerManager) BroadcastPerPeer(resolve func(peerID string, permissions signaling.Permissions, view string) []byte) (int, int) {
	pm.mu.RLock()
	type target struct {
		peerID      string
		channel     *webrtc.DataChannel
		permissions signaling.Permissions
		view        string
	}
	targets := make([]target, 0, len(pm.channels))
	for peerID, ch := range pm.channels {
		targets = append(targets, target{
			peerID:      peerID,
			channel:     ch,
			permissions: pm.permits[peerID],
			view:        pm.peerViews[peerID],
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
		message := resolve(target.peerID, target.permissions, target.view)
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

// PeerDebugInfo returns debug information about connected peers and their permissions.
type PeerDebugInfo struct {
	PeerID      string                `json:"peerId"`
	State       string                `json:"state"`
	Permissions signaling.Permissions `json:"permissions"`
}

// DebugPeers returns debug info for all tracked peers.
func (pm *PeerManager) DebugPeers() []PeerDebugInfo {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	var out []PeerDebugInfo
	for peerID, ch := range pm.channels {
		out = append(out, PeerDebugInfo{
			PeerID:      peerID,
			State:       ch.ReadyState().String(),
			Permissions: pm.permits[peerID],
		})
	}
	return out
}

// Close shuts down all peer connections and the signaling connection.
func (pm *PeerManager) Close() {
	close(pm.done)

	pm.mu.Lock()
	for id, pc := range pm.peers {
		pc.Close()
		delete(pm.peers, id)
		delete(pm.channels, id)
		delete(pm.fastChannels, id)
		delete(pm.permits, id)
	}
	pm.mu.Unlock()

	pm.sigMu.Lock()
	if pm.sigConn != nil {
		pm.sigConn.Close()
	}
	pm.sigMu.Unlock()
}

// writeSignalingLoop sends periodic pings and heartbeat messages to keep the signaling connection alive.
func (pm *PeerManager) writeSignalingLoop() {
	pingTicker := time.NewTicker(sigPingPeriod)
	heartbeatTicker := time.NewTicker(sigHeartbeatPeriod)
	defer pingTicker.Stop()
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-pm.done:
			return
		case <-pm.writeDone:
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
			// Application-level keepalive to survive reverse proxy idle timeouts.
			pm.sendSignaling(signaling.Message{Type: signaling.TypeHeartbeat})
		}
	}
}

func (pm *PeerManager) readSignalingLoop() {
	roomClosed := false
	defer func() {
		close(pm.writeDone)
		if !roomClosed {
			pm.scheduleReconnect()
		}
		pm.logger.Info("signaling read loop exited")
	}()

	for {
		select {
		case <-pm.done:
			return
		default:
		}

		var msg signaling.Message
		if err := pm.sigConn.ReadJSON(&msg); err != nil {
			select {
			case <-pm.done:
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
			pm.onPeerJoined(msg.PeerID, msg.Permissions)
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
	select {
	case <-pm.done:
		return
	default:
	}

	pm.sigMu.Lock()
	if pm.reconnecting {
		pm.sigMu.Unlock()
		return
	}
	pm.reconnecting = true
	pm.sigMu.Unlock()

	go pm.reconnectLoop()
}

// reconnectLoop attempts to re-establish the signaling connection with exponential backoff.
func (pm *PeerManager) reconnectLoop() {
	defer func() {
		pm.sigMu.Lock()
		pm.reconnecting = false
		pm.sigMu.Unlock()
	}()

	delay := reconnectBaseDelay
	for {
		select {
		case <-pm.done:
			return
		default:
		}

		pm.logger.Info("attempting signaling reconnection", "delay", delay)

		select {
		case <-pm.done:
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
			Type:     signaling.TypeRoomRejoin,
			RoomID:   pm.roomID,
			RoomName: pm.roomName,
			Password: pm.roomPassword,
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

		if resp.Type == signaling.TypeError {
			// Room expired or not found — fallback to room_create with the same stable room id.
			pm.logger.Warn("room_rejoin failed, creating new room", "error", resp.Error)

			create := signaling.Message{
				Type:     signaling.TypeRoomCreate,
				RoomID:   pm.roomID,
				RoomName: pm.roomName,
				Password: pm.roomPassword,
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
			pm.logger.Info("signaling reconnected", "roomId", pm.roomID, "roomCode", pm.roomCode)
			pm.startLoops()
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

func (pm *PeerManager) onPeerJoined(peerID string, permissions signaling.Permissions) {
	pm.logger.Info("engineer joined, creating peer connection", "peerId", peerID)

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"}},
		},
	}

	se := webrtc.SettingEngine{}
	se.SetSCTPMaxReceiveBufferSize(4 * 1024 * 1024) // 4MB
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
	pm.permits[peerID] = permissions
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
		// Check for view change message
		if len(msg.Data) < 100 {
			var viewMsg struct {
				Type string `json:"type"`
				View string `json:"view"`
			}
			if json.Unmarshal(msg.Data, &viewMsg) == nil && viewMsg.Type == "setView" {
				pm.mu.Lock()
				pm.peerViews[peerID] = viewMsg.View
				pm.mu.Unlock()
				pm.logger.Info("peer view changed", "peerId", peerID, "view", viewMsg.View)
				return
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
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			pm.removePeer(peerID)
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
	pm.mu.Lock()
	pc, ok := pm.peers[peerID]
	if ok {
		pc.Close()
		delete(pm.peers, peerID)
		delete(pm.channels, peerID)
		delete(pm.fastChannels, peerID)
		delete(pm.permits, peerID)
	}
	pm.mu.Unlock()

	if ok && pm.onCountChange != nil {
		pm.onCountChange(pm.ConnectedCount())
	}
}

func (pm *PeerManager) sendSignaling(msg signaling.Message) {
	pm.sigMu.Lock()
	defer pm.sigMu.Unlock()
	if pm.sigConn == nil {
		return
	}
	pm.sigConn.SetWriteDeadline(time.Now().Add(sigWriteWait))
	if err := pm.sigConn.WriteJSON(msg); err != nil {
		pm.logger.Error("failed to send signaling message", "type", msg.Type, "error", err)
	}
}

func boolPtr(b bool) *bool { return &b }
