package rtc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"frc.engineer/internal/signaling"
	"frc.engineer/internal/turncredentials"
	"github.com/pion/webrtc/v4"
)

const (
	turnOfferGate             = 3500 * time.Millisecond
	turnRetryCooldown         = 30 * time.Second
	maxTurnCredentialLifetime = 48 * time.Hour
)

// turnState keeps credential lifetimes and request correlation separate from
// PeerManager's peer map. All fields are guarded by mu. It never logs the
// server URLs or the short-lived username/credential.
type turnState struct {
	mu sync.Mutex

	staticICEServers  []webrtc.ICEServer
	runtimeICEServers []webrtc.ICEServer
	runtimeExpiresAt  time.Time
	source            string
	fallbackReason    string
	roomID            string

	generation    uint64
	requestSerial uint64
	requestID     string
	pending       bool
	disabled      bool
	nextRetryAt   time.Time
	gate          chan struct{}
	gateTimer     *time.Timer
	refreshTimer  *time.Timer
	expiryTimer   *time.Timer
}

func newTurnState(staticServers []webrtc.ICEServer) turnState {
	return turnState{
		staticICEServers: cloneICEServers(staticServers),
		source:           "fallback",
		fallbackReason:   "disabled",
	}
}

func (t *turnState) setStaticICEServers(servers []webrtc.ICEServer) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(servers) == 0 {
		t.staticICEServers = cloneICEServers(defaultICEServers)
		return
	}
	t.staticICEServers = cloneICEServers(servers)
}

// activateRoom invalidates requests issued by a previous WebSocket generation.
// Credentials can survive a transient signaling reconnect only when it is the
// same room and has not expired.
func (t *turnState) activateRoom(roomID string, retainSameRoom bool) (expiresAt time.Time, retained bool, generation uint64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.generation++
	t.finishGateLocked()
	if t.gateTimer != nil {
		t.gateTimer.Stop()
		t.gateTimer = nil
	}
	t.pending = false
	t.disabled = false
	t.nextRetryAt = time.Time{}
	t.requestID = ""
	if t.refreshTimer != nil {
		t.refreshTimer.Stop()
		t.refreshTimer = nil
	}
	if t.expiryTimer != nil {
		t.expiryTimer.Stop()
		t.expiryTimer = nil
	}
	if !retainSameRoom || roomID != t.roomID {
		t.runtimeICEServers = nil
		t.runtimeExpiresAt = time.Time{}
		t.source = "fallback"
		t.fallbackReason = "disabled"
	} else if t.runtimeValidLocked(time.Now()) {
		expiresAt = t.runtimeExpiresAt
		retained = true
	}
	t.roomID = roomID
	return expiresAt, retained, t.generation
}

func (t *turnState) close() {
	t.mu.Lock()
	t.generation++
	t.finishGateLocked()
	t.stopTimersLocked()
	t.pending = false
	t.disabled = false
	t.nextRetryAt = time.Time{}
	t.requestID = ""
	t.runtimeICEServers = nil
	t.runtimeExpiresAt = time.Time{}
	t.source = "fallback"
	t.fallbackReason = "disabled"
	t.mu.Unlock()
}

func (t *turnState) stopTimersLocked() {
	if t.gateTimer != nil {
		t.gateTimer.Stop()
		t.gateTimer = nil
	}
	if t.refreshTimer != nil {
		t.refreshTimer.Stop()
		t.refreshTimer = nil
	}
	if t.expiryTimer != nil {
		t.expiryTimer.Stop()
		t.expiryTimer = nil
	}
}

func (t *turnState) finishGateLocked() {
	if t.gate != nil {
		close(t.gate)
		t.gate = nil
	}
}

func (t *turnState) runtimeValidLocked(now time.Time) bool {
	if len(t.runtimeICEServers) > 0 && t.runtimeExpiresAt.After(now) {
		return true
	}
	if len(t.runtimeICEServers) > 0 {
		t.runtimeICEServers = nil
		t.runtimeExpiresAt = time.Time{}
		t.source = "fallback"
		if t.fallbackReason == "" {
			t.fallbackReason = "temporarily_unavailable"
		}
	}
	return false
}

func (t *turnState) activeConfiguration() (servers []webrtc.ICEServer, source string, expiresAt time.Time, reason string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.runtimeValidLocked(time.Now()) {
		return cloneICEServers(t.runtimeICEServers), "cloudflare", t.runtimeExpiresAt, ""
	}
	return cloneICEServers(t.staticICEServers), "fallback", time.Time{}, t.fallbackReason
}

