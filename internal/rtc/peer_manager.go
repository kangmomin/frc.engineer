package rtc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"frc.engineer/internal/signaling"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

const maxBufferedAmount = 64 * 1024 // 64 KB — drop messages if receiver is slow

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

	peers    map[string]*webrtc.PeerConnection
	channels map[string]*webrtc.DataChannel
	mu       sync.RWMutex

	roomCode     string
	onRequest    RequestHandler
	onCountChange func(int) // called when engineer count changes
	logger       *slog.Logger
	done         chan struct{}
}

// NewPeerManager creates a PeerManager. Call Connect() to start.
func NewPeerManager(signalingURL string, logger *slog.Logger) *PeerManager {
	return &PeerManager{
		signalingURL: signalingURL,
		peers:        make(map[string]*webrtc.PeerConnection),
		channels:     make(map[string]*webrtc.DataChannel),
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

// RoomCode returns the current room code assigned by the signaling server.
func (pm *PeerManager) RoomCode() string { return pm.roomCode }

// Connect establishes a WebSocket connection to the signaling server and sends room_create.
func (pm *PeerManager) Connect() error {
	conn, _, err := websocket.DefaultDialer.Dial(pm.signalingURL, nil)
	if err != nil {
		return fmt.Errorf("signaling connect: %w", err)
	}
	pm.sigConn = conn

	// Send room_create
	create := signaling.Message{Type: signaling.TypeRoomCreate}
	if err := conn.WriteJSON(create); err != nil {
		conn.Close()
		return fmt.Errorf("send room_create: %w", err)
	}

	// Read room_created response
	var resp signaling.Message
	if err := conn.ReadJSON(&resp); err != nil {
		conn.Close()
		return fmt.Errorf("read room_created: %w", err)
	}
	if resp.Type == signaling.TypeError {
		conn.Close()
		return fmt.Errorf("signaling error: %s", resp.Error)
	}
	if resp.Type != signaling.TypeRoomCreated {
		conn.Close()
		return fmt.Errorf("unexpected message: %s", resp.Type)
	}

	pm.roomCode = resp.RoomCode
	pm.logger.Info("room created on signaling server", "roomCode", pm.roomCode)

	// Start reading signaling messages
	go pm.readSignalingLoop()
	return nil
}

// BroadcastAll sends a text message to all connected DataChannels.
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
		if err := ch.SendText(string(message)); err != nil {
			pm.logger.Debug("send failed", "peerId", peerID, "error", err)
		}
	}
}

// SendTo sends a message to a specific peer's DataChannel (unicast).
func (pm *PeerManager) SendTo(peerID string, message []byte) {
	pm.mu.RLock()
	ch, ok := pm.channels[peerID]
	pm.mu.RUnlock()
	if !ok || ch.ReadyState() != webrtc.DataChannelStateOpen {
		return
	}
	_ = ch.SendText(string(message))
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

// Close shuts down all peer connections and the signaling connection.
func (pm *PeerManager) Close() {
	close(pm.done)

	pm.mu.Lock()
	for id, pc := range pm.peers {
		pc.Close()
		delete(pm.peers, id)
		delete(pm.channels, id)
	}
	pm.mu.Unlock()

	pm.sigMu.Lock()
	if pm.sigConn != nil {
		pm.sigConn.Close()
	}
	pm.sigMu.Unlock()
}

func (pm *PeerManager) readSignalingLoop() {
	defer func() {
		pm.logger.Info("signaling connection closed")
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
			return
		case signaling.TypeError:
			pm.logger.Warn("signaling error", "error", msg.Error)
		}
	}
}

func (pm *PeerManager) onPeerJoined(peerID string) {
	pm.logger.Info("engineer joined, creating peer connection", "peerId", peerID)

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"}},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		pm.logger.Error("failed to create peer connection", "peerId", peerID, "error", err)
		return
	}

	// Create DataChannel
	dc, err := pc.CreateDataChannel("data", &webrtc.DataChannelInit{
		Ordered: boolPtr(true),
	})
	if err != nil {
		pm.logger.Error("failed to create data channel", "peerId", peerID, "error", err)
		pc.Close()
		return
	}

	pm.mu.Lock()
	pm.peers[peerID] = pc
	pm.channels[peerID] = dc
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
	if err := pm.sigConn.WriteJSON(msg); err != nil {
		pm.logger.Error("failed to send signaling message", "type", msg.Type, "error", err)
	}
}

func boolPtr(b bool) *bool { return &b }
