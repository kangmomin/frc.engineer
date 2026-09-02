package signaling

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"frc.engineer/internal/realtimesfu"
)

const (
	maxIntercomDrivers       = 2
	maxIntercomEngineers     = 8
	maxIntercomChiefs        = 1
	maxIntercomDisplayBytes  = 40
	maxIntercomPasswordBytes = 128
	maxIntercomRequestID     = 128
	maxIntercomSDPBytes      = 64 * 1024
	intercomOfflineGrace     = 45 * time.Second
	intercomActivityInterval = 250 * time.Millisecond
	intercomActivityLease    = 1500 * time.Millisecond
	intercomPrivateTimeout   = 2 * time.Second
	intercomResponseCacheMax = 32
	intercomDeliveryMax      = 32
	intercomLeaveCacheTTL    = time.Minute
	intercomProviderTimeout  = 5 * time.Second
)

type intercomManager struct {
	mu           sync.Mutex
	groups       map[string]*intercomGroup
	byPeer       map[*peer]*intercomMember
	attempts     map[string]*intercomAttempt
	left         map[*peer]intercomCachedLeave
	provider     realtimesfu.Provider
	logger       *slog.Logger
	done         chan struct{}
	stopOnce     sync.Once
	groupCodeGen func() (string, error)
	chiefCodeGen func(int) (string, error)
	randomHex    func(int) (string, error)
	randomRead   func([]byte) error
}

type intercomGroup struct {
	code             string
	passwordSalt     [16]byte
	passwordHash     [32]byte
	chiefCode        string
	revision         uint64
	topologyRevision uint64
	members          map[string]*intercomMember
	private          *intercomPrivateState
	privateToken     uint64
}

type intercomPrivateState struct {
	phase     IntercomPrivatePhase
	driverKey string
	revision  uint64
	token     uint64
	required  map[string]uint64
	ready     map[string]bool
	timeout   *time.Timer
}

type intercomMember struct {
	id                  string
	group               *intercomGroup
	role                IntercomRole
	displayName         string
	originRoomKey       string
	driverKey           string
	assignmentDriverKey string
	resumeToken         string
	ownsChiefCode       bool
	peer                *peer
	online              bool
	generation          uint64
	offlineAt           time.Time
	speaking            bool
	ptt                 bool
	busEnabled          bool
	lastActivity        time.Time
	nextActivity        time.Time
	pendingActivity     *IntercomActivityPayload
	activityTimer       *time.Timer
	activityLeaseID     uint64
	leaseTimer          *time.Timer
	delivery            *intercomDeliveryQueue
	responseCache       map[string]Message
	responseOrder       []string
	opMu                sync.Mutex
	sfu                 *intercomBrokerSession
}

type intercomAttempt struct {
	window time.Time
	count  int
}

type intercomCachedLeave struct {
	requestID string
	response  Message
	expiresAt time.Time
}

type intercomDispatchBinding struct {
	epoch uint64
}

type intercomDeliveryQueue struct {
	mu               sync.Mutex
	messages         []Message
	ready            bool
	stateRevision    uint64
	hasStateRevision bool
	closed           bool
	wake             chan struct{}
	stop             chan struct{}
	stopOnce         sync.Once
}

func newIntercomDeliveryQueue() *intercomDeliveryQueue {
	return newIntercomDeliveryQueueReady(true)
}

func newIntercomDeliveryQueueReady(ready bool) *intercomDeliveryQueue {
	return &intercomDeliveryQueue{ready: ready, wake: make(chan struct{}, 1), stop: make(chan struct{})}
}

func (q *intercomDeliveryQueue) enqueue(message Message) bool {
	if q == nil {
		return false
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false
	}
	if message.Type == TypeIntercomState && message.RequestID == "" {
		newRevision, ok := intercomStateRevision(message)
		if !ok {
			return false
		}
		if q.hasStateRevision && newRevision <= q.stateRevision {
			return true
		}
		for index, queued := range q.messages {
			if queued.Type != TypeIntercomState || queued.RequestID != "" {
				continue
			}
			queuedRevision, valid := intercomStateRevision(queued)
			if valid && queuedRevision >= newRevision {
				return true
			}
			q.messages = append(q.messages[:index], q.messages[index+1:]...)
			break
		}
		if len(q.messages) >= intercomDeliveryMax {
			return false
		}
		q.stateRevision = newRevision
		q.hasStateRevision = true
	} else if len(q.messages) >= intercomDeliveryMax {
		return false
	}
	q.messages = append(q.messages, message)
	select {
	case q.wake <- struct{}{}:
	default:
	}
	return true
}

func (q *intercomDeliveryQueue) pop() (Message, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if !q.ready || len(q.messages) == 0 {
		return Message{}, false
	}
	message := q.messages[0]
	q.messages = q.messages[1:]
	return message, true
}

func (q *intercomDeliveryQueue) open() {
	if q == nil {
		return
	}
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return
	}
	q.ready = true
	hasMessages := len(q.messages) > 0
	q.mu.Unlock()
	if hasMessages {
		select {
		case q.wake <- struct{}{}:
		default:
		}
	}
}

func (q *intercomDeliveryQueue) gate() {
	if q == nil {
		return
	}
	q.mu.Lock()
	q.ready = false
	q.mu.Unlock()
}

func (q *intercomDeliveryQueue) close() {
	if q != nil {
		q.stopOnce.Do(func() {
			q.mu.Lock()
			q.closed = true
			close(q.stop)
			q.mu.Unlock()
		})
	}
}

func intercomStateRevision(message Message) (uint64, bool) {
	var snapshot IntercomSnapshot
	if err := json.Unmarshal(message.Payload, &snapshot); err != nil {
		return 0, false
	}
	return snapshot.Revision, true
}