func (t *turnState) diagnostics() (source string, expiresAt time.Time, reason string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.runtimeValidLocked(time.Now()) {
		return "cloudflare", t.runtimeExpiresAt, ""
	}
	return "fallback", time.Time{}, t.fallbackReason
}

// request starts a correlated request unless usable runtime credentials already
// exist. It returns a channel that closes on response/fallback/timeout; callers
// must wait outside the signaling read loop.
func (pm *PeerManager) requestTurnCredentials(force bool) <-chan struct{} {
	return pm.requestTurnCredentialsForGeneration(force, pm.turn.currentGeneration())
}

// requestTurnCredentialsForGeneration makes the generation check and request
// claim under the same lock. Timer callbacks from an old room therefore cannot
// become the pending request for a newly activated room.
func (pm *PeerManager) requestTurnCredentialsForGeneration(force bool, expectedGeneration uint64) <-chan struct{} {
	pm.turn.mu.Lock()
	if pm.turn.generation != expectedGeneration {
		pm.turn.mu.Unlock()
		return nil
	}
	if pm.turn.disabled {
		pm.turn.mu.Unlock()
		return nil
	}
	now := time.Now()
	if !force && pm.turn.runtimeValidLocked(now) {
		pm.turn.mu.Unlock()
		return nil
	}
	if !force && now.Before(pm.turn.nextRetryAt) {
		pm.turn.mu.Unlock()
		return nil
	}
	if pm.turn.pending {
		gate := pm.turn.gate
		pm.turn.mu.Unlock()
		return gate
	}

	pm.turn.requestSerial++
	requestID := fmt.Sprintf("turn-%d-%d", pm.turn.generation, pm.turn.requestSerial)
	pm.turn.requestID = requestID
	pm.turn.pending = true
	pm.turn.gate = make(chan struct{})
	gate := pm.turn.gate
	pm.turn.gateTimer = time.AfterFunc(turnOfferGate, func() {
		pm.finishTurnTimeout(requestID)
	})
	conn := pm.currentReadySignalingConnection()
	pm.turn.mu.Unlock()

	if conn != nil {
		pm.sendSignalingOn(conn, signaling.Message{
			Type:      signaling.TypeTurnCredentialsRequest,
			RequestID: requestID,
		})
	}
	return gate
}

func (pm *PeerManager) activateTurnRoom(roomID string) uint64 {
	return pm.activateTurnRoomLifecycle(roomID, true)
}

func (pm *PeerManager) activateFreshTurnRoom(roomID string) uint64 {
	return pm.activateTurnRoomLifecycle(roomID, false)
}

func (pm *PeerManager) activateTurnRoomLifecycle(roomID string, retainSameRoom bool) uint64 {
	// Clear old offer waiters before closing their TURN gate so they cannot wake
	// and create a peer under the newly activated room generation.
	pm.mu.Lock()
	clear(pm.pendingPeers)
	clear(pm.pendingRemoteCandidates)
	pm.mu.Unlock()
	expiresAt, retained, generation := pm.turn.activateRoom(roomID, retainSameRoom)
	if retained {
		pm.scheduleTurnRefresh(expiresAt, generation)
		pm.scheduleTurnExpiry(expiresAt, generation)
	}
	return generation
}

func (pm *PeerManager) scheduleTurnRefresh(expiresAt time.Time, generation uint64) {
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	if pm.turn.generation != generation || !pm.turn.runtimeValidLocked(time.Now()) {
		return
	}
	if pm.turn.refreshTimer != nil {
		pm.turn.refreshTimer.Stop()
	}
	pm.turn.refreshTimer = pm.newTurnRefreshTimer(expiresAt, generation)
}

func (pm *PeerManager) newTurnRefreshTimer(expiresAt time.Time, generation uint64) *time.Timer {
	refreshIn := turnRefreshDelay(expiresAt, time.Now())
	return time.AfterFunc(refreshIn, func() {
		pm.requestTurnCredentialsForGeneration(true, generation)
	})
}

func turnRefreshDelay(expiresAt, now time.Time) time.Duration {
	remaining := expiresAt.Sub(now)
	if remaining <= 0 {
		return 0
	}
	return remaining * 4 / 5
}

func (pm *PeerManager) scheduleTurnExpiry(expiresAt time.Time, generation uint64) {
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	if pm.turn.generation != generation || !pm.turn.runtimeValidLocked(time.Now()) {
		return
	}
	if pm.turn.expiryTimer != nil {
		pm.turn.expiryTimer.Stop()
	}
	pm.turn.expiryTimer = pm.newTurnExpiryTimer(expiresAt, generation)
}

