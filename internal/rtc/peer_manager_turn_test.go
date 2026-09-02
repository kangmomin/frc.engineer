package rtc

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/signaling"
	"frc.engineer/internal/turncredentials"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

func TestCanQueueDataChannelMessage(t *testing.T) {
	tests := []struct {
		name     string
		buffered uint64
		outgoing int
		want     bool
	}{
		{name: "exact 256kb message", outgoing: maxDataChannelMessageBytes, want: true},
		{name: "message over 256kb", outgoing: maxDataChannelMessageBytes + 1, want: false},
		{name: "exact 128kb buffered plus 128kb outgoing", buffered: maxBufferedAmount, outgoing: maxBufferedAmount, want: true},
		{name: "buffer already over 128kb", buffered: maxBufferedAmount + 1, outgoing: 1, want: false},
		{name: "combined over 256kb", buffered: maxBufferedAmount, outgoing: maxBufferedAmount + 1, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canQueueDataChannelMessage(test.buffered, test.outgoing); got != test.want {
				t.Fatalf("canQueueDataChannelMessage(%d, %d) = %v, want %v", test.buffered, test.outgoing, got, test.want)
			}
		})
	}
}

func TestReadRoomCreatedBuffersPeerEvents(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.WriteJSON(signaling.Message{Type: signaling.TypePeerJoined, PeerID: "peer-1"})
		_ = conn.WriteJSON(signaling.Message{Type: signaling.TypeRoomCreated, RoomID: "room-1", RoomCode: "1234"})
	}))
	defer server.Close()

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	ack, pending, err := readRoomCreated(conn)
	if err != nil {
		t.Fatal(err)
	}
	if ack.Type != signaling.TypeRoomCreated || ack.RoomID != "room-1" {
		t.Fatalf("ack = %+v", ack)
	}
	if len(pending) != 1 || pending[0].Type != signaling.TypePeerJoined || pending[0].PeerID != "peer-1" {
		t.Fatalf("pending = %+v", pending)
	}
}

func TestStaleReadLoopCannotReconnectOverNewSession(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	oldConn := new(websocket.Conn)
	newConn := new(websocket.Conn)
	oldDone := pm.done
	newDone := make(chan struct{})
	pm.sigMu.Lock()
	pm.sigConn = newConn
	pm.signalingReady = true
	pm.done = newDone
	pm.sigMu.Unlock()

	if pm.scheduleReconnect(oldConn, oldDone) {
		t.Fatal("stale read loop scheduled a reconnect for the new session")
	}
	pm.sigMu.Lock()
	current := pm.sigConn
	ready := pm.signalingReady
	reconnecting := pm.reconnecting
	pm.sigConn = nil
	pm.sigMu.Unlock()
	if current != newConn || !ready || reconnecting {
		t.Fatalf("new session changed: current=%v ready=%v reconnecting=%v", current == newConn, ready, reconnecting)
	}
	close(oldDone)
	pm.Close()
}

func TestStaleHandshakeCannotMutateNewSession(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	oldConn := new(websocket.Conn)
	newConn := new(websocket.Conn)
	oldDone := pm.done
	newDone := make(chan struct{})
	pm.sigMu.Lock()
	pm.sigConn = newConn
	pm.signalingReady = true
	pm.done = newDone
	pm.roomID = "current-room"
	pm.roomCode = "1234"
	pm.sigMu.Unlock()
	pm.activateFreshTurnRoom("current-room")
	turnGeneration := pm.turn.currentGeneration()

	pm.lifecycleMu.Lock()
	_, _, _, applied := pm.applyRoomAcknowledgementLocked(oldConn, oldDone, signaling.Message{
		Type:       signaling.TypeRoomCreated,
		RoomID:     "stale-room",
		RoomCode:   "9999",
		OwnerToken: "stale-owner",
	}, true)
	pm.lifecycleMu.Unlock()
	if applied {
		t.Fatal("stale handshake was applied to the new session")
	}
	pm.sigMu.Lock()
	roomID := pm.roomID
	roomCode := pm.roomCode
	ownerToken := pm.ownerToken
	pm.sigConn = nil
	pm.sigMu.Unlock()
	if roomID != "current-room" || roomCode != "1234" || ownerToken != "" {
		t.Fatalf("stale handshake mutated room state: room=%q code=%q owner=%q", roomID, roomCode, ownerToken)
	}
	if current := pm.turn.currentGeneration(); current != turnGeneration {
		t.Fatalf("stale handshake advanced TURN generation: got %d, want %d", current, turnGeneration)
	}
	close(oldDone)
	pm.Close()
}