func newIntercomManager(logger *slog.Logger) *intercomManager {
	manager := &intercomManager{
		groups:       make(map[string]*intercomGroup),
		byPeer:       make(map[*peer]*intercomMember),
		attempts:     make(map[string]*intercomAttempt),
		left:         make(map[*peer]intercomCachedLeave),
		logger:       logger,
		done:         make(chan struct{}),
		groupCodeGen: generateIntercomGroupCode,
		chiefCodeGen: generateCrockfordCode,
		randomHex:    secureRandomHex,
		randomRead: func(buffer []byte) error {
			read, err := rand.Read(buffer)
			if err != nil || read != len(buffer) {
				return fmt.Errorf("secure random source unavailable")
			}
			return nil
		},
	}
	go manager.cleanupLoop()
	return manager
}

func (m *intercomManager) stop() {
	m.stopOnce.Do(func() {
		close(m.done)
		var members []*intercomMember
		m.mu.Lock()
		for _, group := range m.groups {
			for _, member := range group.members {
				members = append(members, member)
			}
		}
		for _, member := range members {
			m.removeMemberLocked(member)
		}
		clear(m.groups)
		m.mu.Unlock()
		for _, member := range members {
			go m.closeMemberBroker(member)
		}
	})
}

func (m *intercomManager) setProvider(provider realtimesfu.Provider) {
	m.mu.Lock()
	m.provider = provider
	m.mu.Unlock()
}

func (m *intercomManager) handle(rm *RoomManager, p *peer, msg Message, clientIP string, bindings ...intercomDispatchBinding) {
	if p == nil || !rm.isCurrentIntercomPeer(p) {
		sendIntercomError(p, msg.RequestID, "not_joined", "authenticated signaling membership required", false)
		return
	}
	if len(bindings) > 0 && !m.dispatchBindingCurrent(p, bindings[0]) {
		return
	}
	if isIntercomRPC(msg.Type) && !validIntercomRequestID(msg.RequestID) {
		sendIntercomError(p, msg.RequestID, "invalid_request", "valid requestId required", false)
		return
	}

	m.mu.Lock()
	if msg.Type == TypeIntercomLeave {
		if cached, ok := m.left[p]; ok && cached.requestID == msg.RequestID && time.Now().Before(cached.expiresAt) {
			m.mu.Unlock()
			_ = p.sendJSON(cached.response)
			return
		}
	}
	if member := m.byPeer[p]; member != nil && msg.RequestID != "" {
		if cached, ok := member.responseCache[msg.RequestID]; ok {
			generation := member.generation
			m.mu.Unlock()
			if len(bindings) > 0 {
				m.respondBrokerOperation(newIntercomBrokerOperation(member, p, generation, bindings), cached)
			} else {
				_ = p.sendJSON(cached)
			}
			return
		}
	}
	m.mu.Unlock()

	switch msg.Type {
	case TypeIntercomGroupCreate:
		var payload IntercomGroupCreatePayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			sendIntercomError(p, msg.RequestID, "invalid_request", "invalid group create payload", false)
			return
		}
		m.createGroup(rm, p, msg.RequestID, clientIP, payload)
	case TypeIntercomJoin:
		var payload IntercomJoinPayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			sendIntercomError(p, msg.RequestID, "invalid_request", "invalid join payload", false)
			return
		}
		m.joinGroup(rm, p, msg.RequestID, clientIP, payload)
	case TypeIntercomLeave:
		var payload IntercomLeavePayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			sendIntercomError(p, msg.RequestID, "invalid_request", "invalid leave payload", false)
			return
		}
		m.leave(p, msg.RequestID)
	case TypeIntercomActivity:
		var payload IntercomActivityPayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			return
		}
		m.activity(p, payload)
	case TypeIntercomPrivateSet:
		var payload IntercomPrivateSetPayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			sendIntercomError(p, msg.RequestID, "invalid_request", "invalid private payload", false)
			return
		}
		m.setPrivate(p, msg.RequestID, payload)
	case TypeIntercomPrivateReady:
		var payload IntercomPrivateReadyPayload
		if !decodeIntercomPayload(msg.Payload, &payload) || payload.Revision > MaxIntercomSafeInteger {
			return
		}
		m.privateReady(p, payload)
	case TypeIntercomSFUSessionNew:
		var payload IntercomSFUSessionNewPayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			m.respondProviderDispatchError(p, msg.RequestID, "invalid_request", "invalid SFU session payload", bindings)
			return
		}
		m.sfuSessionNew(p, msg.RequestID, bindings...)
	case TypeIntercomSFUPublish:
		var payload IntercomSFUPublishPayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			m.respondProviderDispatchError(p, msg.RequestID, "invalid_request", "invalid SFU publish payload", bindings)
			return
		}
		m.sfuPublish(p, msg.RequestID, payload, bindings...)
	case TypeIntercomSFUSubscribe:
		var payload IntercomSFUSubscribePayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			m.respondProviderDispatchError(p, msg.RequestID, "invalid_request", "invalid SFU subscribe payload", bindings)
			return
		}
		m.sfuSubscribe(p, msg.RequestID, payload, bindings...)
	case TypeIntercomSFURenegotiate:
		var payload IntercomSFURenegotiatePayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			m.respondProviderDispatchError(p, msg.RequestID, "invalid_request", "invalid SFU renegotiate payload", bindings)
			return
		}
		m.sfuRenegotiate(p, msg.RequestID, payload, bindings...)
	case TypeIntercomSFUClose:
		var payload IntercomSFUClosePayload
		if !decodeIntercomPayload(msg.Payload, &payload) {
			m.respondProviderDispatchError(p, msg.RequestID, "invalid_request", "invalid SFU close payload", bindings)
			return
		}
		m.sfuClose(p, msg.RequestID, payload, bindings...)
	}
}

