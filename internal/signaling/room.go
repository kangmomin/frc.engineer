package signaling

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"frc.engineer/internal/bandb"
	"frc.engineer/internal/banlist"
	"github.com/gorilla/websocket"
)

const (
	maxEngineersPerRoom = 8
	cleanupInterval     = 60 * time.Second
	driverGracePeriod   = 2 * time.Minute
	// maxRooms: 전역 동시 room 상한. 코드 공간(4자리=1만)보다 훨씬 낮게 잡아
	// 좀비/누수 방(H7)이 코드 고갈·메모리 폭주로 번지지 않게 방어한다.
	maxRooms = 2000
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
	roomID   string
	roomCode string
	id       string      // unique peer id (only for engineers)
	writeMu  *sync.Mutex // shared with handler; serializes all conn writes
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
	OwnerToken   string // H6: 소유권 증명 토큰 (room_created로 발급, rejoin/재사용 시 검증)
	Driver       *peer
	Engineers    map[string]*peer // peerId ??peer
	DriverLostAt *time.Time       // set when driver disconnects; nil when connected
	UpdatedAt    time.Time
	mu           sync.Mutex
}

// RoomSummary is the public room-list payload for engineer clients.
// NOTE(H6): RoomID here is only a join/selection handle for engineers — it is NOT
// an authorization basis. Driver ownership is proven solely by the OwnerToken
// (see CreateRoom/RejoinRoom), so exposing RoomID cannot enable room takeover.
type RoomSummary struct {
	RoomID           string `json:"roomId"`
	RoomCode         string `json:"roomCode"`
	RoomName         string `json:"roomName"`
	RequiresPassword bool   `json:"requiresPassword"`
	EngineerCount    int    `json:"engineerCount"`
}

// RoomManager manages all active rooms.
type RoomManager struct {
	roomsByCode    map[string]*Room // roomCode ??Room
	roomsByID      map[string]*Room // roomId ??Room
	banCache       *bandb.Cache     // nil이면 IP/닉 ban 비활성 (DATABASE_URL 미설정)
	banStore       bandb.Store      // nil이면 영구 등록 skip (캐시만)
	ipAttributable bool             // true(신뢰 프록시 설정)일 때만 IP 자동밴을 기록/캐시한다
	mu             sync.RWMutex
	logger         *slog.Logger
	done           chan struct{}
	ipBanWarnOnce  sync.Once // 귀속 불가로 IP밴을 건너뛸 때 경고를 1회만 로깅
	// legacyRejoinGrace: OwnerToken 필드 자체가 없던 v4.40 미만 sender의 하위호환.
	// 켜져 있으면 "빈 토큰 + 드라이버가 이미 끊긴 방"에 한해 rejoin/재사용을 허용한다
	// (활성 드라이버가 있는 방은 여전히 탈취 불가). LEGACY_REJOIN_GRACE=0 으로 비활성.
	// 구버전 fleet 이 모두 업데이트되면 꺼서 H6 를 온전히 강제하는 것을 권장.
	legacyRejoinGrace bool
}

// NewRoomManager creates a new RoomManager and starts a background cleanup goroutine.
// banCache/banStore may be nil to disable ban features (graceful degrade).
// ipAttributable gates IP auto-ban: only when the real client IP can be trusted
// (trusted proxies configured) does a banned nickname get its IP recorded. Without
// it the "client IP" is a shared edge-proxy address and recording it would 403 every
// user at the /ws gate, so IP auto-ban is skipped while the nickname ban still runs.
func NewRoomManager(logger *slog.Logger, banCache *bandb.Cache, banStore bandb.Store, ipAttributable bool) *RoomManager {
	rm := &RoomManager{
		roomsByCode:       make(map[string]*Room),
		roomsByID:         make(map[string]*Room),
		banCache:          banCache,
		banStore:          banStore,
		ipAttributable:    ipAttributable,
		logger:            logger,
		done:              make(chan struct{}),
		legacyRejoinGrace: os.Getenv("LEGACY_REJOIN_GRACE") != "0", // 기본 켜짐
	}
	go rm.cleanupLoop()
	return rm
}