func TestTurnRequestGenerationAndLateResponse(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pm.activateTurnRoom("room-a")
	gate := pm.requestTurnCredentials(false)
	requestID := turnRequestID(pm)
	if gate == nil || requestID == "" {
		t.Fatal("expected an initial correlated TURN request gate")
	}

	// A response from an old signaling/room generation must not override the
	// fallback configuration of the new room.
	pm.activateTurnRoom("room-b")
	pm.finishTurnSuccess(requestID, testRuntimeICEServers(), time.Now().Add(time.Minute))
	_, source, expiresAt, _ := pm.turn.activeConfiguration()
	if source != "fallback" || !expiresAt.IsZero() {
		t.Fatalf("stale response changed config: source=%s expires=%s", source, expiresAt)
	}

	currentGate := pm.requestTurnCredentials(false)
	currentID := turnRequestID(pm)
	pm.finishTurnSuccess(currentID, testRuntimeICEServers(), time.Now().Add(time.Minute))
	select {
	case <-currentGate:
	case <-time.After(time.Second):
		t.Fatal("current TURN response did not release offer gate")
	}
	_, source, expiresAt, reason := pm.turn.activeConfiguration()
	if source != "cloudflare" || expiresAt.IsZero() || reason != "" {
		t.Fatalf("current response was not applied safely: source=%s expires=%s reason=%q", source, expiresAt, reason)
	}
}

func TestDisabledTurnFallbackDoesNotRegateEveryPeer(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pm.activateTurnRoom("room-a")
	gate := pm.requestTurnCredentials(false)
	pm.finishTurnFallback(turnRequestID(pm), "disabled")
	select {
	case <-gate:
	case <-time.After(time.Second):
		t.Fatal("disabled fallback did not release offer gate")
	}
	if repeated := pm.requestTurnCredentials(false); repeated != nil {
		t.Fatal("known-disabled TURN support started another offer gate")
	}
}

func TestTemporaryTurnFallbackSchedulesBoundedRetry(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pm.activateTurnRoom("room-a")
	gate := pm.requestTurnCredentials(false)
	pm.finishTurnFallback(turnRequestID(pm), "temporarily_unavailable")
	select {
	case <-gate:
	case <-time.After(time.Second):
		t.Fatal("temporary fallback did not release offer gate")
	}
	pm.turn.mu.Lock()
	retryScheduled := pm.turn.refreshTimer != nil
	pm.turn.mu.Unlock()
	if !retryScheduled {
		t.Fatal("temporary fallback did not schedule a cooldown retry")
	}
}

func TestTemporaryTurnFallbackSuppressesEarlyRequests(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pm.activateTurnRoom("room-a")
	pm.requestTurnCredentials(false)
	pm.finishTurnFallback(turnRequestID(pm), "temporarily_unavailable")

	pm.turn.mu.Lock()
	requestSerial := pm.turn.requestSerial
	pm.turn.mu.Unlock()
	if gate := pm.requestTurnCredentials(false); gate != nil {
		t.Fatal("cooldown request unexpectedly created a new offer gate")
	}
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	if pm.turn.requestSerial != requestSerial {
		t.Fatalf("request serial advanced during cooldown: got %d, want %d", pm.turn.requestSerial, requestSerial)
	}
}

func TestMinimumTurnTTLRefreshesBeforeExpiry(t *testing.T) {
	now := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	expiresAt := now.Add(time.Second)
	delay := turnRefreshDelay(expiresAt, now)
	if delay != 800*time.Millisecond {
		t.Fatalf("minimum TTL refresh delay = %s, want 800ms", delay)
	}
	if delay >= expiresAt.Sub(now) {
		t.Fatalf("refresh delay %s is not before expiry %s", delay, expiresAt.Sub(now))
	}
}

