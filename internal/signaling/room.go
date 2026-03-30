package signaling

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	maxEngineersPerRoom = 8
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
	conn        *websocket.Conn
	role        peerRole
	roomID      string
	roomCode    string
	permissions Permissions
	id          string      // unique peer id (only for engineers)
	writeMu     *sync.Mutex // shared with handler; serializes all conn writes
}

func (p *peer) sendJSON(msg Message) error {
	if p == nil || p.conn == nil {
		return nil
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.conn.WriteJSON(msg)
}

// Room represents a single signaling room owned by a sender.
type Room struct {
	ID           string
	Code         string
	Name         string
	Password     string
	Driver       *peer
	Engineers    map[string]*peer // peerId → peer
	DriverLostAt *time.Time       // set when driver disconnects; nil when connected
	UpdatedAt    time.Time
	mu           sync.Mutex
}

// RoomSummary is the public room-list payload for engineer clients.
type RoomSummary struct {
	RoomID           string `json:"roomId"`
	RoomCode         string `json:"roomCode"`
	RoomName         string `json:"roomName"`
	RequiresPassword bool   `json:"requiresPassword"`
	EngineerCount    int    `json:"engineerCount"`
}

// RoomManager manages all active rooms.
type RoomManager struct {
	roomsByCode     map[string]*Room // roomCode → Room
	roomsByID       map[string]*Room // roomId → Room
	permissionCodes *PermissionCodeStore
	mu              sync.RWMutex
	logger          *slog.Logger
	done            chan struct{}
}

// NewRoomManager creates a new RoomManager and starts a background cleanup goroutine.
func NewRoomManager(logger *slog.Logger, permissionCodes *PermissionCodeStore) *RoomManager {
	rm := &RoomManager{
		roomsByCode:     make(map[string]*Room),
		roomsByID:       make(map[string]*Room),
		permissionCodes: permissionCodes,
		logger:          logger,
		done:            make(chan struct{}),
	}
	go rm.cleanupLoop()
	return rm
}

// Stop terminates the cleanup goroutine.
func (rm *RoomManager) Stop() {
	close(rm.done)
}

// CreateRoom allocates a new room for the given driver connection.
// If requestedRoomID is set, it will be reused for room recreation.
func (rm *RoomManager) CreateRoom(driverConn *websocket.Conn, writeMu *sync.Mutex, requestedRoomID, roomName, password string) (string, string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	roomID := requestedRoomID
	if roomID == "" {
		roomID = generateRoomID()
	}
	code, err := rm.generateUniqueCodeLocked()
	if err != nil {
		return "", "", fmt.Errorf("generate room code: %w", err)
	}

	driverPeer := &peer{
		conn:     driverConn,
		role:     roleDriver,
		roomID:   roomID,
		roomCode: code,
		writeMu:  writeMu,
	}

	room, exists := rm.roomsByID[roomID]
	if !exists {
		room = &Room{
			ID:        roomID,
			Engineers: make(map[string]*peer),
		}
		rm.roomsByID[roomID] = room
	} else {
		delete(rm.roomsByCode, room.Code)
		if room.Driver != nil && room.Driver.conn != nil {
			room.Driver.conn.Close()
		}
	}

	room.Code = code
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.Driver = driverPeer
	room.DriverLostAt = nil
	room.UpdatedAt = time.Now()

	rm.roomsByCode[code] = room
	rm.logger.Info("room created", "roomId", roomID, "code", code, "name", room.Name)
	return roomID, code, nil
}

// JoinRoom adds an engineer to an existing room.
func (rm *RoomManager) JoinRoom(roomID, code, password, permissionsCode string, conn *websocket.Conn, writeMu *sync.Mutex) (string, string, Permissions, error) {
	rm.mu.RLock()
	room, ok := rm.lookupRoomLocked(roomID, code)
	rm.mu.RUnlock()
	if !ok {
		return "", "", Permissions{}, fmt.Errorf("room not found")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	if room.DriverLostAt != nil {
		return "", "", Permissions{}, fmt.Errorf("room %s is offline", room.Name)
	}
	if room.Password != "" && subtle.ConstantTimeCompare([]byte(room.Password), []byte(password)) != 1 {
		return "", "", Permissions{}, fmt.Errorf("invalid room password")
	}
	if len(room.Engineers) >= maxEngineersPerRoom {
		return "", "", Permissions{}, fmt.Errorf("room %s is full (max %d)", room.Name, maxEngineersPerRoom)
	}

	grantedPermissions := Permissions{}
	if strings.TrimSpace(permissionsCode) != "" {
		var ok bool
		var err error
		grantedPermissions, ok, err = rm.permissionCodes.Resolve(permissionsCode)
		if err != nil {
			return "", "", Permissions{}, fmt.Errorf("resolve permissions code: %w", err)
		}
		if !ok {
			return "", "", Permissions{}, fmt.Errorf("invalid permissions code")
		}
	}

	peerID := generatePeerID()
	engineerPeer := &peer{
		conn:        conn,
		role:        roleEngineer,
		roomID:      room.ID,
		roomCode:    room.Code,
		permissions: grantedPermissions,
		id:          peerID,
		writeMu:     writeMu,
	}
	room.Engineers[peerID] = engineerPeer
	room.UpdatedAt = time.Now()

	// Notify the driver only if connected.
	if room.DriverLostAt == nil {
		_ = room.Driver.sendJSON(Message{
			Type:        TypePeerJoined,
			PeerID:      peerID,
			Permissions: grantedPermissions,
		})
	}

	rm.logger.Info("engineer joined room", "roomId", room.ID, "code", room.Code, "peerId", peerID,
		"engineerCount", len(room.Engineers))
	return peerID, room.Code, grantedPermissions, nil
}

// RejoinRoom reconnects a driver to an existing room after a transient disconnect.
func (rm *RoomManager) RejoinRoom(roomID string, conn *websocket.Conn, writeMu *sync.Mutex, roomName, password string) (string, error) {
	rm.mu.RLock()
	room, ok := rm.roomsByID[roomID]
	rm.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("room %s not found", roomID)
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	// Close old driver connection if still open.
	if room.Driver != nil && room.Driver.conn != nil {
		room.Driver.conn.Close()
	}

	room.Driver = &peer{
		conn:     conn,
		role:     roleDriver,
		roomID:   room.ID,
		roomCode: room.Code,
		writeMu:  writeMu,
	}
	room.DriverLostAt = nil
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.UpdatedAt = time.Now()

	rm.logger.Info("driver rejoined room", "roomId", room.ID, "code", room.Code)
	return room.Code, nil
}

// UpdateRoomMetadata updates room list metadata for a connected sender.
func (rm *RoomManager) UpdateRoomMetadata(roomID, roomName, password string) (string, error) {
	rm.mu.RLock()
	room, ok := rm.roomsByID[roomID]
	rm.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("room %s not found", roomID)
	}

	room.mu.Lock()
	defer room.mu.Unlock()
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.UpdatedAt = time.Now()
	rm.logger.Info("room metadata updated", "roomId", room.ID, "code", room.Code, "name", room.Name)
	return room.Code, nil
}

// ListRooms returns active rooms visible to engineer clients.
func (rm *RoomManager) ListRooms() []RoomSummary {
	rm.mu.RLock()
	rooms := make([]*Room, 0, len(rm.roomsByID))
	for _, room := range rm.roomsByID {
		rooms = append(rooms, room)
	}
	rm.mu.RUnlock()

	result := make([]RoomSummary, 0, len(rooms))
	for _, room := range rooms {
		room.mu.Lock()
		driverConnected := room.DriverLostAt == nil && room.Driver != nil
		summary := RoomSummary{
			RoomID:           room.ID,
			RoomCode:         room.Code,
			RoomName:         room.Name,
			RequiresPassword: room.Password != "",
			EngineerCount:    len(room.Engineers),
		}
		room.mu.Unlock()
		if driverConnected {
			result = append(result, summary)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].RoomName == result[j].RoomName {
			return result[i].RoomCode < result[j].RoomCode
		}
		return result[i].RoomName < result[j].RoomName
	})
	return result
}