// checkAndBanNickname reports whether playerName is on the banned-nickname list.
// When it matches, the connection is always dropped (nickname ban). The client IP is
// additionally recorded as banned (cache immediately for instant effect, DB async) so
// later connections from that IP are blocked even after a nickname change — but ONLY
// when ipAttributable is true. Without trusted proxies the "client IP" is a shared
// edge-proxy address; recording it would 403 every user at the /ws gate, so IP
// auto-ban is skipped (warned once). No-op when ban features are disabled or IP unknown.
func (rm *RoomManager) checkAndBanNickname(clientIP, playerName string) bool {
	if rm.banCache == nil || clientIP == "" {
		return false
	}
	// Already banned (e.g. repeated messages on the same connection): skip the
	// nickname match and the duplicate async DB write.
	if rm.banCache.HasIP(clientIP) {
		return true
	}
	norm := banlist.Normalize(playerName)
	if norm == "" || !rm.banCache.HasNick(norm) {
		return false
	}
	// 밴된 닉 확인 → 연결 차단(닉네임 밴)은 항상 수행한다. 다만 IP 자동 밴(기록/캐시)은
	// 실제 클라 IP를 신뢰 가능하게 귀속할 수 있을 때만 한다. 신뢰 프록시 미설정 시 clientIP는
	// 공유 엣지 프록시 IP라, 이를 기록하면 이후 전원이 /ws HasIP 게이트에서 차단된다.
	if !rm.ipAttributable {
		rm.ipBanWarnOnce.Do(func() {
			rm.logger.Warn("IP auto-ban skipped: client IP not attributable (set TRUSTED_PROXY_CIDRS to enable); nickname ban still enforced")
		})
		return true
	}
	rm.banCache.AddIP(clientIP) // immediate: next connection from this IP is blocked
	if rm.banStore != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := rm.banStore.AddIP(ctx, clientIP, norm, "banned-nickname"); err != nil {
				rm.logger.Warn("failed to persist auto-banned IP", "ip", clientIP, "error", err)
			}
		}()
	}
	rm.logger.Info("auto-banned IP for banned nickname", "ip", clientIP, "nickname", norm)
	return true
}

// Stop terminates the cleanup goroutine.
func (rm *RoomManager) Stop() {
	close(rm.done)
}

// CreateRoom allocates a new room for the given driver connection.
// If requestedRoomID is set, it will be reused for room recreation — but reuse
// requires a matching OwnerToken (H6), otherwise a fresh room is allocated.
// Returns (roomID, roomCode, ownerToken, error).
func (rm *RoomManager) CreateRoom(driverConn *websocket.Conn, writeMu *sync.Mutex, requestedRoomID, roomName, password, ownerToken string) (string, string, string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	roomID := requestedRoomID
	if roomID == "" {
		roomID = generateRoomID()
	}

	room, exists := rm.roomsByID[roomID]
	if exists {
		// H6: 기존 room 재사용은 소유권 증명(OwnerToken)이 필수. 없거나 불일치면
		// 탈취 시도로 간주하고 새 random ID로 신규 room을 배정한다(재사용 거부).
		reuseOK := ownerToken != "" && subtle.ConstantTimeCompare([]byte(room.OwnerToken), []byte(ownerToken)) == 1
		if !reuseOK && rm.legacyRejoinGrace && ownerToken == "" {
			// v4.40 미만 sender 의 rejoin 실패 후 create-fallback 경로: 드라이버가
			// 이미 끊긴 방에 한해 재사용을 허용해 접속 중인 엔지니어 세션을 보존한다
			// (RejoinRoom 의 legacy grace 와 동일 조건). 잘못된(비어 있지 않은)
			// 토큰은 grace 대상이 아니다.
			room.mu.Lock()
			driverLost := room.Driver == nil || room.DriverLostAt != nil
			room.mu.Unlock()
			if driverLost {
				reuseOK = true
				rm.logger.Warn("legacy token-less room reuse honored (grace)", "roomId", roomID)
			}
		}
		if !reuseOK {
			rm.logger.Warn("room reuse denied: owner token mismatch, allocating new room", "roomId", roomID)
			roomID = generateRoomID()
			room, exists = rm.roomsByID[roomID]
		}
	}

	// H7: 신규 room 생성 시에만 전역 상한을 검사(재사용/재접속은 통과).
	if !exists && len(rm.roomsByID) >= maxRooms {
		return "", "", "", fmt.Errorf("server room capacity reached")
	}

	code, err := rm.generateUniqueCodeLocked()
	if err != nil {
		return "", "", "", fmt.Errorf("generate room code: %w", err)
	}

	driverPeer := &peer{
		conn:     driverConn,
		role:     roleDriver,
		roomID:   roomID,
		roomCode: code,
		writeMu:  writeMu,
	}

	if !exists {
		room = &Room{
			ID:         roomID,
			Engineers:  make(map[string]*peer),
			OwnerToken: generateOwnerToken(),
		}
		rm.roomsByID[roomID] = room
	}

	// L9: room 필드 변경은 room.mu 하에서 수행한다 — 다른 goroutine이 선행 lookup
	// 후 room.mu를 잡고 Driver 등을 읽을 수 있어서다. 구 conn 종료는 언락 후.
	var oldConn *websocket.Conn
	room.mu.Lock()
	if exists {
		delete(rm.roomsByCode, room.Code)
		if room.Driver != nil && room.Driver.conn != nil {
			oldConn = room.Driver.conn
		}
	}
	room.Code = code
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.Driver = driverPeer
	room.DriverLostAt = nil
	room.UpdatedAt = time.Now()
	resolvedToken := room.OwnerToken
	loggedName := room.Name
	room.mu.Unlock()

	rm.roomsByCode[code] = room

	if oldConn != nil {
		_ = oldConn.Close()
	}

	rm.logger.Info("room created", "roomId", roomID, "code", code, "name", loggedName)
	return roomID, code, resolvedToken, nil
}