func TestTurnGenerationRolloverInvalidatesOfferWaiters(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	oldGeneration := pm.activateTurnRoom("room-a")
	gate := pm.requestTurnCredentials(false)
	pm.mu.Lock()
	pm.pendingPeers["peer-1"] = 1
	pm.mu.Unlock()

	result := make(chan bool, 1)
	go func() { result <- pm.waitForTurnGate(gate, oldGeneration) }()
	pm.activateTurnRoom("room-a")

	select {
	case current := <-result:
		if current {
			t.Fatal("old TURN generation remained current")
		}
	case <-time.After(time.Second):
		t.Fatal("old TURN gate waiter was not released")
	}
	pm.mu.RLock()
	_, pending := pm.pendingPeers["peer-1"]
	pm.mu.RUnlock()
	if pending {
		t.Fatal("old pending peer survived TURN generation rollover")
	}
}

func TestStaleTurnTimerCannotClaimNewGenerationRequest(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	oldGeneration := pm.activateTurnRoom("room-a")
	pm.activateTurnRoom("room-b")

	if gate := pm.requestTurnCredentialsForGeneration(true, oldGeneration); gate != nil {
		t.Fatal("stale TURN timer created a request gate in the new generation")
	}
	pm.turn.mu.Lock()
	pending := pm.turn.pending
	requestSerial := pm.turn.requestSerial
	pm.turn.mu.Unlock()
	if pending || requestSerial != 0 {
		t.Fatalf("stale TURN timer claimed new generation: pending=%v serial=%d", pending, requestSerial)
	}

	if gate := pm.requestTurnCredentials(false); gate == nil {
		t.Fatal("stale TURN timer blocked the current generation request")
	}
}

func TestFreshRoomLifecycleClearsSameRoomRuntimeCredentials(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pm.activateTurnRoom("room-a")
	pm.turn.mu.Lock()
	pm.turn.runtimeICEServers = testRuntimeICEServers()
	pm.turn.runtimeExpiresAt = time.Now().Add(time.Hour)
	pm.turn.source = "cloudflare"
	pm.turn.fallbackReason = ""
	pm.turn.mu.Unlock()

	pm.activateFreshTurnRoom("room-a")
	servers, source, expiresAt, reason := pm.turn.activeConfiguration()
	if source != "fallback" || !expiresAt.IsZero() || reason != "disabled" {
		t.Fatalf("fresh same-ID room retained runtime credentials: source=%s expires=%s reason=%q", source, expiresAt, reason)
	}
	if len(servers) != len(defaultICEServers) {
		t.Fatalf("fresh room fallback servers = %d, want %d", len(servers), len(defaultICEServers))
	}
}

func TestExpiredRuntimeCredentialsApplyStaticFallback(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	expiresAt := time.Now().Add(-time.Millisecond)

	pm.turn.mu.Lock()
	pm.turn.generation = 1
	pm.turn.runtimeICEServers = testRuntimeICEServers()
	pm.turn.runtimeExpiresAt = expiresAt
	pm.turn.source = "cloudflare"
	pm.turn.fallbackReason = "temporarily_unavailable"
	pm.turn.mu.Unlock()

	pm.expireTurnCredentials(expiresAt, 1)
	_, source, activeExpiry, reason := pm.turn.activeConfiguration()
	if source != "fallback" || !activeExpiry.IsZero() || reason != "temporarily_unavailable" {
		t.Fatalf("expired runtime config = source %q expiry %s reason %q", source, activeExpiry, reason)
	}
}

func TestCandidateQueuesRespectOfferAndAnswerOrdering(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	pm.mu.Lock()
	pm.peers["peer-1"] = pc
	pm.peerMeta["peer-1"] = &peerMeta{}
	pm.mu.Unlock()

	remoteCandidate, err := json.Marshal(webrtc.ICECandidateInit{
		Candidate:     "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
		SDPMid:        stringPtr("0"),
		SDPMLineIndex: uint16Ptr(0),
	})
	if err != nil {
		t.Fatal(err)
	}
	pm.handleICECandidate("peer-1", 0, remoteCandidate)
	pm.queueOrSendLocalCandidate("peer-1", pc, json.RawMessage(`{"candidate":"candidate:2"}`))

	pm.mu.RLock()
	meta := pm.peerMeta["peer-1"]
	remoteQueued := len(meta.pendingRemoteCandidates)
	localQueued := len(meta.pendingLocalCandidates)
	pm.mu.RUnlock()
	if remoteQueued != 1 || localQueued != 1 {
		t.Fatalf("candidate queues = remote %d, local %d; want 1, 1", remoteQueued, localQueued)
	}

	sigConn, signalingMessages := openRecordingSignaling(t)
	pm.sigMu.Lock()
	pm.sigConn = sigConn
	pm.signalingReady = true
	pm.sigMu.Unlock()
	pm.markOfferSent("peer-1", pc, 0)
	select {
	case message := <-signalingMessages:
		if message.Type != signaling.TypeICECandidate || message.PeerID != "peer-1" {
			t.Fatalf("signaling message = %+v", message)
		}
	case <-time.After(time.Second):
		t.Fatal("queued local candidate was not flushed after offer")
	}
	pm.mu.RLock()
	localQueued = len(pm.peerMeta["peer-1"].pendingLocalCandidates)
	pm.mu.RUnlock()
	if localQueued != 0 {
		t.Fatalf("local candidates were not released after offer: %d", localQueued)
	}
}

