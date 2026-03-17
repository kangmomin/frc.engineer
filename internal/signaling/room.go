package signaling

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxEngineersPerRoom = 8
	roomTTL             = 1 * time.Hour
	cleanupInterval     = 60 * time.Second
	driverGracePeriod   = 2 * time.Minute
)

// peerRole distinguishes the sender (driver) from receivers (engineers).
type peerRole int

const (
	roleDriver peerRole = iota
	roleEngineer
)

// peer wraps a WebSocket connection with its role and room association.
type peer struct {
	conn     *websocket.Conn
	role     peerRole
	roomCode string
	id       string      // unique peer id (only for engineers)
	writeMu  *sync.Mutex // shared with handler; serializes all conn writes
}

func (p *peer) sendJSON(msg Message) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.conn.WriteJSON(msg)
}

// Room represents a single signaling room owned by a sender.
type Room struct {
	Code         string
	Driver       *peer
	Engineers    map[string]*peer // peerId → peer
	CreatedAt    time.Time
	DriverLostAt *time.Time // set when driver disconnects; nil when connected
	mu           sync.Mutex
}

// RoomManager manages all active rooms.
type RoomManager struct {
	rooms  map[string]*Room // roomCode → Room
	mu     sync.RWMutex
	logger *slog.Logger
	done   chan struct{}
}

// NewRoomManager creates a new RoomManager and starts a background cleanup goroutine.
func NewRoomManager(logger *slog.Logger) *RoomManager {
	rm := &RoomManager{
		rooms:  make(map[string]*Room),
		logger: logger,
		done:   make(chan struct{}),
	}
	go rm.cleanupLoop()
	return rm
}

// Stop terminates the cleanup goroutine.
func (rm *RoomManager) Stop() {
	close(rm.done)
}

// CreateRoom allocates a new room for the given driver connection.
// Code generation and insertion are atomic to prevent TOCTOU races.
func (rm *RoomManager) CreateRoom(driverConn *websocket.Conn, writeMu *sync.Mutex) (string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	code, err := rm.generateUniqueCodeLocked()
	if err != nil {
		return "", fmt.Errorf("generate room code: %w", err)
	}

	driverPeer := &peer{
		conn:     driverConn,
		role:     roleDriver,
		roomCode: code,
		writeMu:  writeMu,
	}

	room := &Room{
		Code:      code,
		Driver:    driverPeer,
		Engineers: make(map[string]*peer),
		CreatedAt: time.Now(),
	}

	rm.rooms[code] = room
	rm.logger.Info("room created", "code", code)
	return code, nil
}

// JoinRoom adds an engineer to an existing room.
func (rm *RoomManager) JoinRoom(code string, conn *websocket.Conn, writeMu *sync.Mutex) (string, error) {
	rm.mu.RLock()
	room, ok := rm.rooms[code]
	rm.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("room %s not found", code)
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	if len(room.Engineers) >= maxEngineersPerRoom {
		return "", fmt.Errorf("room %s is full (max %d)", code, maxEngineersPerRoom)
	}

	peerID := generatePeerID()
	engineerPeer := &peer{
		conn:     conn,
		role:     roleEngineer,
		roomCode: code,
		id:       peerID,
		writeMu:  writeMu,
	}
	room.Engineers[peerID] = engineerPeer

	// Notify the driver only if connected.
	if room.DriverLostAt == nil {
		_ = room.Driver.sendJSON(Message{
			Type:   TypePeerJoined,
			PeerID: peerID,
		})
	}

	rm.logger.Info("engineer joined room", "code", code, "peerId", peerID,
		"engineerCount", len(room.Engineers))
	return peerID, nil
}