// JoinRoom adds an engineer to an existing room.
func (rm *RoomManager) JoinRoom(roomID, code, password string, conn *websocket.Conn, writeMu *sync.Mutex) (string, string, error) {
	rm.mu.RLock()
	room, ok := rm.lookupRoomLocked(roomID, code)
	rm.mu.RUnlock()
	if !ok {
		return "", "", fmt.Errorf("room not found")
	}

	peerID := generatePeerID()
	engineerPeer := &peer{
		conn:     conn,
		role:     roleEngineer,
		roomID:   room.ID,
		roomCode: room.Code,
		id:       peerID,
		writeMu:  writeMu,
	}

	var driverToNotify *peer
	var roomCode string
	var engineerCount int
	var roomName string

	room.mu.Lock()
	if room.DriverLostAt != nil {
		room.mu.Unlock()
		return "", "", fmt.Errorf("room %s is offline", room.Name)
	}
	if room.Password != "" && subtle.ConstantTimeCompare([]byte(room.Password), []byte(password)) != 1 {
		room.mu.Unlock()
		return "", "", fmt.Errorf("invalid room password")
	}
	if len(room.Engineers) >= maxEngineersPerRoom {
		room.mu.Unlock()
		return "", "", fmt.Errorf("room %s is full (max %d)", room.Name, maxEngineersPerRoom)
	}
	room.Engineers[peerID] = engineerPeer
	room.UpdatedAt = time.Now()
	driverToNotify = room.Driver
	roomCode = room.Code
	engineerCount = len(room.Engineers)
	roomName = room.Name
	room.mu.Unlock()

	if driverToNotify != nil {
		if err := driverToNotify.sendJSON(Message{
			Type:   TypePeerJoined,
			PeerID: peerID,
		}); err != nil {
			room.mu.Lock()
			delete(room.Engineers, peerID)
			now := time.Now()
			if room.Driver == driverToNotify && room.DriverLostAt == nil {
				room.DriverLostAt = &now
			}
			room.UpdatedAt = now
			engineerCount = len(room.Engineers)
			room.mu.Unlock()

			if driverToNotify.conn != nil {
				_ = driverToNotify.conn.Close()
			}
			rm.logger.Warn("failed to notify driver about engineer join", "roomId", room.ID, "code", room.Code, "peerId", peerID, "engineerCount", engineerCount, "error", err)
			return "", "", fmt.Errorf("room %s is offline", roomName)
		}
	}

	rm.logger.Info("engineer joined room", "roomId", room.ID, "code", room.Code, "peerId", peerID,
		"engineerCount", engineerCount)
	return peerID, roomCode, nil
}

