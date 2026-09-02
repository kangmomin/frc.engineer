package signaling

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"frc.engineer/internal/turncredentials"
	"github.com/gorilla/websocket"
)

func TestTurnCredentialsRequireCurrentRoomPeer(t *testing.T) {
	rm, room, current := newTurnTestRoom(t)
	provider := &fakeTurnProvider{}
	rm.SetTurnCredentialsProvider(provider)

	stale := &peer{role: roleEngineer, roomID: room.ID, id: current.id}
	_, _, active := rm.turnCredentialsForPeer(stale)
	if active {
		t.Fatal("stale re-bound peer was authorized")
	}
	if got := provider.calls.Load(); got != 0 {
		t.Fatalf("provider calls = %d, want 0", got)
	}

	room.mu.Lock()
	delete(room.Engineers, current.id)
	room.mu.Unlock()
	_, _, active = rm.turnCredentialsForPeer(current)
	if active {
		t.Fatal("removed peer was authorized")
	}
	if got := provider.calls.Load(); got != 0 {
		t.Fatalf("provider calls = %d after removal, want 0", got)
	}
}

func TestRoomMetadataUpdateRequiresCurrentDriver(t *testing.T) {
	rm, room, _ := newTurnTestRoom(t)
	current := room.Driver
	room.Code = "1234"

	if code, err := rm.updateRoomMetadataForPeer(current, "Current", "password"); err != nil || code != "1234" {
		t.Fatalf("current driver update = code %q, err %v", code, err)
	}

	replacement := &peer{role: roleDriver, roomID: room.ID}
	room.mu.Lock()
	room.Driver = replacement
	room.mu.Unlock()
	if _, err := rm.updateRoomMetadataForPeer(current, "Stale", "changed"); err == nil {
		t.Fatal("replaced driver updated room metadata")
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.Name != "Current" || room.Password != "password" {
		t.Fatalf("stale update mutated room: name=%q password=%q", room.Name, room.Password)
	}
}

func TestNegotiationIDJSONContractIsBackwardCompatible(t *testing.T) {
	encoded, err := json.Marshal(Message{Type: TypeOffer, NegotiationID: 42})
	if err != nil {
		t.Fatal(err)
	}
	var decoded Message
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.NegotiationID != 42 {
		t.Fatalf("negotiationId = %d, want 42", decoded.NegotiationID)
	}

	legacy, err := json.Marshal(Message{Type: TypeOffer})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(legacy), "negotiationId") {
		t.Fatalf("legacy zero negotiationId was not omitted: %s", legacy)
	}
}

func TestJoinRoomRetriesNotificationAfterDriverReplacement(t *testing.T) {
	rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
	t.Cleanup(rm.Stop)
	oldServerConn, _ := openSignalingPair(t)
	replacementServerConn, replacementClientConn := openSignalingPair(t)
	oldWriteMu := &sync.Mutex{}
	oldWriteMu.Lock()
	oldDriver := &peer{
		conn: oldServerConn, role: roleDriver, roomID: "room-join-race", roomCode: "1234", writeMu: oldWriteMu,
	}
	replacement := &peer{
		conn: replacementServerConn, role: roleDriver, roomID: "room-join-race", roomCode: "1234", writeMu: &sync.Mutex{},
	}
	room := &Room{
		ID: "room-join-race", Code: "1234", Name: "Race Room", Driver: oldDriver,
		Engineers: make(map[string]*peer), turnCredentials: make(map[string]*turnCredentialState),
	}
	rm.mu.Lock()
	rm.roomsByID[room.ID] = room
	rm.roomsByCode[room.Code] = room
	rm.mu.Unlock()

	type joinResult struct {
		peerID string
		err    error
	}
	result := make(chan joinResult, 1)
	go func() {
		peerID, _, err := rm.JoinRoom(room.ID, "", "", nil, &sync.Mutex{})
		result <- joinResult{peerID: peerID, err: err}
	}()

	deadline := time.Now().Add(time.Second)
	for {
		room.mu.Lock()
		registered := len(room.Engineers) == 1
		room.mu.Unlock()
		if registered {
			break
		}
		if time.Now().After(deadline) {
			oldWriteMu.Unlock()
			t.Fatal("engineer was not registered before driver replacement")
		}
		time.Sleep(time.Millisecond)
	}

	room.mu.Lock()
	oldDriver.inactive.Store(true)
	room.Driver = replacement
	room.mu.Unlock()
	oldWriteMu.Unlock()

	select {
	case joined := <-result:
		if joined.err != nil || joined.peerID == "" {
			t.Fatalf("join after driver replacement = peer %q, err %v", joined.peerID, joined.err)
		}
		room.mu.Lock()
		_, active := room.Engineers[joined.peerID]
		room.mu.Unlock()
		if !active {
			t.Fatal("successful replacement notification removed the engineer")
		}
	case <-time.After(time.Second):
		t.Fatal("join did not finish after driver replacement")
	}

	replacementClientConn.SetReadDeadline(time.Now().Add(time.Second))
	var notification Message
	if err := replacementClientConn.ReadJSON(&notification); err != nil {
		t.Fatal(err)
	}
	if notification.Type != TypePeerJoined || notification.PeerID == "" {
		t.Fatalf("replacement notification = %+v", notification)
	}
}