func (pm *PeerManager) newTurnExpiryTimer(expiresAt time.Time, generation uint64) *time.Timer {
	expiresIn := time.Until(expiresAt)
	if expiresIn < 0 {
		expiresIn = 0
	}
	return time.AfterFunc(expiresIn, func() {
		pm.expireTurnCredentials(expiresAt, generation)
	})
}

func (pm *PeerManager) expireTurnCredentials(expiresAt time.Time, generation uint64) {
	pm.turn.mu.Lock()
	if pm.turn.generation != generation || !pm.turn.runtimeExpiresAt.Equal(expiresAt) {
		pm.turn.mu.Unlock()
		return
	}
	if time.Now().Before(expiresAt) {
		pm.turn.expiryTimer = pm.newTurnExpiryTimer(expiresAt, generation)
		pm.turn.mu.Unlock()
		return
	}
	pm.turn.runtimeValidLocked(time.Now())
	pm.turn.expiryTimer = nil
	reason := pm.turn.fallbackReason
	pm.turn.mu.Unlock()

	pm.applyICEConfigurationToPeers()
	pm.logger.Info("runtime TURN credentials expired", "source", "fallback", "reason", reason)
}

func (pm *PeerManager) finishTurnTimeout(requestID string) {
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	if pm.turn.requestID != requestID || !pm.turn.pending {
		return
	}
	pm.turn.pending = false
	pm.turn.gateTimer = nil
	pm.turn.fallbackReason = "temporarily_unavailable"
	if !pm.turn.runtimeValidLocked(time.Now()) {
		pm.turn.source = "fallback"
	}
	pm.scheduleTurnRetryLocked()
	pm.turn.finishGateLocked()
}

func (pm *PeerManager) finishTurnFallback(requestID, reason string) {
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	if requestID == "" || pm.turn.requestID != requestID {
		return
	}
	pm.turn.pending = false
	if reason == "disabled" {
		pm.turn.disabled = true
	}
	pm.turn.fallbackReason = reason
	if pm.turn.gateTimer != nil {
		pm.turn.gateTimer.Stop()
		pm.turn.gateTimer = nil
	}
	if !pm.turn.runtimeValidLocked(time.Now()) {
		pm.turn.source = "fallback"
	}
	if reason != "disabled" {
		pm.scheduleTurnRetryLocked()
	}
	pm.turn.finishGateLocked()
}

// scheduleTurnRetryLocked retries a failed refresh after the signaling
// server's matching provider cooldown. The caller must hold pm.turn.mu.
func (pm *PeerManager) scheduleTurnRetryLocked() {
	if pm.turn.disabled {
		return
	}
	if pm.turn.refreshTimer != nil {
		pm.turn.refreshTimer.Stop()
	}
	generation := pm.turn.generation
	pm.turn.nextRetryAt = time.Now().Add(turnRetryCooldown)
	pm.turn.refreshTimer = time.AfterFunc(turnRetryCooldown, func() {
		pm.turn.mu.Lock()
		if pm.turn.generation != generation || pm.turn.disabled {
			pm.turn.mu.Unlock()
			return
		}
		pm.turn.refreshTimer = nil
		pm.turn.nextRetryAt = time.Time{}
		pm.turn.mu.Unlock()
		pm.requestTurnCredentialsForGeneration(true, generation)
	})
}

func (pm *PeerManager) finishTurnSuccess(requestID string, servers []webrtc.ICEServer, expiresAt time.Time) {
	pm.turn.mu.Lock()
	if requestID == "" || pm.turn.requestID != requestID {
		pm.turn.mu.Unlock()
		return
	}
	pm.turn.runtimeICEServers = cloneICEServers(servers)
	pm.turn.runtimeExpiresAt = expiresAt
	pm.turn.source = "cloudflare"
	pm.turn.fallbackReason = ""
	pm.turn.nextRetryAt = time.Time{}
	pm.turn.pending = false
	if pm.turn.gateTimer != nil {
		pm.turn.gateTimer.Stop()
		pm.turn.gateTimer = nil
	}
	pm.turn.finishGateLocked()
	if pm.turn.refreshTimer != nil {
		pm.turn.refreshTimer.Stop()
	}
	if pm.turn.expiryTimer != nil {
		pm.turn.expiryTimer.Stop()
	}
	roomGeneration := pm.turn.generation
	pm.turn.refreshTimer = pm.newTurnRefreshTimer(expiresAt, roomGeneration)
	pm.turn.expiryTimer = pm.newTurnExpiryTimer(expiresAt, roomGeneration)
	pm.turn.mu.Unlock()

	pm.applyICEConfigurationToPeers()
	pm.logger.Info("runtime TURN credentials applied", "source", "cloudflare", "expiresAt", expiresAt)
}