func openRecordingSignaling(t *testing.T) (*websocket.Conn, <-chan signaling.Message) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	messages := make(chan signaling.Message, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var message signaling.Message
			if err := conn.ReadJSON(&message); err != nil {
				return
			}
			messages <- message
		}
	}))
	t.Cleanup(server.Close)

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn, messages
}

func TestCandidateQueueOverflowDropsPeer(t *testing.T) {
	tests := []struct {
		name  string
		queue func(*PeerManager, string, *webrtc.PeerConnection)
	}{
		{
			name: "local",
			queue: func(pm *PeerManager, peerID string, pc *webrtc.PeerConnection) {
				pm.queueOrSendLocalCandidate(peerID, pc, json.RawMessage(`{"candidate":"candidate:1"}`))
			},
		},
		{
			name: "remote",
			queue: func(pm *PeerManager, peerID string, _ *webrtc.PeerConnection) {
				pm.handleICECandidate(peerID, 0, json.RawMessage(`{"candidate":"candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host","sdpMid":"0","sdpMLineIndex":0}`))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
			defer pm.Close()
			pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
			if err != nil {
				t.Fatal(err)
			}
			const peerID = "peer-overflow"
			pm.mu.Lock()
			pm.peers[peerID] = pc
			pm.peerMeta[peerID] = &peerMeta{}
			pm.mu.Unlock()

			for range maxPendingICECandidates + 1 {
				test.queue(pm, peerID, pc)
			}

			deadline := time.Now().Add(time.Second)
			for {
				pm.mu.RLock()
				_, exists := pm.peers[peerID]
				pm.mu.RUnlock()
				if !exists {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("peer was not removed after candidate queue overflow")
				}
				time.Sleep(time.Millisecond)
			}
		})
	}
}

func TestNegotiationIdentityRejectsStaleCandidates(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	const peerID = "peer-generation"
	pm.mu.Lock()
	pm.peers[peerID] = pc
	pm.peerMeta[peerID] = &peerMeta{negotiationGeneration: 7, generationAware: true}
	pm.mu.Unlock()
	candidate := json.RawMessage(`{"candidate":"candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host","sdpMid":"0","sdpMLineIndex":0}`)

	pm.handleICECandidate(peerID, 6, candidate)
	pm.handleICECandidate(peerID, 0, candidate)
	pm.mu.RLock()
	queued := len(pm.peerMeta[peerID].pendingRemoteCandidates)
	pm.mu.RUnlock()
	if queued != 0 {
		t.Fatalf("stale candidates queued = %d, want 0", queued)
	}

	pm.handleICECandidate(peerID, 7, candidate)
	pm.mu.RLock()
	queued = len(pm.peerMeta[peerID].pendingRemoteCandidates)
	pm.mu.RUnlock()
	if queued != 1 {
		t.Fatalf("current candidate queue = %d, want 1", queued)
	}
}

func TestCandidateBeforePeerCreationIsBoundedAndReplayedByGeneration(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	const peerID = "peer-precreate"
	pm.mu.Lock()
	pm.pendingPeers[peerID] = 1
	pm.mu.Unlock()
	candidate := json.RawMessage(`{"candidate":"candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host","sdpMid":"0","sdpMLineIndex":0}`)
	pm.handleICECandidate(peerID, 9, candidate)

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	pm.mu.Lock()
	preCandidates := append([]pendingRemoteCandidate(nil), pm.pendingRemoteCandidates[peerID]...)
	pm.peers[peerID] = pc
	pm.peerMeta[peerID] = &peerMeta{negotiationGeneration: 9}
	pm.mu.Unlock()
	pm.queuePrePeerCandidates(peerID, pc, 9, preCandidates)

	pm.mu.RLock()
	meta := pm.peerMeta[peerID]
	queued := len(meta.pendingRemoteCandidates)
	aware := meta.generationAware
	pm.mu.RUnlock()
	if queued != 1 || !aware {
		t.Fatalf("pre-peer replay queued=%d generationAware=%v, want 1/true", queued, aware)
	}
}