func (m *intercomManager) captureDispatchBinding(p *peer) intercomDispatchBinding {
	if p == nil {
		return intercomDispatchBinding{}
	}
	return intercomDispatchBinding{epoch: p.intercomMembershipEpoch.Load()}
}

func (m *intercomManager) dispatchBindingCurrent(p *peer, binding intercomDispatchBinding) bool {
	return p != nil && p.intercomMembershipEpoch.Load() == binding.epoch
}

func (m *intercomManager) dispatchBindingCurrentLocked(p *peer, binding intercomDispatchBinding) bool {
	return p != nil && p.intercomMembershipEpoch.Load() == binding.epoch
}

func (m *intercomManager) createGroup(rm *RoomManager, p *peer, requestID, clientIP string, payload IntercomGroupCreatePayload) {
	identity, ok := rm.intercomIdentity(p)
	if !ok || identity.role != IntercomRoleDriver {
		sendIntercomError(p, requestID, "unauthorized", "driver role required", false)
		return
	}
	if !validIntercomDisplay(payload.DisplayName) || payload.Password == "" || len(payload.Password) > maxIntercomPasswordBytes {
		sendIntercomError(p, requestID, "invalid_request", "invalid group credentials", false)
		return
	}

	m.mu.Lock()
	if !m.allowAttemptLocked(identity.participantKey, clientIP, rm.ipAttributable) {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "rate_limited", "too many intercom attempts", true)
		return
	}
	if m.byPeer[p] != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "already_joined", "leave the current intercom first", false)
		return
	}
	code, err := m.uniqueGroupCodeLocked()
	if err != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "internal_error", "secure intercom credentials unavailable", true)
		return
	}
	chiefCode, err := m.chiefCodeGen(10)
	if err != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "internal_error", "secure intercom credentials unavailable", true)
		return
	}
	group := &intercomGroup{
		code:             code,
		chiefCode:        chiefCode,
		revision:         1,
		topologyRevision: 1,
		members:          make(map[string]*intercomMember),
	}
	if err := m.randomRead(group.passwordSalt[:]); err != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "internal_error", "secure intercom credentials unavailable", true)
		return
	}
	group.passwordHash = intercomPasswordHash(group.passwordSalt, payload.Password)
	member, err := m.newMemberLocked(group, p, IntercomRoleDriver, payload.DisplayName, identity.driverKey, identity.driverKey, "")
	if err != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "internal_error", "secure intercom credentials unavailable", true)
		return
	}
	member.ownsChiefCode = true
	m.groups[code] = group
	delivery := member.delivery
	delivery.gate()
	snapshot := m.snapshotLocked(group)
	sfuEnabled := m.provider != nil
	response := intercomMessage(TypeIntercomJoined, requestID, IntercomJoinedPayload{
		MembershipGeneration: member.generation,
		ParticipantID:        member.id,
		ResumeToken:          member.resumeToken,
		GroupCode:            code,
		ChiefCode:            group.chiefCode,
		Snapshot:             snapshot,
		SFUEnabled:           sfuEnabled,
	})
	m.cacheResponseLocked(member, response)
	m.mu.Unlock()
	if err := p.sendJSON(response); err == nil {
		m.openJoinedDelivery(member, p, delivery)
	} else if p.conn != nil {
		_ = p.conn.Close()
	}
}

func (m *intercomManager) joinGroup(rm *RoomManager, p *peer, requestID, clientIP string, payload IntercomJoinPayload) {
	identity, ok := rm.intercomIdentity(p)
	if !ok || !validIntercomDisplay(payload.DisplayName) || len(payload.Password) > maxIntercomPasswordBytes {
		sendIntercomError(p, requestID, "invalid_request", "invalid intercom join", false)
		return
	}
	if (payload.Role == IntercomRoleDriver) != (identity.role == IntercomRoleDriver) ||
		(payload.Role != IntercomRoleDriver && identity.role != IntercomRoleEngineer) ||
		(payload.Role != IntercomRoleDriver && payload.Role != IntercomRoleEngineer && payload.Role != IntercomRoleChief) {
		sendIntercomError(p, requestID, "unauthorized", "role does not match signaling membership", false)
		return
	}

	m.mu.Lock()
	if !m.allowAttemptLocked(identity.participantKey, clientIP, rm.ipAttributable) {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "rate_limited", "too many intercom attempts", true)
		return
	}
	if existing := m.byPeer[p]; existing != nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "already_joined", "leave the current intercom first", false)
		return
	}
	group := m.groups[payload.GroupCode]
	if group == nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "group_not_found", "intercom group not found", false)
		return
	}
	passwordHash := intercomPasswordHash(group.passwordSalt, payload.Password)
	passwordOK := subtle.ConstantTimeCompare(passwordHash[:], group.passwordHash[:]) == 1
	chiefOK := payload.Role != IntercomRoleChief || constantTimeStringEqual(payload.ChiefCode, group.chiefCode)
	if !passwordOK || !chiefOK {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "invalid_credentials", "intercom credentials rejected", false)
		return
	}

	driverKey := ""
	assignmentKey := ""
	if payload.Role == IntercomRoleDriver {
		driverKey = identity.driverKey
	} else if payload.Role == IntercomRoleEngineer {
		assignmentKey = identity.driverKey
	}
	member := m.resumeMemberLocked(group, p, payload, identity.driverKey, driverKey, assignmentKey)
	if payload.ResumeToken != "" && member == nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "invalid_resume", "intercom resume token rejected", false)
		return
	}
	if member == nil {
		if !m.capacityAvailableLocked(group, payload.Role) {
			m.mu.Unlock()
			sendIntercomError(p, requestID, "capacity", "intercom group is full", false)
			return
		}
		var err error
		member, err = m.newMemberLocked(group, p, payload.Role, payload.DisplayName, identity.driverKey, driverKey, assignmentKey)
		if err != nil {
			m.mu.Unlock()
			sendIntercomError(p, requestID, "internal_error", "secure intercom credentials unavailable", true)
			return
		}
		group.revision++
		group.topologyRevision++
	}
	if group.private != nil && group.private.phase == IntercomPrivatePreparing {
		if group.private.timeout != nil {
			group.private.timeout.Stop()
		}
		group.private = nil
		group.revision++
	}
	delivery := member.delivery
	delivery.gate()
	snapshot := m.snapshotLocked(group)
	joinedPayload := IntercomJoinedPayload{
		MembershipGeneration: member.generation,
		ParticipantID:        member.id,
		ResumeToken:          member.resumeToken,
		GroupCode:            group.code,
		Snapshot:             snapshot,
		SFUEnabled:           m.provider != nil,
	}
	if member.ownsChiefCode {
		joinedPayload.ChiefCode = group.chiefCode
	}
	response := intercomMessage(TypeIntercomJoined, requestID, joinedPayload)
	m.cacheResponseLocked(member, response)
	others := m.stateRecipientsLocked(group, member.id)
	m.mu.Unlock()
	if err := p.sendJSON(response); err == nil {
		m.openJoinedDelivery(member, p, delivery)
	} else if p.conn != nil {
		_ = p.conn.Close()
	}
	m.queueSnapshot(others, snapshot)
}