// RebindEngineer reattaches a new WebSocket connection to an existing engineer
// session after a transient signaling drop. The live P2P link is untouched and
// the driver is intentionally NOT notified (no peer_joined) — the engineer keeps
// its peerID. Returns an error when the session is unknown, so the caller can
// fall back to a fresh JoinRoom.
func (rm *RoomManager) RebindEngineer(roomID, code, peerID, password string, conn *websocket.Conn, writeMu *sync.Mutex) (string, string, error) {
	rm.mu.RLock()
	room, ok := rm.lookupRoomLocked(roomID, code)
	rm.mu.RUnlock()
	if !ok {
		return "", "", fmt.Errorf("room not found")
	}

	var oldConn *websocket.Conn

	room.mu.Lock()
	if room.Password != "" && subtle.ConstantTimeCompare([]byte(room.Password), []byte(password)) != 1 {
		room.mu.Unlock()
		return "", "", fmt.Errorf("invalid room password")
	}
	eng, ok := room.Engineers[peerID]
	if !ok {
		room.mu.Unlock()
		return "", "", fmt.Errorf("engineer session not found")
	}
	oldConn = eng.conn
	// 새 peer 구조체로 교체한다. 구 핸들러의 RemovePeer가 포인터 정체성 가드에
	// 걸려 재바인딩된 세션을 지우지 못하게 하기 위함.
	room.Engineers[peerID] = &peer{
		conn:     conn,
		role:     roleEngineer,
		roomID:   room.ID,
		roomCode: room.Code,
		id:       peerID,
		writeMu:  writeMu,
	}
	room.UpdatedAt = time.Now()
	resolvedRoomID := room.ID
	resolvedCode := room.Code
	room.mu.Unlock()

	if oldConn != nil && oldConn != conn {
		_ = oldConn.Close()
	}

	rm.logger.Info("engineer rebound to room", "roomId", resolvedRoomID, "code", resolvedCode, "peerId", peerID)
	return resolvedRoomID, resolvedCode, nil
}