func TestRemovePeerIfPreservesReplacement(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	oldPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	const peerID = "peer-replaced"
	pm.mu.Lock()
	pm.peers[peerID] = replacement
	pm.peerMeta[peerID] = &peerMeta{}
	pm.mu.Unlock()

	pm.removePeerIf(peerID, oldPC)
	pm.mu.RLock()
	current := pm.peers[peerID]
	pm.mu.RUnlock()
	if current != replacement {
		t.Fatal("stale cleanup removed the replacement peer")
	}
	_ = oldPC.Close()
}

func TestStaleRestartTimerPreservesCurrentRestart(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	oldPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	const peerID = "peer-restart-replaced"
	oldStartedAt := time.Now()
	oldMeta := &peerMeta{restartingAt: oldStartedAt}
	currentTimer := time.NewTimer(time.Hour)
	currentMeta := &peerMeta{restartingAt: oldStartedAt.Add(time.Second), restartTimer: currentTimer}
	pm.mu.Lock()
	pm.peers[peerID] = replacement
	pm.peerMeta[peerID] = currentMeta
	pm.mu.Unlock()

	staleTimer := time.NewTimer(time.Hour)
	pm.installRestartTimer(peerID, oldPC, oldMeta, oldStartedAt, staleTimer)
	pm.mu.RLock()
	installed := pm.peerMeta[peerID].restartTimer
	pm.mu.RUnlock()
	if installed != currentTimer {
		t.Fatal("stale restart replaced the current peer's timeout")
	}
	if staleTimer.Stop() {
		t.Fatal("stale restart timer was left active")
	}
	_ = oldPC.Close()
}

func TestStaleRestartTimerPreservesNewerAttempt(t *testing.T) {
	pm := NewPeerManager("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer pm.Close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	const peerID = "peer-restart-superseded"
	oldStartedAt := time.Now()
	currentTimer := time.NewTimer(time.Hour)
	meta := &peerMeta{restartingAt: oldStartedAt.Add(time.Second), restartTimer: currentTimer}
	pm.mu.Lock()
	pm.peers[peerID] = pc
	pm.peerMeta[peerID] = meta
	pm.mu.Unlock()

	staleTimer := time.NewTimer(time.Hour)
	pm.installRestartTimer(peerID, pc, meta, oldStartedAt, staleTimer)
	pm.mu.RLock()
	installed := pm.peerMeta[peerID].restartTimer
	pm.mu.RUnlock()
	if installed != currentTimer {
		t.Fatal("stale restart replaced the newer attempt's timeout")
	}
	if staleTimer.Stop() {
		t.Fatal("superseded restart timer was left active")
	}
	pm.removePeerAfterRestartTimeout(peerID, pc, meta, oldStartedAt)
	pm.mu.RLock()
	current := pm.peers[peerID]
	pm.mu.RUnlock()
	if current != pc {
		t.Fatal("started callback from a stale restart removed the newer attempt")
	}
}

func turnRequestID(pm *PeerManager) string {
	pm.turn.mu.Lock()
	defer pm.turn.mu.Unlock()
	return pm.turn.requestID
}

func testRuntimeICEServers() []webrtc.ICEServer {
	servers := []turncredentials.ICEServer{
		{URLs: []string{"stun:stun.example.test:3478"}},
		{URLs: []string{"turn:turn.example.test:3478?transport=udp"}, Username: "test-user", Credential: "test-credential"},
	}
	result := make([]webrtc.ICEServer, 0, len(servers))
	for _, server := range servers {
		result = append(result, webrtc.ICEServer{URLs: server.URLs, Username: server.Username, Credential: server.Credential})
	}
	return result
}

func stringPtr(value string) *string { return &value }

func uint16Ptr(value uint16) *uint16 { return &value }