func (t *turnState) currentGeneration() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.generation
}

func (t *turnState) generationCurrent(generation uint64) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.generation == generation
}

func (pm *PeerManager) handleTurnCredentials(msg signaling.Message) {
	payload, servers, expiresAt, reason, ok := decodeTurnCredentials(msg.Payload)
	if !ok {
		pm.finishTurnFallback(msg.RequestID, "temporarily_unavailable")
		return
	}
	if payload.Source == "fallback" {
		pm.finishTurnFallback(msg.RequestID, reason)
		pm.logger.Info("runtime TURN credentials unavailable", "source", "fallback", "reason", reason)
		return
	}
	pm.finishTurnSuccess(msg.RequestID, servers, expiresAt)
}

func (pm *PeerManager) handleTurnRequestError(message string) {
	if message != "unknown message type: "+signaling.TypeTurnCredentialsRequest {
		return
	}
	pm.turn.mu.Lock()
	requestID := pm.turn.requestID
	pending := pm.turn.pending
	pm.turn.mu.Unlock()
	if pending {
		pm.finishTurnFallback(requestID, "disabled")
		pm.logger.Info("runtime TURN credentials unsupported by signaling server", "source", "fallback", "reason", "disabled")
	}
}

// decodeTurnCredentials is strict because a signaling peer is not trusted to
// provide arbitrary WebRTC configuration. It returns no URL/credential detail
// in errors or diagnostics.
func decodeTurnCredentials(raw json.RawMessage) (signaling.TurnCredentialsPayload, []webrtc.ICEServer, time.Time, string, bool) {
	var payload signaling.TurnCredentialsPayload
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
	}

	switch payload.Source {
	case "fallback":
		if (payload.Reason != "disabled" && payload.Reason != "temporarily_unavailable") || len(payload.ICEServers) != 0 || payload.ExpiresAt != nil {
			return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
		}
		return payload, nil, time.Time{}, payload.Reason, true
	case "cloudflare":
		if payload.Reason != "" || payload.ExpiresAt == nil {
			return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
		}
		now := time.Now()
		expiresAt := *payload.ExpiresAt
		if !expiresAt.After(now) || expiresAt.Sub(now) > maxTurnCredentialLifetime {
			return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
		}
		validated, err := turncredentials.ValidateICEServers(payload.ICEServers)
		if err != nil {
			return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
		}
		servers := make([]webrtc.ICEServer, 0, len(validated))
		for _, server := range validated {
			servers = append(servers, webrtc.ICEServer{
				URLs:       append([]string(nil), server.URLs...),
				Username:   server.Username,
				Credential: server.Credential,
			})
		}
		return payload, servers, expiresAt, "", true
	default:
		return signaling.TurnCredentialsPayload{}, nil, time.Time{}, "", false
	}
}

func (pm *PeerManager) applyICEConfigurationToPeers() {
	servers, source, expiresAt, reason := pm.turn.activeConfiguration()
	pm.mu.RLock()
	peers := make([]struct {
		id string
		pc *webrtc.PeerConnection
	}, 0, len(pm.peers))
	for id, pc := range pm.peers {
		peers = append(peers, struct {
			id string
			pc *webrtc.PeerConnection
		}{id: id, pc: pc})
	}
	pm.mu.RUnlock()
	for _, peer := range peers {
		if err := peer.pc.SetConfiguration(webrtc.Configuration{ICEServers: cloneICEServers(servers)}); err != nil {
			// Do not attach err: a WebRTC implementation may format rejected ICE
			// input into it, while diagnostics are restricted to safe metadata.
			pm.logger.Warn("failed to update peer ICE configuration", "peerId", peer.id, "source", source, "expiresAt", expiresAt, "fallbackReason", reason)
		}
	}
}

func (pm *PeerManager) applyCurrentICEConfiguration(pc *webrtc.PeerConnection, peerID string) {
	servers, source, expiresAt, reason := pm.turn.activeConfiguration()
	if err := pc.SetConfiguration(webrtc.Configuration{ICEServers: cloneICEServers(servers)}); err != nil {
		pm.logger.Warn("failed to update peer ICE configuration", "peerId", peerID, "source", source, "expiresAt", expiresAt, "fallbackReason", reason)
	}
}