// RejoinRoom reconnects a driver to an existing room after a transient disconnect.
func (rm *RoomManager) RejoinRoom(code string, conn *websocket.Conn, writeMu *sync.Mutex) error {
	rm.mu.RLock()
	room, ok := rm.rooms[code]
	rm.mu.RUnlock()
	if !ok {
		return fmt.Errorf("room %s not found", code)
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	// Close old driver connection if still open.
	if room.Driver != nil {
		room.Driver.conn.Close()
	}

	room.Driver = &peer{
		conn:     conn,
		role:     roleDriver,
		roomCode: code,
		writeMu:  writeMu,
	}
	room.DriverLostAt = nil

	rm.logger.Info("driver rejoined room", "code", code)
	return nil
}

// Relay forwards an SDP or ICE message from one peer to the target peer within the same room.
func (rm *RoomManager) Relay(senderPeer *peer, msg Message) {
	rm.mu.RLock()
	room, ok := rm.rooms[senderPeer.roomCode]
	rm.mu.RUnlock()
	if !ok {
		return
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	switch senderPeer.role {
	case roleDriver:
		// Driver → specific engineer
		if eng, ok := room.Engineers[msg.PeerID]; ok {
			_ = eng.sendJSON(msg)
		}
	case roleEngineer:
		// Drop if driver is temporarily disconnected.
		if room.DriverLostAt != nil {
			return
		}
		// Engineer → driver
		msg.PeerID = senderPeer.id
		_ = room.Driver.sendJSON(msg)
	}
}

// RemovePeer removes a peer from their room and handles cleanup.
func (rm *RoomManager) RemovePeer(p *peer) {
	if p.roomCode == "" {
		return
	}

	rm.mu.Lock()
	room, ok := rm.rooms[p.roomCode]
	if !ok {
		rm.mu.Unlock()
		return
	}

	if p.role == roleDriver {
		// Grace period: keep room alive for driver reconnection.
		rm.mu.Unlock()

		room.mu.Lock()
		now := time.Now()
		room.DriverLostAt = &now
		room.mu.Unlock()

		rm.logger.Info("driver disconnected, grace period started", "code", p.roomCode)
		return
	}

	// Engineer left.
	rm.mu.Unlock()

	room.mu.Lock()
	delete(room.Engineers, p.id)
	engineerCount := len(room.Engineers)
	driverLost := room.DriverLostAt != nil
	room.mu.Unlock()

	// Notify driver only if connected.
	if !driverLost {
		_ = room.Driver.sendJSON(Message{
			Type:   TypePeerLeft,
			PeerID: p.id,
		})
	}

	rm.logger.Info("engineer left room", "code", p.roomCode, "peerId", p.id,
		"engineerCount", engineerCount)
}

// GetPeer returns the peer associated with a connection in a given room (used by handler).
func (rm *RoomManager) FindPeer(conn *websocket.Conn, code string) *peer {
	rm.mu.RLock()
	room, ok := rm.rooms[code]
	rm.mu.RUnlock()
	if !ok {
		return nil
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	if room.Driver != nil && room.Driver.conn == conn {
		return room.Driver
	}
	for _, eng := range room.Engineers {
		if eng.conn == conn {
			return eng
		}
	}
	return nil
}

func (rm *RoomManager) cleanupLoop() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-rm.done:
			return
		case <-ticker.C:
			rm.cleanupExpired()
		}
	}
}

func (rm *RoomManager) cleanupExpired() {
	now := time.Now()

	// Collect expired rooms under lock, then close connections outside lock
	// to avoid deadlock (conn.Close triggers ReadMessage error → RemovePeer → rm.mu).
	rm.mu.Lock()
	var expired []*Room
	for code, room := range rm.rooms {
		room.mu.Lock()
		ttlExpired := now.Sub(room.CreatedAt) > roomTTL
		driverGraceExpired := room.DriverLostAt != nil && now.Sub(*room.DriverLostAt) > driverGracePeriod
		room.mu.Unlock()

		if ttlExpired || driverGraceExpired {
			expired = append(expired, room)
			delete(rm.rooms, code)
		}
	}
	rm.mu.Unlock()

	for _, room := range expired {
		room.mu.Lock()
		if room.Driver != nil {
			_ = room.Driver.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			room.Driver.conn.Close()
		}
		for _, eng := range room.Engineers {
			_ = eng.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			eng.conn.Close()
		}
		room.mu.Unlock()
		rm.logger.Info("room expired", "code", room.Code)
	}
}

