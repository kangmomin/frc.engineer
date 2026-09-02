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
	"sync/atomic"
	"time"
	"unicode/utf8"

	"frc.engineer/internal/bandb"
	"frc.engineer/internal/banlist"
	"frc.engineer/internal/realtimesfu"
	"frc.engineer/internal/turncredentials"
	"github.com/gorilla/websocket"
)

const (
	maxEngineersPerRoom   = 8
	cleanupInterval       = 60 * time.Second
	driverGracePeriod     = 2 * time.Minute
	turnFailureCooldown   = 30 * time.Second
	turnProviderTimeout   = 3 * time.Second
	maxTurnRequestIDBytes = 128
	signalingWriteWait    = 10 * time.Second
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
	conn                    *websocket.Conn
	role                    peerRole
	roomID                  string
	roomCode                string
	id                      string      // unique peer id (only for engineers)
	writeMu                 *sync.Mutex // shared with handler; serializes all conn writes
	inactive                atomic.Bool // set before a rebind/rejoin replacement becomes current
	intercomOnce            sync.Once
	intercomStopOnce        sync.Once
	intercomQueue           chan func()
	intercomProvider        chan func()
	intercomStop            chan struct{}
	intercomOrderMu         sync.Mutex
	intercomTail            chan struct{}
	intercomMembershipEpoch atomic.Uint64
}

// turnCredentialState is isolated per authenticated room participant. A
// driver may reuse its state across a room rejoin, and an engineer may reuse
// it across a signaling-only rebind, but different participants never share a
// short-lived TURN username/credential.
type turnCredentialState struct {
	credentials  *turncredentials.Credentials
	refreshAfter time.Time
	inFlight     bool
	wait         chan struct{}
	failureUntil time.Time
}