// Relay forwards an SDP or ICE message from one peer to the target peer within the same room.
func (rm *RoomManager) Relay(senderPeer *peer, msg Message) {
	rm.mu.RLock()
	room, ok := rm.roomsByID[senderPeer.roomID]
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
	if p.roomID == "" {
		return
	}

	rm.mu.Lock()
	room, ok := rm.roomsByID[p.roomID]
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
		room.UpdatedAt = now
		room.mu.Unlock()

		rm.logger.Info("driver disconnected, grace period started", "roomId", p.roomID, "code", p.roomCode)
		return
	}

	// Engineer left.
	rm.mu.Unlock()

	room.mu.Lock()
	delete(room.Engineers, p.id)
	engineerCount := len(room.Engineers)
	driverLost := room.DriverLostAt != nil
	room.UpdatedAt = time.Now()
	room.mu.Unlock()

	// Notify driver only if connected.
	if !driverLost {
		_ = room.Driver.sendJSON(Message{
			Type:   TypePeerLeft,
			PeerID: p.id,
		})
	}

	rm.logger.Info("engineer left room", "roomId", p.roomID, "code", p.roomCode, "peerId", p.id,
		"engineerCount", engineerCount)
}

// GetPeer returns the peer associated with a connection in a given room (used by handler).
func (rm *RoomManager) FindPeer(conn *websocket.Conn, roomID string) *peer {
	rm.mu.RLock()
	room, ok := rm.roomsByID[roomID]
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
	// Collect expired rooms under lock, then close connections outside lock
	// to avoid deadlock (conn.Close triggers ReadMessage error → RemovePeer → rm.mu).
	rm.mu.Lock()
	var expired []*Room
	for roomID, room := range rm.roomsByID {
		room.mu.Lock()
		driverGraceExpired := room.DriverLostAt != nil && time.Since(*room.DriverLostAt) > driverGracePeriod
		room.mu.Unlock()

		if driverGraceExpired {
			expired = append(expired, room)
			delete(rm.roomsByID, roomID)
			delete(rm.roomsByCode, room.Code)
		}
	}
	rm.mu.Unlock()

	for _, room := range expired {
		room.mu.Lock()
		if room.Driver != nil {
			_ = room.Driver.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			if room.Driver.conn != nil {
				room.Driver.conn.Close()
			}
		}
		for _, eng := range room.Engineers {
			_ = eng.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			if eng.conn != nil {
				eng.conn.Close()
			}
		}
		room.mu.Unlock()
		rm.logger.Info("room expired", "roomId", room.ID, "code", room.Code)
	}
}