func (m *intercomManager) leave(p *peer, requestID string) {
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || !member.online || member.peer != p {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "not_joined", "intercom membership required", false)
		return
	}
	group := member.group
	response := intercomMessage(TypeIntercomLeft, requestID, IntercomLeftPayload{})
	m.left[p] = intercomCachedLeave{requestID: requestID, response: response, expiresAt: time.Now().Add(intercomLeaveCacheTTL)}
	m.removeMemberLocked(member)
	recipients := m.stateRecipientsLocked(group, "")
	snapshot := m.snapshotLocked(group)
	if len(group.members) == 0 {
		delete(m.groups, group.code)
	}
	m.mu.Unlock()
	_ = p.sendJSON(response)
	m.queueSnapshot(recipients, snapshot)
	go m.closeMemberBroker(member)
}

func (m *intercomManager) activity(p *peer, payload IntercomActivityPayload) {
	now := time.Now()
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || member.peer != p || !member.online {
		m.mu.Unlock()
		return
	}
	if now.Before(member.nextActivity) {
		copyPayload := payload
		member.pendingActivity = &copyPayload
		if member.activityTimer == nil {
			delay := time.Until(member.nextActivity)
			id, generation := member.id, member.generation
			member.activityTimer = time.AfterFunc(delay, func() { m.applyPendingActivity(id, generation) })
		}
		m.mu.Unlock()
		return
	}
	recipients, snapshot := m.applyActivityLocked(member, payload, now)
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) applyPendingActivity(id string, generation uint64) {
	m.mu.Lock()
	member := m.findMemberLocked(id)
	if member == nil || !member.online || member.generation != generation {
		m.mu.Unlock()
		return
	}
	payload := member.pendingActivity
	member.pendingActivity = nil
	member.activityTimer = nil
	if payload == nil {
		m.mu.Unlock()
		return
	}
	recipients, snapshot := m.applyActivityLocked(member, *payload, time.Now())
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) applyActivityLocked(member *intercomMember, payload IntercomActivityPayload, now time.Time) ([]*intercomMember, IntercomSnapshot) {
	member.speaking = payload.Speaking
	member.ptt = payload.PTT
	member.busEnabled = payload.BusEnabled
	member.lastActivity = now
	member.nextActivity = now.Add(intercomActivityInterval)
	member.activityLeaseID++
	leaseID := member.activityLeaseID
	if member.leaseTimer != nil {
		member.leaseTimer.Stop()
	}
	id, generation := member.id, member.generation
	member.leaseTimer = time.AfterFunc(intercomActivityLease, func() { m.expireActivity(id, generation, leaseID) })
	member.group.revision++
	return m.stateRecipientsLocked(member.group, ""), m.snapshotLocked(member.group)
}

func (m *intercomManager) expireActivity(id string, generation, leaseID uint64) {
	m.mu.Lock()
	member := m.findMemberLocked(id)
	if member == nil || member.generation != generation || member.activityLeaseID != leaseID {
		m.mu.Unlock()
		return
	}
	member.leaseTimer = nil
	if !member.speaking && !member.ptt {
		m.mu.Unlock()
		return
	}
	member.speaking = false
	member.ptt = false
	member.group.revision++
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) setPrivate(p *peer, requestID string, payload IntercomPrivateSetPayload) {
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || member.peer != p || !member.online || member.role != IntercomRoleChief {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "unauthorized", "chief role required", false)
		return
	}
	group := member.group
	if !payload.Active {
		if group.private != nil && group.private.timeout != nil {
			group.private.timeout.Stop()
		}
		group.private = nil
		group.revision++
		snapshot := m.snapshotLocked(group)
		response := intercomMessage(TypeIntercomState, requestID, snapshot)
		m.cacheResponseLocked(member, response)
		recipients := m.stateRecipientsLocked(group, member.id)
		m.mu.Unlock()
		_ = p.sendJSON(response)
		m.queueSnapshot(recipients, snapshot)
		return
	}
	target := m.onlineDriverLocked(group, payload.DriverKey)
	if target == nil {
		m.mu.Unlock()
		sendIntercomError(p, requestID, "invalid_target", "private driver must be online", false)
		return
	}
	if group.private != nil && group.private.timeout != nil {
		group.private.timeout.Stop()
	}
	group.revision++
	group.privateToken++
	private := &intercomPrivateState{
		phase:     IntercomPrivatePreparing,
		driverKey: payload.DriverKey,
		revision:  group.revision,
		token:     group.privateToken,
		required:  make(map[string]uint64),
		ready:     make(map[string]bool),
	}
	for _, candidate := range group.members {
		if !candidate.online {
			continue
		}
		if candidate == member || candidate == target || (candidate.role == IntercomRoleEngineer && candidate.assignmentDriverKey == payload.DriverKey) {
			private.required[candidate.id] = candidate.generation
		}
	}
	group.private = private
	snapshot := m.snapshotLocked(group)
	response := intercomMessage(TypeIntercomState, requestID, snapshot)
	m.cacheResponseLocked(member, response)
	recipients := m.stateRecipientsLocked(group, member.id)
	m.mu.Unlock()
	queued := m.queueMemberMessage(member, response)
	m.queueSnapshot(recipients, snapshot)
	m.mu.Lock()
	if queued && group.private == private && private.phase == IntercomPrivatePreparing {
		private.timeout = time.AfterFunc(intercomPrivateTimeout, func() { m.abortPrivate(group.code, private.token) })
	}
	m.mu.Unlock()
	if !queued {
		m.abortPrivate(group.code, private.token)
	}
}