func TestCreateRoomReuseReplaysEngineerMembership(t *testing.T) {
	rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
	t.Cleanup(rm.Stop)
	newDriverConn, newDriverClient := openSignalingPair(t)
	engineer := &peer{role: roleEngineer, roomID: "room-reuse", id: "engineer-reuse"}
	room := &Room{
		ID: "room-reuse", Code: "4321", OwnerToken: "fake-owner-token",
		Driver:    &peer{role: roleDriver, roomID: "room-reuse"},
		Engineers: map[string]*peer{engineer.id: engineer}, turnCredentials: make(map[string]*turnCredentialState),
	}
	rm.mu.Lock()
	rm.roomsByID[room.ID] = room
	rm.roomsByCode[room.Code] = room
	rm.mu.Unlock()

	roomID, _, _, err := rm.CreateRoom(newDriverConn, &sync.Mutex{}, room.ID, "Reused", "", room.OwnerToken)
	if err != nil || roomID != room.ID {
		t.Fatalf("room reuse = room %q, err %v", roomID, err)
	}
	newDriverClient.SetReadDeadline(time.Now().Add(time.Second))
	var message Message
	if err := newDriverClient.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	if message.Type != TypePeerJoined || message.PeerID != engineer.id {
		t.Fatalf("replayed message = %+v", message)
	}
}

func TestReplayEngineerJoinCompensatesConcurrentRemoval(t *testing.T) {
	rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
	t.Cleanup(rm.Stop)
	driverConn, driverClient := openSignalingPair(t)
	driver := &peer{conn: driverConn, role: roleDriver, roomID: "room-replay", roomCode: "2468", writeMu: &sync.Mutex{}}
	removedEngineer := &peer{role: roleEngineer, roomID: driver.roomID, id: "engineer-removed"}
	room := &Room{ID: driver.roomID, Code: driver.roomCode, Driver: driver, Engineers: make(map[string]*peer)}

	rm.replayEngineerJoins(room, driver, []*peer{removedEngineer})
	driverClient.SetReadDeadline(time.Now().Add(time.Second))
	for _, wantType := range []string{TypePeerJoined, TypePeerLeft} {
		var message Message
		if err := driverClient.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		if message.Type != wantType || message.PeerID != removedEngineer.id {
			t.Fatalf("replay compensation = %+v, want type %s peer %s", message, wantType, removedEngineer.id)
		}
	}
}