func (p *peer) sendJSON(msg Message) error {
	if p == nil || p.conn == nil || p.writeMu == nil {
		return fmt.Errorf("signaling peer unavailable")
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.writeJSONLocked(msg)
}

func (p *peer) writeJSONLocked(msg Message) error {
	if p.inactive.Load() {
		return fmt.Errorf("signaling peer is no longer current")
	}
	p.conn.SetWriteDeadline(time.Now().Add(signalingWriteWait))
	return p.conn.WriteJSON(msg)
}

func (p *peer) dispatchIntercom(task func()) bool {
	p.ensureIntercomDispatch()
	p.intercomOrderMu.Lock()
	defer p.intercomOrderMu.Unlock()
	done := make(chan struct{})
	wrapped := func() {
		defer close(done)
		task()
	}
	select {
	case <-p.intercomStop:
		return false
	case p.intercomQueue <- wrapped:
		p.intercomTail = done
		return true
	default:
		return false
	}
}

func (p *peer) dispatchIntercomProvider(task func()) bool {
	p.ensureIntercomDispatch()
	p.intercomOrderMu.Lock()
	dependency := p.intercomTail
	p.intercomOrderMu.Unlock()
	wrapper := func() {
		select {
		case <-p.intercomStop:
			return
		case <-dependency:
			task()
		}
	}
	select {
	case <-p.intercomStop:
		return false
	case p.intercomProvider <- wrapper:
		return true
	default:
		return false
	}
}

func (p *peer) stopIntercomDispatch() {
	p.intercomStopOnce.Do(func() {
		p.ensureIntercomDispatch()
		close(p.intercomStop)
	})
}

func (p *peer) failIntercomDispatch() {
	if p == nil {
		return
	}
	p.inactive.Store(true)
	p.stopIntercomDispatch()
	if p.conn != nil {
		_ = p.conn.Close()
	}
}

func (p *peer) ensureIntercomDispatch() {
	p.intercomOnce.Do(func() {
		p.intercomQueue = make(chan func(), 32)
		p.intercomProvider = make(chan func(), 8)
		p.intercomStop = make(chan struct{})
		p.intercomTail = make(chan struct{})
		close(p.intercomTail)
		startWorker := func(queue <-chan func()) {
			go func() {
				for {
					select {
					case <-p.intercomStop:
						return
					case next := <-queue:
						if next != nil {
							next()
						}
					}
				}
			}()
		}
		startWorker(p.intercomQueue)
		startWorker(p.intercomProvider)
	})
}

// Room represents a single signaling room owned by a sender.
type Room struct {
	ID           string
	Epoch        string // internal-only identity generation; never accepted from clients
	Code         string
	Name         string
	Password     string
	OwnerToken   string // H6: 소유권 증명 토큰 (room_created로 발급, rejoin/재사용 시 검증)
	Driver       *peer
	Engineers    map[string]*peer // peerId ??peer
	DriverLostAt *time.Time       // set when driver disconnects; nil when connected
	UpdatedAt    time.Time
	// TURN credential state belongs to each participant within this room. The
	// whole map disappears with the room, so credentials cannot cross either
	// participant or room authorization scopes.
	turnCredentials map[string]*turnCredentialState
	mu              sync.Mutex
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
	stopOnce       sync.Once
	ipBanWarnOnce  sync.Once // 귀속 불가로 IP밴을 건너뛸 때 경고를 1회만 로깅
	// legacyRejoinGrace: OwnerToken 필드 자체가 없던 v4.40 미만 sender의 하위호환.
	// 켜져 있으면 "빈 토큰 + 드라이버가 이미 끊긴 방"에 한해 rejoin/재사용을 허용한다
	// (활성 드라이버가 있는 방은 여전히 탈취 불가). LEGACY_REJOIN_GRACE=0 으로 비활성.
	// 구버전 fleet 이 모두 업데이트되면 꺼서 H6 를 온전히 강제하는 것을 권장.
	legacyRejoinGrace bool
	turnProvider      turncredentials.Provider
	intercom          *intercomManager
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
	rm.intercom = newIntercomManager(logger)
	go rm.cleanupLoop()
	return rm
}

// SetTurnCredentialsProvider enables short-lived TURN credential issuance.
// A nil provider is an intentional fail-open configuration: authenticated
// clients receive the stable fallback response and retain static/default ICE.
func (rm *RoomManager) SetTurnCredentialsProvider(provider turncredentials.Provider) {
	rm.mu.Lock()
	rm.turnProvider = provider
	rm.mu.Unlock()
}

// SetRealtimeSFUProvider enables intercom media while keeping group/presence
// signaling available when provider is nil.
func (rm *RoomManager) SetRealtimeSFUProvider(provider realtimesfu.Provider) {
	rm.intercom.setProvider(provider)
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
	rm.stopOnce.Do(func() {
		close(rm.done)
		rm.intercom.stop()
	})
}

// CreateRoom allocates a new room for the given driver connection.
// If requestedRoomID is set, it will be reused for room recreation — but reuse
// requires a matching OwnerToken (H6), otherwise a fresh room is allocated.
// Returns (roomID, roomCode, ownerToken, error).
func (rm *RoomManager) CreateRoom(driverConn *websocket.Conn, writeMu *sync.Mutex, requestedRoomID, roomName, password, ownerToken string) (string, string, string, error) {
	rm.mu.Lock()

	roomID := requestedRoomID
	if roomID == "" {
		var err error
		roomID, err = generateRoomID()
		if err != nil {
			rm.mu.Unlock()
			return "", "", "", fmt.Errorf("secure room identity unavailable")
		}
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
			var err error
			roomID, err = generateRoomID()
			if err != nil {
				rm.mu.Unlock()
				return "", "", "", fmt.Errorf("secure room identity unavailable")
			}
			room, exists = rm.roomsByID[roomID]
		}
	}

	// H7: 신규 room 생성 시에만 전역 상한을 검사(재사용/재접속은 통과).
	if !exists && len(rm.roomsByID) >= maxRooms {
		rm.mu.Unlock()
		return "", "", "", fmt.Errorf("server room capacity reached")
	}

	code, err := rm.generateUniqueCodeLocked()
	if err != nil {
		rm.mu.Unlock()
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
		epoch, epochErr := randomHexToken(8)
		ownerToken, ownerErr := generateOwnerToken()
		if epochErr != nil || ownerErr != nil {
			rm.mu.Unlock()
			return "", "", "", fmt.Errorf("secure room credentials unavailable")
		}
		room = &Room{
			ID:              roomID,
			Epoch:           epoch,
			Engineers:       make(map[string]*peer),
			OwnerToken:      ownerToken,
			turnCredentials: make(map[string]*turnCredentialState),
		}
		rm.roomsByID[roomID] = room
	}

	// L9: room 필드 변경은 room.mu 하에서 수행한다 — 다른 goroutine이 선행 lookup
	// 후 room.mu를 잡고 Driver 등을 읽을 수 있어서다. 구 conn 종료는 언락 후.
	var oldConn *websocket.Conn
	var oldDriver *peer
	existingEngineers := make([]*peer, 0)
	room.mu.Lock()
	if exists {
		delete(rm.roomsByCode, room.Code)
		if room.Driver != nil {
			oldDriver = room.Driver
			room.Driver.inactive.Store(true)
			if room.Driver.conn != nil {
				oldConn = room.Driver.conn
			}
		}
	}
	room.Code = code
	room.Name = normalizeRoomName(roomName)
	room.Password = password
	room.Driver = driverPeer
	room.DriverLostAt = nil
	if oldDriver != nil {
		rm.intercom.transferPeer(oldDriver, driverPeer)
	}
	room.UpdatedAt = time.Now()
	if exists {
		for _, engineer := range room.Engineers {
			existingEngineers = append(existingEngineers, engineer)
		}
	}
	resolvedToken := room.OwnerToken
	loggedName := room.Name
	room.mu.Unlock()

	rm.roomsByCode[code] = room
	rm.mu.Unlock()

	if oldConn != nil {
		_ = oldConn.Close()
	}
	rm.replayEngineerJoins(room, driverPeer, existingEngineers)

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

	peerID, err := generatePeerID()
	if err != nil {
		return "", "", fmt.Errorf("secure peer identity unavailable")
	}
	engineerPeer := &peer{
		conn:    conn,
		role:    roleEngineer,
		id:      peerID,
		writeMu: writeMu,
	}

	var driverToNotify *peer
	var roomCode string
	var engineerCount int
	var roomName string

	room.mu.Lock()
	if room.DriverLostAt != nil || room.Driver == nil {
		name := room.Name
		room.mu.Unlock()
		return "", "", fmt.Errorf("room %s is offline", name)
	}
	if room.Password != "" && subtle.ConstantTimeCompare([]byte(room.Password), []byte(password)) != 1 {
		room.mu.Unlock()
		return "", "", fmt.Errorf("invalid room password")
	}
	if len(room.Engineers) >= maxEngineersPerRoom {
		name := room.Name
		room.mu.Unlock()
		return "", "", fmt.Errorf("room %s is full (max %d)", name, maxEngineersPerRoom)
	}
	engineerPeer.roomID = room.ID
	engineerPeer.roomCode = room.Code
	room.Engineers[peerID] = engineerPeer
	room.UpdatedAt = time.Now()
	driverToNotify = room.Driver
	roomCode = room.Code
	engineerCount = len(room.Engineers)
	roomName = room.Name
	room.mu.Unlock()

	for driverToNotify != nil {
		if err := driverToNotify.sendJSON(Message{
			Type:   TypePeerJoined,
			PeerID: peerID,
		}); err == nil {
			break
		} else {
			room.mu.Lock()
			if room.Engineers[peerID] != engineerPeer {
				room.mu.Unlock()
				return "", "", fmt.Errorf("engineer session was replaced")
			}
			// A rejoin/create may have replaced the driver while the notification
			// was waiting on the old socket. Retry against that current driver;
			// duplicate peer_joined is idempotent at the sender.
			if replacement := room.Driver; replacement != nil && replacement != driverToNotify && room.DriverLostAt == nil {
				driverToNotify = replacement
				room.mu.Unlock()
				continue
			}

			engineerPeer.inactive.Store(true)
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
			rm.logger.Warn("failed to notify driver about engineer join", "roomId", room.ID, "code", roomCode, "peerId", peerID, "engineerCount", engineerCount, "error", err)
			return "", "", fmt.Errorf("room %s is offline", roomName)
		}
	}

	rm.logger.Info("engineer joined room", "roomId", room.ID, "code", roomCode, "peerId", peerID,
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
	oldPeer := eng
	eng.inactive.Store(true)
	// 새 peer 구조체로 교체한다. 구 핸들러의 RemovePeer가 포인터 정체성 가드에
	// 걸려 재바인딩된 세션을 지우지 못하게 하기 위함.
	newPeer := &peer{
		conn:     conn,
		role:     roleEngineer,
		roomID:   room.ID,
		roomCode: room.Code,
		id:       peerID,
		writeMu:  writeMu,
	}
	room.Engineers[peerID] = newPeer
	rm.intercom.transferPeer(oldPeer, newPeer)
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
	var oldDriver *peer
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
	if room.Driver != nil {
		oldDriver = room.Driver
		room.Driver.inactive.Store(true)
		if room.Driver.conn != nil {
			oldConn = room.Driver.conn
		}
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
	if oldDriver != nil {
		rm.intercom.transferPeer(oldDriver, newDriver)
	}
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

	rm.replayEngineerJoins(room, newDriver, existingEngineers)

	rm.logger.Info("driver rejoined room", "roomId", room.ID, "code", roomCode)
	return roomCode, nil
}

// replayEngineerJoins rebuilds sender-side peer membership after a driver
// reconnect. A concurrent engineer removal may send peer_left before this
// replayed peer_joined; the post-send membership check emits a compensating
// peer_left so the final sender state still matches the room.
func (rm *RoomManager) replayEngineerJoins(room *Room, driver *peer, engineers []*peer) {
	for _, engineer := range engineers {
		if engineer == nil {
			continue
		}
		if err := driver.sendJSON(Message{Type: TypePeerJoined, PeerID: engineer.id}); err != nil {
			rm.logger.Warn("failed to replay engineer join to reconnected driver", "roomId", driver.roomID, "code", driver.roomCode, "peerId", engineer.id, "error", err)
			return
		}

		room.mu.Lock()
		driverCurrent := room.hasCurrentPeerLocked(driver)
		_, engineerCurrent := room.Engineers[engineer.id]
		room.mu.Unlock()
		if driverCurrent && !engineerCurrent {
			_ = driver.sendJSON(Message{Type: TypePeerLeft, PeerID: engineer.id})
		}
	}
}

// UpdateRoomMetadata updates room list metadata by room ID. Signaling handlers
// must use updateRoomMetadataForPeer so a replaced socket cannot authorize an
// update; this method is retained for existing in-process callers.
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

// updateRoomMetadataForPeer verifies that driverPeer remains the room's current
// authenticated driver before applying a signaling request.
func (rm *RoomManager) updateRoomMetadataForPeer(driverPeer *peer, roomName, password string) (string, error) {
	if driverPeer == nil || driverPeer.role != roleDriver || driverPeer.inactive.Load() {
		return "", fmt.Errorf("driver session is no longer current")
	}
	rm.mu.RLock()
	room, ok := rm.roomsByID[driverPeer.roomID]
	rm.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("room %s not found", driverPeer.roomID)
	}

	room.mu.Lock()
	defer room.mu.Unlock()
	if !room.hasCurrentPeerLocked(driverPeer) {
		return "", fmt.Errorf("driver session is no longer current")
	}
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
	if !room.hasCurrentPeerLocked(senderPeer) {
		room.mu.Unlock()
		return
	}
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
	if p == nil {
		return
	}
	defer rm.intercom.detachPeer(p)
	defer p.stopIntercomDispatch()
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
		p.inactive.Store(true)
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
	p.inactive.Store(true)
	delete(room.Engineers, p.id)
	delete(room.turnCredentials, turnParticipantKey(p))
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
		rm.intercom.removeRoom(room)
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
		code, err := generate4DigitCode()
		if err != nil {
			return "", err
		}
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

func generate4DigitCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

// randomHexToken returns nBytes of crypto/rand encoded as a lowercase hex string.
func randomHexToken(nBytes int) (string, error) {
	return secureRandomHex(nBytes)
}

func generateRoomID() (string, error) {
	return randomHexToken(8)
}

// generateOwnerToken returns a 32-hex (16-byte) room ownership token from crypto/rand.
func generateOwnerToken() (string, error) {
	return randomHexToken(16)
}

func generatePeerID() (string, error) {
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

func (rm *RoomManager) isCurrentIntercomPeer(p *peer) bool {
	if p == nil || p.inactive.Load() || p.roomID == "" {
		return false
	}
	rm.mu.RLock()
	room := rm.roomsByID[p.roomID]
	rm.mu.RUnlock()
	if room == nil {
		return false
	}
	room.mu.Lock()
	current := room.hasCurrentPeerLocked(p)
	room.mu.Unlock()
	return current
}

func (rm *RoomManager) intercomIdentity(p *peer) (intercomIdentity, bool) {
	if p == nil || p.roomID == "" {
		return intercomIdentity{}, false
	}
	rm.mu.RLock()
	room := rm.roomsByID[p.roomID]
	rm.mu.RUnlock()
	if room == nil {
		return intercomIdentity{}, false
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	if !room.hasCurrentPeerLocked(p) || room.Epoch == "" {
		return intercomIdentity{}, false
	}
	identity := intercomIdentity{driverKey: room.Epoch + ":" + room.ID}
	if p.role == roleDriver {
		identity.role = IntercomRoleDriver
		identity.participantKey = identity.driverKey + ":driver"
	} else {
		identity.role = IntercomRoleEngineer
		identity.participantKey = identity.driverKey + ":engineer:" + p.id
	}
	return identity, true
}

// activeTurnRoom returns a room only when p is still the connection currently
// authorized for that membership. Pointer identity matters here: a stale
// WebSocket that was superseded by rebind/rejoin must not obtain credentials.
func (rm *RoomManager) activeTurnRoom(p *peer) (*Room, turncredentials.Provider, bool) {
	if p == nil || p.roomID == "" {
		return nil, nil, false
	}
	rm.mu.RLock()
	room := rm.roomsByID[p.roomID]
	provider := rm.turnProvider
	rm.mu.RUnlock()
	if room == nil {
		return nil, nil, false
	}
	room.mu.Lock()
	active := room.hasCurrentPeerLocked(p)
	room.mu.Unlock()
	return room, provider, active
}

func (room *Room) hasCurrentPeerLocked(p *peer) bool {
	if p == nil {
		return false
	}
	switch p.role {
	case roleDriver:
		return room.Driver == p && room.DriverLostAt == nil
	case roleEngineer:
		return room.Engineers[p.id] == p
	default:
		return false
	}
}

func (rm *RoomManager) isCurrentTurnPeer(room *Room, p *peer) bool {
	if room == nil || p == nil {
		return false
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	if rm.roomsByID[p.roomID] != room {
		return false
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	return room.hasCurrentPeerLocked(p)
}

func turnFallback(reason string) TurnCredentialsPayload {
	return TurnCredentialsPayload{Source: "fallback", Reason: reason}
}

func turnPayload(credentials turncredentials.Credentials) TurnCredentialsPayload {
	expiresAt := credentials.ExpiresAt
	return TurnCredentialsPayload{
		ICEServers: credentials.ICEServers,
		ExpiresAt:  &expiresAt,
		Source:     "cloudflare",
	}
}

func validTurnCredentials(credentials turncredentials.Credentials, now time.Time) bool {
	if credentials.IssuedAt.IsZero() || credentials.ExpiresAt.IsZero() || !credentials.ExpiresAt.After(now) || !credentials.ExpiresAt.After(credentials.IssuedAt) {
		return false
	}
	if credentials.ExpiresAt.Sub(credentials.IssuedAt) > time.Duration(turncredentials.MaxTTLSeconds)*time.Second {
		return false
	}
	_, err := turncredentials.ValidateICEServers(credentials.ICEServers)
	return err == nil
}

func turnParticipantKey(p *peer) string {
	if p == nil {
		return ""
	}
	switch p.role {
	case roleDriver:
		return "driver"
	case roleEngineer:
		if p.id != "" {
			return "engineer:" + p.id
		}
	}
	return ""
}

func (room *Room) turnCredentialStateLocked(p *peer) *turnCredentialState {
	key := turnParticipantKey(p)
	if key == "" {
		return nil
	}
	if room.turnCredentials == nil {
		room.turnCredentials = make(map[string]*turnCredentialState)
	}
	state := room.turnCredentials[key]
	if state == nil {
		state = &turnCredentialState{}
		room.turnCredentials[key] = state
	}
	return state
}

// turnCredentialsForPeer resolves a credential from the participant cache. The room
// mutex is released before Generate, so a slow provider never blocks joins,
// relays, or disconnect handling. Followers wait on the single in-flight call
// for that participant and then use its cache result/cooldown decision.
func (rm *RoomManager) turnCredentialsForPeer(p *peer) (TurnCredentialsPayload, *Room, bool) {
	room, provider, active := rm.activeTurnRoom(p)
	if !active {
		return TurnCredentialsPayload{}, nil, false
	}

	for {
		now := time.Now()
		room.mu.Lock()
		if !room.hasCurrentPeerLocked(p) {
			room.mu.Unlock()
			return TurnCredentialsPayload{}, room, false
		}
		state := room.turnCredentialStateLocked(p)
		if state == nil {
			room.mu.Unlock()
			return TurnCredentialsPayload{}, room, false
		}
		cached := state.credentials
		cachedValid := cached != nil && validTurnCredentials(*cached, now)
		if cachedValid && now.Before(state.refreshAfter) {
			payload := turnPayload(*cached)
			room.mu.Unlock()
			return payload, room, rm.isCurrentTurnPeer(room, p)
		}
		if state.inFlight {
			wait := state.wait
			room.mu.Unlock()
			<-wait
			continue
		}
		if provider == nil {
			room.mu.Unlock()
			return turnFallback("disabled"), room, rm.isCurrentTurnPeer(room, p)
		}
		if now.Before(state.failureUntil) {
			if cachedValid {
				payload := turnPayload(*cached)
				room.mu.Unlock()
				return payload, room, rm.isCurrentTurnPeer(room, p)
			}
			room.mu.Unlock()
			return turnFallback("temporarily_unavailable"), room, rm.isCurrentTurnPeer(room, p)
		}

		state.inFlight = true
		state.wait = make(chan struct{})
		wait := state.wait
		room.mu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), turnProviderTimeout)
		credentials, err := provider.Generate(ctx)
		cancel()
		now = time.Now()

		room.mu.Lock()
		state.inFlight = false
		state.wait = nil
		close(wait)
		if err == nil && validTurnCredentials(credentials, now) {
			validatedServers, _ := turncredentials.ValidateICEServers(credentials.ICEServers)
			credentials.ICEServers = validatedServers
			state.credentials = &credentials
			state.refreshAfter = credentials.IssuedAt.Add(credentials.ExpiresAt.Sub(credentials.IssuedAt) * 4 / 5)
			state.failureUntil = time.Time{}
			payload := turnPayload(credentials)
			stillActive := room.hasCurrentPeerLocked(p)
			room.mu.Unlock()
			if stillActive {
				stillActive = rm.isCurrentTurnPeer(room, p)
			}
			return payload, room, stillActive
		}

		// Do not invalidate a still-valid credential because a refresh failed.
		// Existing clients can continue to use it through expiry; new refreshes
		// are suppressed for a bounded period to absorb provider outages.
		state.failureUntil = now.Add(turnFailureCooldown)
		if cached := state.credentials; cached != nil && validTurnCredentials(*cached, now) {
			payload := turnPayload(*cached)
			stillActive := room.hasCurrentPeerLocked(p)
			room.mu.Unlock()
			if stillActive {
				stillActive = rm.isCurrentTurnPeer(room, p)
			}
			return payload, room, stillActive
		}
		stillActive := room.hasCurrentPeerLocked(p)
		room.mu.Unlock()
		if stillActive {
			stillActive = rm.isCurrentTurnPeer(room, p)
		}
		// Never include err here: an HTTP error can contain redirect/status/body
		// details, and the WebSocket contract intentionally has a stable reason.
		return turnFallback("temporarily_unavailable"), room, stillActive
	}
}

func (rm *RoomManager) sendTurnCredentials(p *peer, requestID string, writeMu *sync.Mutex) {
	payload, room, active := rm.turnCredentialsForPeer(p)
	if !active {
		sendErrorRaw(p.conn, "not in a room", writeMu)
		return
	}
	// Recheck after an external provider request. A rebind/rejoin might have
	// replaced p while the HTTP request was in flight.
	if !rm.isCurrentTurnPeer(room, p) {
		return
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		// The payload is locally constructed. Preserve the generic fallback if a
		// future field ever becomes non-marshalable rather than leaking internals.
		encoded, _ = json.Marshal(turnFallback("temporarily_unavailable"))
	}
	_ = p.sendJSON(Message{
		Type:      TypeTurnCredentials,
		RequestID: requestID,
		Payload:   encoded,
	})
}

// HandleMessage processes an incoming signaling message from a WebSocket connection.
func (rm *RoomManager) HandleMessage(conn *websocket.Conn, raw []byte, currentPeer *peer, writeMu *sync.Mutex, clientIP string) *peer {
	if len(raw) > MaxIntercomEnvelopeBytes || !utf8.Valid(raw) {
		sendErrorRaw(conn, "invalid signaling envelope", writeMu)
		return currentPeer
	}
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
		if p.sendJSON(Message{Type: TypeRoomCreated, RoomID: roomID, RoomCode: code, RoomName: normalizeRoomName(msg.RoomName), OwnerToken: ownerToken, Features: &Features{IntercomVersion: IntercomProtocolVersion}}) == nil {
			rm.intercom.advertisePeer(p)
		}
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
		if p.sendJSON(Message{Type: TypeRoomCreated, RoomID: msg.RoomID, RoomCode: code, RoomName: normalizeRoomName(msg.RoomName), Features: &Features{IntercomVersion: IntercomProtocolVersion}}) == nil {
			rm.intercom.advertisePeer(p)
		}
		return p

	case TypeRoomUpdate:
		if currentPeer == nil || currentPeer.role != roleDriver {
			sendErrorRaw(conn, "driver room update only", writeMu)
			return currentPeer
		}
		code, err := rm.updateRoomMetadataForPeer(currentPeer, msg.RoomName, msg.Password)
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
				if p.sendJSON(Message{
					Type:     TypeRoomJoined,
					PeerID:   msg.PeerID,
					RoomID:   roomID,
					RoomCode: roomCode,
					Features: &Features{IntercomVersion: IntercomProtocolVersion},
				}) == nil {
					rm.intercom.advertisePeer(p)
				}
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
			Features: &Features{IntercomVersion: IntercomProtocolVersion},
		})
		return p

	case TypeHeartbeat:
		// Echo heartbeat back as application-level keepalive.
		writeMu.Lock()
		conn.SetWriteDeadline(time.Now().Add(signalingWriteWait))
		_ = conn.WriteJSON(Message{Type: TypeHeartbeat})
		writeMu.Unlock()

	case TypeTurnCredentialsRequest:
		if currentPeer == nil {
			sendErrorRaw(conn, "not in a room", writeMu)
			return currentPeer
		}
		if strings.TrimSpace(msg.RequestID) == "" || len(msg.RequestID) > maxTurnRequestIDBytes {
			sendErrorRaw(conn, "invalid requestId", writeMu)
			return currentPeer
		}
		rm.sendTurnCredentials(currentPeer, msg.RequestID, writeMu)

	case TypeOffer, TypeAnswer, TypeICECandidate:
		if currentPeer == nil {
			sendErrorRaw(conn, "not in a room", writeMu)
			return currentPeer
		}
		rm.Relay(currentPeer, msg)

	case TypeIntercomGroupCreate, TypeIntercomJoin, TypeIntercomLeave, TypeIntercomActivity,
		TypeIntercomPrivateSet, TypeIntercomPrivateReady, TypeIntercomSFUSessionNew,
		TypeIntercomSFUPublish, TypeIntercomSFUSubscribe, TypeIntercomSFURenegotiate,
		TypeIntercomSFUClose:
		if currentPeer == nil {
			sendErrorRaw(conn, "not in a room", writeMu)
			return currentPeer
		}
		// Provider operations have their own bounded serial worker. Control-plane
		// activity and private-ready messages therefore remain responsive while a
		// Cloudflare call is in flight, while provider operations retain order.
		dispatched := false
		if msg.Type == TypeIntercomGroupCreate || msg.Type == TypeIntercomJoin || msg.Type == TypeIntercomLeave {
			currentPeer.intercomMembershipEpoch.Add(1)
		}
		if isIntercomProviderRPC(msg.Type) {
			binding := rm.intercom.captureDispatchBinding(currentPeer)
			dispatched = currentPeer.dispatchIntercomProvider(func() { rm.intercom.handle(rm, currentPeer, msg, clientIP, binding) })
		} else {
			dispatched = currentPeer.dispatchIntercom(func() { rm.intercom.handle(rm, currentPeer, msg, clientIP) })
		}
		if !dispatched {
			// A full bounded queue means this client is producing faster than the
			// connection can safely drain. Fail closed without spawning writers that
			// could pile up behind a stalled WebSocket.
			currentPeer.failIntercomDispatch()
		}

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
	conn.SetWriteDeadline(time.Now().Add(signalingWriteWait))
	_ = conn.WriteMessage(websocket.TextMessage, data)
}