func (m *intercomManager) privateReady(p *peer, payload IntercomPrivateReadyPayload) {
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || member.peer != p || !member.online {
		m.mu.Unlock()
		return
	}
	private := member.group.private
	if private == nil || private.phase != IntercomPrivatePreparing || payload.Revision < private.revision || payload.Revision > member.group.revision || private.required[member.id] != member.generation {
		m.mu.Unlock()
		return
	}
	private.ready[member.id] = true
	for id := range private.required {
		if !private.ready[id] {
			m.mu.Unlock()
			return
		}
	}
	if private.timeout != nil {
		private.timeout.Stop()
	}
	private.phase = IntercomPrivateActive
	member.group.revision++
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) abortPrivate(groupCode string, token uint64) {
	m.mu.Lock()
	group := m.groups[groupCode]
	if group == nil || group.private == nil || group.private.token != token || group.private.phase != IntercomPrivatePreparing {
		m.mu.Unlock()
		return
	}
	group.private = nil
	group.revision++
	recipients := m.stateRecipientsLocked(group, "")
	snapshot := m.snapshotLocked(group)
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) transferPeer(oldPeer, newPeer *peer) {
	if oldPeer == nil || newPeer == nil || oldPeer == newPeer {
		return
	}
	m.mu.Lock()
	member := m.byPeer[oldPeer]
	if member == nil || member.peer != oldPeer {
		m.mu.Unlock()
		return
	}
	delete(m.byPeer, oldPeer)
	member.peer = newPeer
	member.online = true
	member.offlineAt = time.Time{}
	member.generation++
	oldSession := member.sfu
	if oldSession != nil {
		oldSession.invalid = true
		member.sfu = nil
		if len(oldSession.local) > 0 {
			member.group.topologyRevision++
		}
	}
	member.responseCache = make(map[string]Message)
	member.responseOrder = nil
	m.resetMemberDeliveryReadyLocked(member, false)
	member.pendingActivity = nil
	member.nextActivity = time.Time{}
	member.speaking = false
	member.ptt = false
	member.activityLeaseID++
	if member.activityTimer != nil {
		member.activityTimer.Stop()
		member.activityTimer = nil
	}
	if member.leaseTimer != nil {
		member.leaseTimer.Stop()
		member.leaseTimer = nil
	}
	m.byPeer[newPeer] = member
	if m.privateMembershipChangedLocked(member.group.private, member) {
		if member.group.private.timeout != nil {
			member.group.private.timeout.Stop()
		}
		member.group.private = nil
		member.group.revision++
	}
	member.group.revision++
	provider := m.provider
	m.mu.Unlock()
	if oldSession != nil {
		go m.closeDetachedBroker(member, provider, oldSession)
	}
}

func (m *intercomManager) advertisePeer(p *peer) {
	if p == nil {
		return
	}
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || member.peer != p || !member.online {
		m.mu.Unlock()
		return
	}
	m.resetMemberDeliveryReadyLocked(member, false)
	joined := m.joinedMessageLocked(member, "")
	recipients := m.stateRecipientsLocked(member.group, member.id)
	snapshot := m.snapshotLocked(member.group)
	delivery := member.delivery
	queued := delivery.enqueue(joined) && delivery.enqueue(intercomMessage(TypeIntercomState, "", snapshot))
	if queued {
		delivery.open()
	}
	m.mu.Unlock()
	if !queued && p.conn != nil {
		_ = p.conn.Close()
	}
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) detachPeer(p *peer) {
	if p == nil {
		return
	}
	m.mu.Lock()
	member := m.byPeer[p]
	if member == nil || member.peer != p {
		m.mu.Unlock()
		return
	}
	delete(m.byPeer, p)
	member.peer = nil
	member.online = false
	member.offlineAt = time.Now()
	member.speaking = false
	member.ptt = false
	member.pendingActivity = nil
	member.nextActivity = time.Time{}
	member.activityLeaseID++
	if member.activityTimer != nil {
		member.activityTimer.Stop()
		member.activityTimer = nil
	}
	if member.leaseTimer != nil {
		member.leaseTimer.Stop()
		member.leaseTimer = nil
	}
	m.resetMemberDeliveryReadyLocked(member, false)
	member.group.revision++
	member.group.topologyRevision++
	if m.privateMembershipChangedLocked(member.group.private, member) {
		if member.group.private.timeout != nil {
			member.group.private.timeout.Stop()
		}
		member.group.private = nil
		member.group.revision++
	}
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()
	m.queueSnapshot(recipients, snapshot)
}