// generateUniqueCodeLocked must be called with rm.mu held.
func (rm *RoomManager) generateUniqueCodeLocked() (string, error) {
	for attempt := 0; attempt < 100; attempt++ {
		code := generate4DigitCode()
		if _, exists := rm.rooms[code]; !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("could not generate unique room code")
}

func generate4DigitCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
	}
	return fmt.Sprintf("%04d", n.Int64())
}

func generatePeerID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// ExportedPeer is an opaque handle to an internal peer, used by cmd/signaling.
type ExportedPeer struct {
	p *peer
}

// HandleMessageExported wraps HandleMessage for use from external packages.
func (rm *RoomManager) HandleMessageExported(conn *websocket.Conn, raw []byte, ep *ExportedPeer, writeMu *sync.Mutex) *ExportedPeer {
	var cp *peer
	if ep != nil {
		cp = ep.p
	}
	result := rm.HandleMessage(conn, raw, cp, writeMu)
	if result == nil {
		return nil
	}
	if ep != nil && result == cp {
		return ep
	}
	return &ExportedPeer{p: result}
}

// RemoveExportedPeer wraps RemovePeer for use from external packages.
func (rm *RoomManager) RemoveExportedPeer(ep *ExportedPeer) {
	if ep != nil && ep.p != nil {
		rm.RemovePeer(ep.p)
	}
}

// HandleMessage processes an incoming signaling message from a WebSocket connection.
func (rm *RoomManager) HandleMessage(conn *websocket.Conn, raw []byte, currentPeer *peer, writeMu *sync.Mutex) *peer {
	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		sendErrorRaw(conn, "invalid JSON", writeMu)
		return currentPeer
	}

	switch msg.Type {
	case TypeRoomCreate:
		code, err := rm.CreateRoom(conn, writeMu)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, code)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after room creation", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{Type: TypeRoomCreated, RoomCode: code})
		return p

	case TypeRoomRejoin:
		if msg.RoomCode == "" {
			sendErrorRaw(conn, "roomCode required", writeMu)
			return currentPeer
		}
		err := rm.RejoinRoom(msg.RoomCode, conn, writeMu)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, msg.RoomCode)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after rejoin", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{Type: TypeRoomCreated, RoomCode: msg.RoomCode})
		return p

	case TypeRoomJoin:
		if msg.RoomCode == "" {
			sendErrorRaw(conn, "roomCode required", writeMu)
			return currentPeer
		}
		peerID, err := rm.JoinRoom(msg.RoomCode, conn, writeMu)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, msg.RoomCode)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after join", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{Type: TypeRoomJoined, PeerID: peerID, RoomCode: msg.RoomCode})
		return p

	case TypeHeartbeat:
		// Echo heartbeat back as application-level keepalive.
		writeMu.Lock()
		_ = conn.WriteJSON(Message{Type: TypeHeartbeat})
		writeMu.Unlock()

	case TypeOffer, TypeAnswer, TypeICECandidate:
		if currentPeer == nil {
			sendErrorRaw(conn, "not in a room", writeMu)
			return currentPeer
		}
		rm.Relay(currentPeer, msg)

	default:
		sendErrorRaw(conn, "unknown message type: "+msg.Type, writeMu)
	}

	return currentPeer
}

// sendErrorRaw sends an error message on a raw connection (before peer is established).
// Uses writeMu to serialize with the ping goroutine.
func sendErrorRaw(conn *websocket.Conn, errMsg string, writeMu *sync.Mutex) {
	msg := Message{Type: TypeError, Error: errMsg}
	data, _ := json.Marshal(msg)
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = conn.WriteMessage(websocket.TextMessage, data)
}