// generateUniqueCodeLocked must be called with rm.mu held.
func (rm *RoomManager) generateUniqueCodeLocked() (string, error) {
	for attempt := 0; attempt < 100; attempt++ {
		code := generate4DigitCode()
		if _, exists := rm.roomsByCode[code]; !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("could not generate unique room code")
}

func (rm *RoomManager) lookupRoomLocked(roomID, roomCode string) (*Room, bool) {
	if roomID != "" {
		room, ok := rm.roomsByID[roomID]
		return room, ok
	}
	if roomCode != "" {
		room, ok := rm.roomsByCode[roomCode]
		return room, ok
	}
	return nil, false
}

func generate4DigitCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
	}
	return fmt.Sprintf("%04d", n.Int64())
}

func generateRoomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func generatePeerID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func normalizeRoomName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "Sender Room"
	}
	return trimmed
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
		roomID, code, err := rm.CreateRoom(conn, writeMu, msg.RoomID, msg.RoomName, msg.Password)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, roomID)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after room creation", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{Type: TypeRoomCreated, RoomID: roomID, RoomCode: code, RoomName: normalizeRoomName(msg.RoomName)})
		return p

	case TypeRoomRejoin:
		if msg.RoomID == "" {
			sendErrorRaw(conn, "roomId required", writeMu)
			return currentPeer
		}
		code, err := rm.RejoinRoom(msg.RoomID, conn, writeMu, msg.RoomName, msg.Password)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, msg.RoomID)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after rejoin", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{Type: TypeRoomCreated, RoomID: msg.RoomID, RoomCode: code, RoomName: normalizeRoomName(msg.RoomName)})
		return p

	case TypeRoomUpdate:
		if currentPeer == nil || currentPeer.role != roleDriver {
			sendErrorRaw(conn, "driver room update only", writeMu)
			return currentPeer
		}
		code, err := rm.UpdateRoomMetadata(currentPeer.roomID, msg.RoomName, msg.Password)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		_ = currentPeer.sendJSON(Message{
			Type:     TypeRoomUpdated,
			RoomID:   currentPeer.roomID,
			RoomCode: code,
			RoomName: normalizeRoomName(msg.RoomName),
		})
		return currentPeer

	case TypeRoomJoin:
		if msg.RoomID == "" && msg.RoomCode == "" {
			sendErrorRaw(conn, "roomId or roomCode required", writeMu)
			return currentPeer
		}
		peerID, roomCode, permissions, err := rm.JoinRoom(msg.RoomID, msg.RoomCode, msg.Password, msg.PermissionsCode, conn, writeMu)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		roomID := msg.RoomID
		if roomID == "" {
			rm.mu.RLock()
			room, ok := rm.roomsByCode[roomCode]
			rm.mu.RUnlock()
			if ok {
				roomID = room.ID
			}
		}
		p := rm.FindPeer(conn, roomID)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after join", writeMu)
			return currentPeer
		}
		_ = p.sendJSON(Message{
			Type:        TypeRoomJoined,
			PeerID:      peerID,
			RoomID:      roomID,
			RoomCode:    roomCode,
			Permissions: permissions,
		})
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