func (m *intercomManager) removeRoom(room *Room) {
	if room == nil || room.Epoch == "" {
		return
	}
	prefix := room.Epoch + ":" + room.ID
	var removed []*intercomMember
	type stateUpdate struct {
		recipients []*intercomMember
		snapshot   IntercomSnapshot
	}
	var updates []stateUpdate
	m.mu.Lock()
	for code, group := range m.groups {
		changed := false
		for _, member := range group.members {
			if member.originRoomKey == prefix || member.driverKey == prefix || member.assignmentDriverKey == prefix {
				m.removeMemberLocked(member)
				removed = append(removed, member)
				changed = true
			}
		}
		if len(group.members) == 0 {
			delete(m.groups, code)
		} else if changed {
			updates = append(updates, stateUpdate{m.stateRecipientsLocked(group, ""), m.snapshotLocked(group)})
		}
	}
	m.mu.Unlock()
	for _, update := range updates {
		m.queueSnapshot(update.recipients, update.snapshot)
	}
	for _, member := range removed {
		go m.closeMemberBroker(member)
	}
}

func (m *intercomManager) joinedMessageLocked(member *intercomMember, requestID string) Message {
	payload := IntercomJoinedPayload{
		MembershipGeneration: member.generation,
		ParticipantID:        member.id,
		ResumeToken:          member.resumeToken,
		GroupCode:            member.group.code,
		Snapshot:             m.snapshotLocked(member.group),
		SFUEnabled:           m.provider != nil,
	}
	if member.ownsChiefCode {
		payload.ChiefCode = member.group.chiefCode
	}
	return intercomMessage(TypeIntercomJoined, requestID, payload)
}

func (m *intercomManager) newMemberLocked(group *intercomGroup, p *peer, role IntercomRole, displayName, originRoomKey, driverKey, assignmentKey string) (*intercomMember, error) {
	id, err := m.randomHex(8)
	if err != nil {
		return nil, err
	}
	resumeToken, err := m.randomHex(16)
	if err != nil {
		return nil, err
	}
	member := &intercomMember{
		id:                  id,
		group:               group,
		role:                role,
		displayName:         strings.TrimSpace(displayName),
		originRoomKey:       originRoomKey,
		driverKey:           driverKey,
		assignmentDriverKey: assignmentKey,
		resumeToken:         resumeToken,
		peer:                p,
		online:              true,
		generation:          1,
		busEnabled:          true,
		delivery:            newIntercomDeliveryQueue(),
		responseCache:       make(map[string]Message),
	}
	group.members[member.id] = member
	m.byPeer[p] = member
	go m.deliveryLoop(member, member.delivery)
	return member, nil
}

func (m *intercomManager) resumeMemberLocked(group *intercomGroup, p *peer, payload IntercomJoinPayload, originRoomKey, driverKey, assignmentKey string) *intercomMember {
	if payload.ResumeToken == "" {
		return nil
	}
	for _, member := range group.members {
		if !constantTimeStringEqual(member.resumeToken, payload.ResumeToken) || member.online || time.Since(member.offlineAt) > intercomOfflineGrace {
			continue
		}
		if member.role != payload.Role || member.originRoomKey != originRoomKey || member.driverKey != driverKey || member.assignmentDriverKey != assignmentKey {
			return nil
		}
		member.peer = p
		member.online = true
		member.offlineAt = time.Time{}
		member.displayName = strings.TrimSpace(payload.DisplayName)
		member.generation++
		if oldSession := member.sfu; oldSession != nil {
			oldSession.invalid = true
			member.sfu = nil
			provider := m.provider
			go m.closeDetachedBroker(member, provider, oldSession)
		}
		member.responseCache = make(map[string]Message)
		member.responseOrder = nil
		m.resetMemberDeliveryLocked(member)
		m.byPeer[p] = member
		group.revision++
		group.topologyRevision++
		return member
	}
	return nil
}

func (m *intercomManager) removeMemberLocked(member *intercomMember) {
	if member == nil || member.group == nil {
		return
	}
	group := member.group
	if member.peer != nil {
		delete(m.byPeer, member.peer)
	}
	delete(group.members, member.id)
	member.online = false
	member.peer = nil
	member.pendingActivity = nil
	member.nextActivity = time.Time{}
	member.activityLeaseID++
	if member.activityTimer != nil {
		member.activityTimer.Stop()
		member.activityTimer = nil
	}
	if member.leaseTimer != nil {
		member.leaseTimer.Stop()
		member.leaseTimer = nil
	}
	member.delivery.close()
	if m.privateMembershipChangedLocked(group.private, member) {
		if group.private.timeout != nil {
			group.private.timeout.Stop()
		}
		group.private = nil
	}
	group.revision++
	group.topologyRevision++
}

func (m *intercomManager) snapshotLocked(group *intercomGroup) IntercomSnapshot {
	participants := make([]IntercomParticipant, 0, len(group.members))
	for _, member := range group.members {
		participants = append(participants, IntercomParticipant{
			ID:                  member.id,
			Role:                member.role,
			DisplayName:         member.displayName,
			DriverKey:           member.driverKey,
			AssignmentDriverKey: member.assignmentDriverKey,
			Online:              member.online,
			Speaking:            member.speaking,
			PTT:                 member.ptt,
			BusEnabled:          member.busEnabled,
			ForcedMuted:         m.forcedMutedLocked(member),
			TalkingTo:           m.talkingToLocked(member),
		})
	}
	sort.Slice(participants, func(i, j int) bool { return participants[i].ID < participants[j].ID })
	snapshot := IntercomSnapshot{
		Revision:         group.revision,
		TopologyRevision: group.topologyRevision,
		GroupCode:        group.code,
		Participants:     participants,
	}
	if group.private != nil {
		snapshot.PrivateSession = &IntercomPrivateSession{Phase: group.private.phase, DriverKey: group.private.driverKey}
	}
	return snapshot
}