// RejoinRoom reconnects a driver to an existing room after a transient disconnect.
// Reuse requires a matching OwnerToken (H6) so a party that merely knows the
// roomId cannot seize the room; a normal driver echoes the token it received in
// room_created and keeps working across network blips.
func (rm *RoomManager) RejoinRoom(roomID, ownerToken string, conn *websocket.Conn, writeMu *sync.Mutex, roomName, password string) (string, error) {
	rm.mu.RLock()
	room, ok := rm.roomsByID[roomID]
	rm.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("room %s not found", roomID)
	}

	var oldConn *websocket.Conn
	existingEngineers := make([]*peer, 0)

	room.mu.Lock()
	// H6: 소유권 증명 없이/불일치 시 재접속(탈취) 거부. 예외(legacyRejoinGrace):
	// OwnerToken 필드가 없던 v4.40 미만 sender 는 "빈 토큰 + 드라이버가 이미 끊긴
	// 방"에 한해 재접속을 허용한다 — 활성 드라이버가 있는 방은 여전히 탈취 불가,
	// 잘못된(비어 있지 않은) 토큰은 항상 거부.
	tokenOK := ownerToken != "" && subtle.ConstantTimeCompare([]byte(room.OwnerToken), []byte(ownerToken)) == 1
	if !tokenOK {
		legacyOK := rm.legacyRejoinGrace && ownerToken == "" &&
			(room.Driver == nil || room.DriverLostAt != nil)
		if !legacyOK {
			room.mu.Unlock()
			return "", fmt.Errorf("room %s ownership verification failed", roomID)
		}
		rm.logger.Warn("legacy token-less driver rejoin honored (grace)", "roomId", roomID)
	}
	if room.Driver != nil && room.Driver.conn != nil {
		oldConn = room.Driver.conn
	}

	// L9: 재생 루프에서 room.Driver를 언락 후 직접 읽으면 CreateRoom/RejoinRoom과
	// 레이스가 난다. 락 보유 중 로컬(newDriver)로 캡처해 언락 후 사용한다.
	newDriver := &peer{
		conn:     conn,
		role:     roleDriver,
		roomID:   room.ID,
		roomCode: room.Code,
		writeMu:  writeMu,
	}
	room.Driver = newDriver
	room.DriverLostAt = nil
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.UpdatedAt = time.Now()
	roomCode := room.Code
	for _, eng := range room.Engineers {
		existingEngineers = append(existingEngineers, eng)
	}
	room.mu.Unlock()

	if oldConn != nil {
		_ = oldConn.Close()
	}

	for _, eng := range existingEngineers {
		if eng == nil {
			continue
		}
		if err := newDriver.sendJSON(Message{
			Type:   TypePeerJoined,
			PeerID: eng.id,
		}); err != nil {
			rm.logger.Warn("failed to replay engineer join to reconnected driver", "roomId", room.ID, "code", roomCode, "peerId", eng.id, "error", err)
			break
		}
	}

	rm.logger.Info("driver rejoined room", "roomId", room.ID, "code", roomCode)
	return roomCode, nil
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

	var target *peer

	room.mu.Lock()
	switch senderPeer.role {
	case roleDriver:
		// Driver forwards to a specific engineer.
		if eng, ok := room.Engineers[msg.PeerID]; ok {
			target = eng
		}
	case roleEngineer:
		// Drop if driver is temporarily disconnected.
		if room.DriverLostAt != nil {
			room.mu.Unlock()
			return
		}
		// Engineer forwards to driver.
		msg.PeerID = senderPeer.id
		target = room.Driver
	}
	room.mu.Unlock()

	if target != nil {
		_ = target.sendJSON(msg)
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
		// 포인터 정체성 가드: rejoin으로 이미 새 peer가 바인딩됐다면 구 연결의
		// read 에러가 살아있는 room을 offline으로 마킹(→2분 뒤 만료)하면 안 된다.
		if room.Driver != p {
			room.mu.Unlock()
			rm.logger.Info("ignoring stale driver disconnect after rejoin", "roomId", p.roomID, "code", p.roomCode)
			return
		}
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
	// 재바인딩된 세션 보호: 다른 peer 구조체가 이미 등록돼 있으면 건드리지 않는다.
	if existing, ok := room.Engineers[p.id]; !ok || existing != p {
		room.mu.Unlock()
		rm.logger.Info("ignoring stale engineer disconnect after rebind", "roomId", p.roomID, "peerId", p.id)
		return
	}
	delete(room.Engineers, p.id)
	engineerCount := len(room.Engineers)
	driverLost := room.DriverLostAt != nil
	// L9: 언락 후 room.Driver를 직접 읽으면 CreateRoom/RejoinRoom과 레이스 —
	// 락 보유 중 로컬로 캡처해 사용한다(JoinRoom의 driverToNotify 패턴).
	driver := room.Driver
	room.UpdatedAt = time.Now()
	room.mu.Unlock()

	// Notify driver only if connected.
	if !driverLost && driver != nil {
		_ = driver.sendJSON(Message{
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
	// to avoid deadlock (conn.Close triggers ReadMessage error -> RemovePeer -> rm.mu).
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
		var driver *peer
		engineers := make([]*peer, 0, len(room.Engineers))

		room.mu.Lock()
		driver = room.Driver
		for _, eng := range room.Engineers {
			engineers = append(engineers, eng)
		}
		room.mu.Unlock()

		if driver != nil {
			_ = driver.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			if driver.conn != nil {
				_ = driver.conn.Close()
			}
		}
		for _, eng := range engineers {
			_ = eng.sendJSON(Message{Type: TypeRoomClosed, Error: "room expired"})
			if eng.conn != nil {
				_ = eng.conn.Close()
			}
		}
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

// randomHexToken returns nBytes of crypto/rand encoded as a lowercase hex string.
// A rand.Read error is intentionally ignored (preserving prior call-site behavior):
// the buffer stays zero-valued rather than failing token generation.
func randomHexToken(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func generateRoomID() string {
	return randomHexToken(8)
}

// generateOwnerToken returns a 32-hex (16-byte) room ownership token from crypto/rand.
func generateOwnerToken() string {
	return randomHexToken(16)
}

func generatePeerID() string {
	return randomHexToken(4)
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
func (rm *RoomManager) HandleMessageExported(conn *websocket.Conn, raw []byte, ep *ExportedPeer, writeMu *sync.Mutex, clientIP string) *ExportedPeer {
	var cp *peer
	if ep != nil {
		cp = ep.p
	}
	result := rm.HandleMessage(conn, raw, cp, writeMu, clientIP)
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
func (rm *RoomManager) HandleMessage(conn *websocket.Conn, raw []byte, currentPeer *peer, writeMu *sync.Mutex, clientIP string) *peer {
	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		sendErrorRaw(conn, "invalid JSON", writeMu)
		return currentPeer
	}

	// IP auto-ban: any message reporting a banned nickname records the client IP
	// and drops the connection (rejected at upgrade on the next attempt).
	if rm.checkAndBanNickname(clientIP, msg.PlayerName) {
		sendErrorRaw(conn, "banned", writeMu)
		_ = conn.Close()
		return currentPeer
	}

	switch msg.Type {
	case TypeRoomCreate:
		roomID, code, ownerToken, err := rm.CreateRoom(conn, writeMu, msg.RoomID, msg.RoomName, msg.Password, msg.OwnerToken)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, roomID)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after room creation", writeMu)
			return currentPeer
		}
		// H7: 새 room 확정 후 이전 peer를 정리해 고아 room 누수를 막는다
		// (같은 room 재사용이면 포인터 정체성 가드로 무해한 no-op).
		if currentPeer != nil && currentPeer != p {
			rm.RemovePeer(currentPeer)
		}
		_ = p.sendJSON(Message{Type: TypeRoomCreated, RoomID: roomID, RoomCode: code, RoomName: normalizeRoomName(msg.RoomName), OwnerToken: ownerToken})
		return p

	case TypeRoomRejoin:
		if msg.RoomID == "" {
			sendErrorRaw(conn, "roomId required", writeMu)
			return currentPeer
		}
		code, err := rm.RejoinRoom(msg.RoomID, msg.OwnerToken, conn, writeMu, msg.RoomName, msg.Password)
		if err != nil {
			sendErrorRaw(conn, err.Error(), writeMu)
			return currentPeer
		}
		p := rm.FindPeer(conn, msg.RoomID)
		if p == nil {
			sendErrorRaw(conn, "internal error: peer not found after rejoin", writeMu)
			return currentPeer
		}
		// H7: 새 세션 확정 후 이전 peer 정리 (같은 room 재접속이면 정체성 가드로 무해).
		if currentPeer != nil && currentPeer != p {
			rm.RemovePeer(currentPeer)
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
		// peerId가 있으면 시그널링 재바인딩 시도: 살아있는 P2P를 유지한 채
		// WebSocket만 교체한다 (driver에게 peer_joined를 보내지 않음).
		// 실패하면 일반 join으로 폴백해 새 peerID를 발급한다.
		if msg.PeerID != "" {
			roomID, roomCode, err := rm.RebindEngineer(msg.RoomID, msg.RoomCode, msg.PeerID, msg.Password, conn, writeMu)
			if err == nil {
				p := rm.FindPeer(conn, roomID)
				if p == nil {
					sendErrorRaw(conn, "internal error: peer not found after rebind", writeMu)
					return currentPeer
				}
				// H7: 새 세션 확정 후 이전 peer 정리 (고아 room 방지).
				if currentPeer != nil && currentPeer != p {
					rm.RemovePeer(currentPeer)
				}
				_ = p.sendJSON(Message{
					Type:     TypeRoomJoined,
					PeerID:   msg.PeerID,
					RoomID:   roomID,
					RoomCode: roomCode,
				})
				return p
			}
			rm.logger.Info("engineer rebind failed, falling back to fresh join", "peerId", msg.PeerID, "error", err)
		}
		peerID, roomCode, err := rm.JoinRoom(msg.RoomID, msg.RoomCode, msg.Password, conn, writeMu)
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
		// H7: 새 세션 확정 후 이전 peer 정리 (고아 room 방지).
		if currentPeer != nil && currentPeer != p {
			rm.RemovePeer(currentPeer)
		}
		_ = p.sendJSON(Message{
			Type:     TypeRoomJoined,
			PeerID:   peerID,
			RoomID:   roomID,
			RoomCode: roomCode,
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