func TestTurnCredentialsWebSocketContractAndUnauthenticatedRequest(t *testing.T) {
	t.Run("authenticated request echoes request id", func(t *testing.T) {
		rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
		t.Cleanup(rm.Stop)
		provider := &fakeTurnProvider{}
		rm.SetTurnCredentialsProvider(provider)
		conn, done := serveSignalingMessages(t, rm, 2)
		defer conn.Close()

		if err := conn.WriteJSON(Message{Type: TypeRoomCreate}); err != nil {
			t.Fatal(err)
		}
		var created Message
		if err := conn.ReadJSON(&created); err != nil {
			t.Fatal(err)
		}
		if created.Type != TypeRoomCreated {
			t.Fatalf("room response = %+v", created)
		}

		if err := conn.WriteJSON(Message{Type: TypeTurnCredentialsRequest, RequestID: "request-42"}); err != nil {
			t.Fatal(err)
		}
		var response Message
		if err := conn.ReadJSON(&response); err != nil {
			t.Fatal(err)
		}
		if response.Type != TypeTurnCredentials || response.RequestID != "request-42" {
			t.Fatalf("TURN response = %+v", response)
		}
		var payload TurnCredentialsPayload
		if err := json.Unmarshal(response.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Source != "cloudflare" || payload.ExpiresAt == nil || len(payload.ICEServers) == 0 || payload.Reason != "" {
			t.Fatalf("payload = %+v", payload)
		}
		if got := provider.calls.Load(); got != 1 {
			t.Fatalf("provider calls = %d, want 1", got)
		}
		waitSignalingServer(t, done)
	})

	t.Run("request before room cannot call provider", func(t *testing.T) {
		rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
		t.Cleanup(rm.Stop)
		provider := &fakeTurnProvider{}
		rm.SetTurnCredentialsProvider(provider)
		conn, done := serveSignalingMessages(t, rm, 1)
		defer conn.Close()

		if err := conn.WriteJSON(Message{Type: TypeTurnCredentialsRequest, RequestID: "no-room"}); err != nil {
			t.Fatal(err)
		}
		var response Message
		if err := conn.ReadJSON(&response); err != nil {
			t.Fatal(err)
		}
		if response.Type != TypeError || response.Error != "not in a room" {
			t.Fatalf("response = %+v", response)
		}
		if got := provider.calls.Load(); got != 0 {
			t.Fatalf("provider calls = %d, want 0", got)
		}
		waitSignalingServer(t, done)
	})

	for _, test := range []struct {
		name      string
		requestID string
	}{
		{name: "empty request id", requestID: ""},
		{name: "blank request id", requestID: "  "},
		{name: "oversized request id", requestID: strings.Repeat("x", maxTurnRequestIDBytes+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
			t.Cleanup(rm.Stop)
			provider := &fakeTurnProvider{}
			rm.SetTurnCredentialsProvider(provider)
			conn, done := serveSignalingMessages(t, rm, 2)
			defer conn.Close()

			if err := conn.WriteJSON(Message{Type: TypeRoomCreate}); err != nil {
				t.Fatal(err)
			}
			var created Message
			if err := conn.ReadJSON(&created); err != nil {
				t.Fatal(err)
			}
			if created.Type != TypeRoomCreated {
				t.Fatalf("room response = %+v", created)
			}

			if err := conn.WriteJSON(Message{Type: TypeTurnCredentialsRequest, RequestID: test.requestID}); err != nil {
				t.Fatal(err)
			}
			var response Message
			if err := conn.ReadJSON(&response); err != nil {
				t.Fatal(err)
			}
			if response.Type != TypeError || response.Error != "invalid requestId" {
				t.Fatalf("response = %+v", response)
			}
			if got := provider.calls.Load(); got != 0 {
				t.Fatalf("provider calls = %d, want 0", got)
			}
			waitSignalingServer(t, done)
		})
	}
}

func TestTurnCredentialsCacheSingleFlightPerParticipant(t *testing.T) {
	rm, room, engineer := newTurnTestRoom(t)
	driver := room.Driver
	provider := &fakeTurnProvider{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	rm.SetTurnCredentialsProvider(provider)

	type result struct {
		payload TurnCredentialsPayload
		active  bool
	}
	results := make(chan result, 2)
	go func() {
		payload, _, active := rm.turnCredentialsForPeer(engineer)
		results <- result{payload: payload, active: active}
	}()
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	go func() {
		payload, _, active := rm.turnCredentialsForPeer(engineer)
		results <- result{payload: payload, active: active}
	}()

	time.Sleep(20 * time.Millisecond)
	if got := provider.calls.Load(); got != 1 {
		t.Fatalf("concurrent provider calls = %d, want 1", got)
	}
	close(provider.release)
	for range 2 {
		result := <-results
		if !result.active || result.payload.Source != "cloudflare" || result.payload.ExpiresAt == nil {
			t.Fatalf("unexpected payload: %+v, active=%v", result.payload, result.active)
		}
	}

	// Before the 80% refresh watermark, the same participant receives its cached
	// credential without another provider request.
	payload, _, active := rm.turnCredentialsForPeer(engineer)
	if !active || payload.Source != "cloudflare" || provider.calls.Load() != 1 {
		t.Fatalf("cache payload=%+v active=%v calls=%d", payload, active, provider.calls.Load())
	}

	// A different participant gets a different short-lived issuance rather than
	// sharing the engineer's credential cache entry.
	payload, _, active = rm.turnCredentialsForPeer(driver)
	if !active || payload.Source != "cloudflare" || provider.calls.Load() != 2 {
		t.Fatalf("driver payload=%+v active=%v calls=%d", payload, active, provider.calls.Load())
	}
}

func TestTurnCredentialsFailureCooldownPerParticipant(t *testing.T) {
	rm, room, engineer := newTurnTestRoom(t)
	provider := &fakeTurnProvider{}
	rm.SetTurnCredentialsProvider(provider)

	payload, _, active := rm.turnCredentialsForPeer(engineer)
	if !active || payload.Source != "cloudflare" || provider.calls.Load() != 1 {
		t.Fatalf("initial payload=%+v active=%v calls=%d", payload, active, provider.calls.Load())
	}

	// Move past this participant's 80% watermark and make renewal fail. The valid
	// cached credential remains usable, then the 30s failure cooldown suppresses
	// repeated provider calls when it is no longer usable.
	room.mu.Lock()
	state := room.turnCredentials[turnParticipantKey(engineer)]
	state.refreshAfter = time.Now().Add(-time.Second)
	room.mu.Unlock()
	provider.setError(errors.New("fake provider failure"))
	payload, _, active = rm.turnCredentialsForPeer(engineer)
	if !active || payload.Source != "cloudflare" || provider.calls.Load() != 2 {
		t.Fatalf("valid credential was not retained on refresh failure: %+v calls=%d", payload, provider.calls.Load())
	}

	room.mu.Lock()
	state.credentials.ExpiresAt = time.Now().Add(-time.Second)
	room.mu.Unlock()
	payload, _, active = rm.turnCredentialsForPeer(engineer)
	if !active || payload.Source != "fallback" || payload.Reason != "temporarily_unavailable" {
		t.Fatalf("payload after expired failed refresh = %+v, active=%v", payload, active)
	}
	if got := provider.calls.Load(); got != 2 {
		t.Fatalf("provider calls during cooldown = %d, want 2", got)
	}
}

func TestTurnCredentialsRejectRoomRemovalDuringProviderCall(t *testing.T) {
	rm, room, engineer := newTurnTestRoom(t)
	provider := &fakeTurnProvider{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	rm.SetTurnCredentialsProvider(provider)

	result := make(chan bool, 1)
	go func() {
		_, _, active := rm.turnCredentialsForPeer(engineer)
		result <- active
	}()
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}

	rm.mu.Lock()
	delete(rm.roomsByID, room.ID)
	rm.mu.Unlock()
	close(provider.release)

	select {
	case active := <-result:
		if active {
			t.Fatal("removed room membership remained active after provider call")
		}
	case <-time.After(time.Second):
		t.Fatal("credential request did not finish")
	}
}

func newTurnTestRoom(t *testing.T) (*RoomManager, *Room, *peer) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	rm := NewRoomManager(logger, nil, nil, false)
	t.Cleanup(rm.Stop)
	driver := &peer{role: roleDriver, roomID: "room-1"}
	engineer := &peer{role: roleEngineer, roomID: "room-1", id: "engineer-1"}
	room := &Room{
		ID:              "room-1",
		Driver:          driver,
		Engineers:       map[string]*peer{engineer.id: engineer},
		turnCredentials: make(map[string]*turnCredentialState),
	}
	rm.mu.Lock()
	rm.roomsByID[room.ID] = room
	rm.mu.Unlock()
	return rm, room, engineer
}

func serveSignalingMessages(t *testing.T, rm *RoomManager, count int) (*websocket.Conn, <-chan error) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	done := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		writeMu := &sync.Mutex{}
		var current *ExportedPeer
		for i := 0; i < count; i++ {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				done <- err
				return
			}
			current = rm.HandleMessageExported(conn, raw, current, writeMu, "")
		}
		done <- nil
	}))
	t.Cleanup(server.Close)
	wsURL := "ws" + server.URL[len("http"):]
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn, done
}

func openSignalingPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	serverConn := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		serverConn <- conn
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	serverSide := <-serverConn
	t.Cleanup(func() {
		_ = client.Close()
		server.Close()
	})
	return serverSide, client
}

func waitSignalingServer(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("signaling test server did not finish")
	}
}

type fakeTurnProvider struct {
	calls   atomic.Int32
	started chan struct{}
	release chan struct{}
	once    sync.Once
	mu      sync.Mutex
	err     error
}

func (p *fakeTurnProvider) Generate(ctx context.Context) (turncredentials.Credentials, error) {
	p.calls.Add(1)
	if p.started != nil {
		p.once.Do(func() { close(p.started) })
	}
	if p.release != nil {
		select {
		case <-p.release:
		case <-ctx.Done():
			return turncredentials.Credentials{}, ctx.Err()
		}
	}
	p.mu.Lock()
	err := p.err
	p.mu.Unlock()
	if err != nil {
		return turncredentials.Credentials{}, err
	}
	now := time.Now()
	return turncredentials.Credentials{
		ICEServers: []turncredentials.ICEServer{
			{URLs: []string{"stun:stun.example.test:3478"}},
			{URLs: []string{"turn:turn.example.test:3478?transport=udp"}, Username: "test-user", Credential: "test-credential"},
		},
		IssuedAt:  now,
		ExpiresAt: now.Add(time.Minute),
	}, nil
}

func (p *fakeTurnProvider) setError(err error) {
	p.mu.Lock()
	p.err = err
	p.mu.Unlock()
}