func (m *intercomManager) talkingToLocked(member *intercomMember) []string {
	if !member.online || !member.speaking || m.forcedMutedLocked(member) {
		return []string{}
	}
	group := member.group
	targets := make(map[string]bool)
	private := group.private
	if private != nil && private.phase == IntercomPrivatePreparing {
		return []string{}
	}
	for _, candidate := range group.members {
		if candidate == member || !candidate.online {
			continue
		}
		switch member.role {
		case IntercomRoleDriver:
			if private != nil && private.phase == IntercomPrivateActive && private.driverKey == member.driverKey {
				if candidate.role == IntercomRoleChief {
					targets[candidate.id] = true
				}
			} else if (candidate.role == IntercomRoleEngineer && candidate.assignmentDriverKey == member.driverKey) || candidate.role == IntercomRoleChief {
				targets[candidate.id] = true
			}
		case IntercomRoleEngineer:
			if member.busEnabled && (candidate.role == IntercomRoleEngineer || candidate.role == IntercomRoleChief) {
				targets[candidate.id] = true
			}
			if member.ptt && candidate.role == IntercomRoleDriver && candidate.driverKey == member.assignmentDriverKey {
				targets[candidate.id] = true
			}
		case IntercomRoleChief:
			if private != nil && private.phase == IntercomPrivateActive {
				if candidate.role == IntercomRoleDriver && candidate.driverKey == private.driverKey {
					targets[candidate.id] = true
				}
			} else if member.busEnabled && candidate.role == IntercomRoleEngineer {
				targets[candidate.id] = true
			}
		}
	}
	result := make([]string, 0, len(targets))
	for id := range targets {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func (m *intercomManager) forcedMutedLocked(member *intercomMember) bool {
	return member.role == IntercomRoleEngineer && member.group.private != nil && member.assignmentDriverKey == member.group.private.driverKey
}

func (m *intercomManager) stateRecipientsLocked(group *intercomGroup, exceptID string) []*intercomMember {
	recipients := make([]*intercomMember, 0, len(group.members))
	for _, member := range group.members {
		if member.online && member.id != exceptID {
			recipients = append(recipients, member)
		}
	}
	return recipients
}

func (m *intercomManager) queueSnapshot(recipients []*intercomMember, snapshot IntercomSnapshot) {
	message := intercomMessage(TypeIntercomState, "", snapshot)
	for _, member := range recipients {
		m.queueMemberMessage(member, message)
	}
}

func (m *intercomManager) deliveryLoop(member *intercomMember, delivery *intercomDeliveryQueue) {
	for {
		select {
		case <-delivery.stop:
			return
		case <-delivery.wake:
			for {
				message, ok := delivery.pop()
				if !ok {
					break
				}
				m.mu.Lock()
				p := member.peer
				online := member.online && member.delivery == delivery
				m.mu.Unlock()
				if online && p != nil {
					_ = p.sendJSON(message)
				}
			}
		}
	}
}

func (m *intercomManager) resetMemberDeliveryLocked(member *intercomMember) {
	m.resetMemberDeliveryReadyLocked(member, true)
}

func (m *intercomManager) resetMemberDeliveryReadyLocked(member *intercomMember, ready bool) {
	if member == nil {
		return
	}
	if member.delivery != nil {
		member.delivery.close()
	}
	member.delivery = newIntercomDeliveryQueueReady(ready)
	go m.deliveryLoop(member, member.delivery)
}

func (m *intercomManager) openJoinedDelivery(member *intercomMember, p *peer, delivery *intercomDeliveryQueue) {
	m.mu.Lock()
	current := member != nil && member.peer == p && member.online && m.byPeer[p] == member && member.delivery == delivery
	if current {
		delivery.open()
	}
	m.mu.Unlock()
}

func (m *intercomManager) queueMemberMessage(member *intercomMember, message Message) bool {
	if member == nil {
		return false
	}
	m.mu.Lock()
	delivery := member.delivery
	m.mu.Unlock()
	if delivery == nil || !delivery.enqueue(message) {
		m.closeMemberOnDeliveryFailure(member, delivery)
		return false
	}
	return true
}

func (m *intercomManager) closeMemberOnDeliveryFailure(member *intercomMember, delivery *intercomDeliveryQueue) {
	m.mu.Lock()
	p := member.peer
	current := member.delivery == delivery
	m.mu.Unlock()
	if current && p != nil && p.conn != nil {
		_ = p.conn.Close()
	}
}

func (m *intercomManager) cacheResponseLocked(member *intercomMember, message Message) {
	if member == nil || message.RequestID == "" {
		return
	}
	if _, exists := member.responseCache[message.RequestID]; !exists {
		member.responseOrder = append(member.responseOrder, message.RequestID)
	}
	member.responseCache[message.RequestID] = message
	for len(member.responseOrder) > intercomResponseCacheMax {
		oldest := member.responseOrder[0]
		member.responseOrder = member.responseOrder[1:]
		delete(member.responseCache, oldest)
	}
}

func (m *intercomManager) capacityAvailableLocked(group *intercomGroup, role IntercomRole) bool {
	count := 0
	for _, member := range group.members {
		if member.role == role {
			count++
		}
	}
	switch role {
	case IntercomRoleDriver:
		return count < maxIntercomDrivers
	case IntercomRoleEngineer:
		return count < maxIntercomEngineers
	case IntercomRoleChief:
		return count < maxIntercomChiefs
	default:
		return false
	}
}

func (m *intercomManager) allowAttemptLocked(participantKey, clientIP string, ipAttributable bool) bool {
	now := time.Now()
	participantAllowed := m.allowAttemptKeyLocked("participant:"+participantKey, now)
	ipAllowed := true
	if ipAttributable && clientIP != "" {
		ipAllowed = m.allowAttemptKeyLocked("ip:"+clientIP, now)
	}
	return participantAllowed && ipAllowed
}

func (m *intercomManager) allowAttemptKeyLocked(key string, now time.Time) bool {
	attempt := m.attempts[key]
	if attempt == nil || now.Sub(attempt.window) >= 10*time.Second {
		m.attempts[key] = &intercomAttempt{window: now, count: 1}
		return true
	}
	attempt.count++
	return attempt.count <= 6
}

func (m *intercomManager) uniqueGroupCodeLocked() (string, error) {
	for range 100 {
		code, err := m.groupCodeGen()
		if err != nil {
			return "", err
		}
		if m.groups[code] == nil {
			return code, nil
		}
	}
	return "", fmt.Errorf("intercom group code space unavailable")
}

func (m *intercomManager) onlineDriverLocked(group *intercomGroup, driverKey string) *intercomMember {
	for _, member := range group.members {
		if member.online && member.role == IntercomRoleDriver && member.driverKey == driverKey {
			return member
		}
	}
	return nil
}

func (m *intercomManager) privateRequiresLocked(private *intercomPrivateState, member *intercomMember) bool {
	if private == nil || member == nil {
		return false
	}
	_, required := private.required[member.id]
	return required || member.role == IntercomRoleChief
}

func (m *intercomManager) privateMembershipChangedLocked(private *intercomPrivateState, member *intercomMember) bool {
	return private != nil && (private.phase == IntercomPrivatePreparing || m.privateRequiresLocked(private, member))
}

func (m *intercomManager) findMemberLocked(id string) *intercomMember {
	for _, group := range m.groups {
		if member := group.members[id]; member != nil {
			return member
		}
	}
	return nil
}

func (m *intercomManager) cleanupLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.done:
			return
		case <-ticker.C:
			m.cleanupExpired()
		}
	}
}

func (m *intercomManager) cleanupExpired() {
	now := time.Now()
	var removed []*intercomMember
	type stateUpdate struct {
		recipients []*intercomMember
		snapshot   IntercomSnapshot
	}
	var updates []stateUpdate
	m.mu.Lock()
	for code, group := range m.groups {
		changed := false
		for _, member := range group.members {
			if !member.online && !member.offlineAt.IsZero() && now.Sub(member.offlineAt) >= intercomOfflineGrace {
				m.removeMemberLocked(member)
				removed = append(removed, member)
				changed = true
			}
		}
		if len(group.members) == 0 {
			delete(m.groups, code)
			continue
		}
		if changed {
			updates = append(updates, stateUpdate{m.stateRecipientsLocked(group, ""), m.snapshotLocked(group)})
		}
	}
	for key, attempt := range m.attempts {
		if now.Sub(attempt.window) > time.Minute {
			delete(m.attempts, key)
		}
	}
	for p, cached := range m.left {
		if now.After(cached.expiresAt) {
			delete(m.left, p)
		}
	}
	m.mu.Unlock()
	for _, update := range updates {
		m.queueSnapshot(update.recipients, update.snapshot)
	}
	for _, member := range removed {
		go m.closeMemberBroker(member)
	}
}

func decodeIntercomPayload(raw json.RawMessage, destination any) bool {
	if len(raw) == 0 || len(raw) > 96*1024 {
		return false
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination) == nil
}

func intercomMessage(messageType, requestID string, payload any) Message {
	encoded, _ := json.Marshal(payload)
	return Message{Type: messageType, RequestID: requestID, Payload: encoded}
}

func sendIntercomError(p *peer, requestID, code, message string, retryable bool) {
	if p == nil {
		return
	}
	if len(message) > 160 {
		message = message[:160]
	}
	_ = p.sendJSON(intercomMessage(TypeIntercomError, requestID, IntercomErrorPayload{Code: code, Message: message, Retryable: retryable}))
}

func validIntercomRequestID(requestID string) bool {
	return len(requestID) <= maxIntercomRequestID && utf8.ValidString(requestID) && strings.TrimSpace(requestID) != ""
}

func validIntercomDisplay(displayName string) bool {
	trimmed := strings.TrimSpace(displayName)
	return trimmed != "" && len(trimmed) <= maxIntercomDisplayBytes && utf8.ValidString(trimmed)
}

func intercomPasswordHash(salt [16]byte, password string) [32]byte {
	buffer := make([]byte, 0, len(salt)+len(password))
	buffer = append(buffer, salt[:]...)
	buffer = append(buffer, password...)
	return sha256.Sum256(buffer)
}

func constantTimeStringEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func generateIntercomGroupCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func generateCrockfordCode(length int) (string, error) {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	result := make([]byte, length)
	for i := range result {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		result[i] = alphabet[n.Int64()]
	}
	return string(result), nil
}

func secureRandomHex(nBytes int) (string, error) {
	if nBytes <= 0 {
		return "", fmt.Errorf("invalid secure token length")
	}
	buffer := make([]byte, nBytes)
	read, err := rand.Read(buffer)
	if err != nil || read != len(buffer) {
		return "", fmt.Errorf("secure random source unavailable")
	}
	return hex.EncodeToString(buffer), nil
}

func isIntercomRPC(messageType string) bool {
	switch messageType {
	case TypeIntercomGroupCreate, TypeIntercomJoin, TypeIntercomLeave, TypeIntercomPrivateSet,
		TypeIntercomSFUSessionNew, TypeIntercomSFUPublish, TypeIntercomSFUSubscribe,
		TypeIntercomSFURenegotiate, TypeIntercomSFUClose:
		return true
	default:
		return false
	}
}

func isIntercomProviderRPC(messageType string) bool {
	switch messageType {
	case TypeIntercomSFUSessionNew, TypeIntercomSFUPublish, TypeIntercomSFUSubscribe,
		TypeIntercomSFURenegotiate, TypeIntercomSFUClose:
		return true
	default:
		return false
	}
}

type intercomIdentity struct {
	role           IntercomRole
	driverKey      string
	participantKey string
}

func withIntercomProviderTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), intercomProviderTimeout)
}
