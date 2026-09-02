package rtc

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/signaling"
	"github.com/gorilla/websocket"
)

const testBridgeToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type fakeIntercomTransport struct {
	mu            sync.Mutex
	handler       func(signaling.Message)
	stateHandler  func(IntercomTransportState)
	state         IntercomTransportState
	replay        []signaling.Message
	replayStarted chan struct{}
	replayRelease chan struct{}
	replayOnce    sync.Once
	sent          []signaling.Message
	available     bool
	sendHook      func()
}

func (f *fakeIntercomTransport) SetIntercomHandler(handler func(signaling.Message)) {
	f.handler = handler
}

func (f *fakeIntercomTransport) SetIntercomStateHandler(handler func(IntercomTransportState)) {
	f.stateHandler = handler
}

func (f *fakeIntercomTransport) IntercomReplay() (IntercomTransportState, []signaling.Message) {
	f.mu.Lock()
	state := f.state
	replay := append([]signaling.Message(nil), f.replay...)
	started, release := f.replayStarted, f.replayRelease
	f.mu.Unlock()
	if started != nil {
		f.replayOnce.Do(func() { close(started) })
	}
	if release != nil {
		<-release
	}
	return state, replay
}

func (f *fakeIntercomTransport) SendIntercom(message signaling.Message) bool {
	f.mu.Lock()
	available := f.available
	hook := f.sendHook
	if available {
		f.sent = append(f.sent, message)
	}
	f.mu.Unlock()
	if hook != nil {
		hook()
	}
	return available
}

func TestIntercomBridgeRequiresLoopbackOriginAndCapabilitySubprotocol(t *testing.T) {
	transport := &fakeIntercomTransport{available: true, state: IntercomTransportState{Generation: 2, Joined: true, IntercomVersion: 1}}
	bridge := NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(bridge)
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	dial := func(protocols []string, origin string) (*websocket.Conn, *http.Response, error) {
		header := http.Header{}
		header.Set("Origin", origin)
		dialer := websocket.Dialer{Subprotocols: protocols}
		return dialer.Dial(wsURL, header)
	}
	for _, test := range []struct {
		name      string
		protocols []string
		origin    string
	}{
		{"missing auth", []string{intercomProtocol}, "http://localhost:5173"},
		{"wrong auth", []string{intercomProtocol, intercomAuthPrefix + strings.Repeat("f", 64)}, "http://localhost:5173"},
		{"wrong origin", []string{intercomProtocol, intercomAuthPrefix + testBridgeToken}, "https://attacker.example"},
	} {
		t.Run(test.name, func(t *testing.T) {
			conn, response, err := dial(test.protocols, test.origin)
			if conn != nil {
				conn.Close()
			}
			if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
				t.Fatalf("dial err=%v response=%v", err, response)
			}
		})
	}

	conn, _, err := dial([]string{intercomProtocol, intercomAuthPrefix + testBridgeToken}, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if conn.Subprotocol() != intercomProtocol {
		t.Fatalf("selected subprotocol = %q", conn.Subprotocol())
	}
	var state signaling.Message
	if err := conn.ReadJSON(&state); err != nil || state.Type != signaling.TypeIntercomBridgeState {
		t.Fatalf("initial state = %+v, %v", state, err)
	}
	var statePayload signaling.IntercomBridgeStatePayload
	if err := json.Unmarshal(state.Payload, &statePayload); err != nil || !statePayload.Joined || statePayload.IntercomVersion != signaling.IntercomProtocolVersion {
		t.Fatalf("fresh bridge authority = %+v, %v", statePayload, err)
	}

	request := signaling.Message{Type: signaling.TypeIntercomGroupCreate, RequestID: "request-1", Payload: json.RawMessage(`{"displayName":"Driver","password":"pw"}`)}
	if err := conn.WriteJSON(request); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		transport.mu.Lock()
		sent := append([]signaling.Message(nil), transport.sent...)
		transport.mu.Unlock()
		if len(sent) == 1 {
			if sent[0].Type != request.Type || sent[0].RequestID != request.RequestID {
				t.Fatalf("forwarded = %+v", sent[0])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("bridge did not forward client message")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestIntercomBridgeRejectsNonLoopbackBeforeUpgrade(t *testing.T) {
	transport := &fakeIntercomTransport{available: true}
	bridge := NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "http://localhost/api/intercom/ws", nil)
	request.RemoteAddr = "192.0.2.5:1234"
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Sec-WebSocket-Protocol", intercomProtocol+", "+intercomAuthPrefix+testBridgeToken)
	response := httptest.NewRecorder()
	bridge.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestIntercomBridgeReplacesOldRendererAndReplaysAuthority(t *testing.T) {
	joined := signaling.Message{Type: signaling.TypeIntercomJoined, Payload: json.RawMessage(`{"membershipGeneration":1}`)}
	transport := &fakeIntercomTransport{
		available: true,
		state:     IntercomTransportState{Generation: 5, Joined: true, IntercomVersion: 1},
		replay:    []signaling.Message{joined},
	}
	server := httptest.NewServer(NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{intercomProtocol, intercomAuthPrefix + testBridgeToken}}
	header := http.Header{"Origin": []string{"file://"}}
	first, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	for range 2 {
		var message signaling.Message
		if err := first.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
	}
	second, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	for _, wantType := range []string{signaling.TypeIntercomBridgeState, signaling.TypeIntercomJoined} {
		var message signaling.Message
		if err := second.ReadJSON(&message); err != nil || message.Type != wantType {
			t.Fatalf("replay = %+v, %v, want %s", message, err, wantType)
		}
	}
	first.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := first.ReadMessage(); err == nil {
		t.Fatal("replaced renderer connection remained open")
	}
}

func TestIntercomBridgeRejectsOldRendererDuringReplacementReplay(t *testing.T) {
	transport := &fakeIntercomTransport{available: true, state: IntercomTransportState{Generation: 1, Joined: true, IntercomVersion: 1}}
	server := httptest.NewServer(NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{intercomProtocol, intercomAuthPrefix + testBridgeToken}}
	header := http.Header{"Origin": []string{"file://"}}
	first, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	var initial signaling.Message
	if err := first.ReadJSON(&initial); err != nil || initial.Type != signaling.TypeIntercomBridgeState {
		t.Fatalf("initial state = %+v, %v", initial, err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	transport.mu.Lock()
	transport.replayStarted = started
	transport.replayRelease = release
	transport.replayOnce = sync.Once{}
	transport.mu.Unlock()
	secondResult := make(chan *websocket.Conn, 1)
	go func() {
		second, _, _ := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
		secondResult <- second
	}()
	<-started
	request := signaling.Message{Type: signaling.TypeIntercomLeave, RequestID: "stale-renderer"}
	_ = first.WriteJSON(request)
	time.Sleep(10 * time.Millisecond)
	transport.mu.Lock()
	sent := len(transport.sent)
	transport.mu.Unlock()
	if sent != 0 {
		close(release)
		t.Fatalf("old renderer forwarded %d RPCs during replacement replay", sent)
	}
	close(release)
	second := <-secondResult
	if second == nil {
		t.Fatal("replacement renderer failed to connect")
	}
	defer second.Close()
}

func TestIntercomBridgeSendFailureCallbackDoesNotDeadlock(t *testing.T) {
	transport := &fakeIntercomTransport{available: false}
	bridge := NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil)))
	client := &intercomBridgeConn{outbound: make(chan signaling.Message, 1), done: make(chan struct{})}
	bridge.mu.Lock()
	bridge.current = client
	bridge.mu.Unlock()
	transport.mu.Lock()
	transport.sendHook = func() {
		transport.stateHandler(IntercomTransportState{Generation: 2})
	}
	transport.mu.Unlock()

	done := make(chan bool, 1)
	go func() {
		done <- bridge.sendFromCurrent(client, signaling.Message{Type: signaling.TypeIntercomLeave, RequestID: "failed-send"})
	}()
	select {
	case sent := <-done:
		if sent {
			t.Fatal("failed transport send reported success")
		}
	case <-time.After(time.Second):
		t.Fatal("transport failure callback deadlocked the bridge")
	}
}

func TestValidIntercomBridgeToken(t *testing.T) {
	if !ValidIntercomBridgeToken(testBridgeToken) {
		t.Fatal("valid token rejected")
	}
	for _, token := range []string{"", strings.Repeat("A", 64), strings.Repeat("g", 64), strings.Repeat("0", 62)} {
		if ValidIntercomBridgeToken(token) {
			t.Fatalf("invalid token accepted: %q", token)
		}
	}
}

func TestIntercomBridgeAttachReplayPrecedesConcurrentForward(t *testing.T) {
	oldJoined := signaling.Message{Type: signaling.TypeIntercomJoined, Payload: json.RawMessage(`{"membershipGeneration":1}`)}
	newState := signaling.Message{Type: signaling.TypeIntercomState, Payload: json.RawMessage(`{"revision":2,"topologyRevision":1,"groupCode":"123456","participants":[]}`)}
	transport := &fakeIntercomTransport{
		available:     true,
		state:         IntercomTransportState{Generation: 1, Joined: true, IntercomVersion: 1},
		replay:        []signaling.Message{oldJoined},
		replayStarted: make(chan struct{}),
		replayRelease: make(chan struct{}),
	}
	server := httptest.NewServer(NewIntercomBridge(transport, testBridgeToken, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer server.Close()
	dialResult := make(chan *websocket.Conn, 1)
	go func() {
		dialer := websocket.Dialer{Subprotocols: []string{intercomProtocol, intercomAuthPrefix + testBridgeToken}}
		conn, _, _ := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), http.Header{"Origin": []string{"file://"}})
		dialResult <- conn
	}()
	<-transport.replayStarted
	forwarded := make(chan struct{})
	go func() {
		transport.handler(newState)
		close(forwarded)
	}()
	select {
	case <-forwarded:
		t.Fatal("concurrent forward passed replay critical section")
	case <-time.After(10 * time.Millisecond):
	}
	close(transport.replayRelease)
	conn := <-dialResult
	if conn == nil {
		t.Fatal("bridge dial failed")
	}
	defer conn.Close()
	for _, want := range []string{signaling.TypeIntercomBridgeState, signaling.TypeIntercomJoined, signaling.TypeIntercomState} {
		var message signaling.Message
		if err := conn.ReadJSON(&message); err != nil || message.Type != want {
			t.Fatalf("message = %+v, %v; want %s", message, err, want)
		}
	}
}

func TestIntercomBridgeNeverDropsRPCResponseOnOverflow(t *testing.T) {
	client := &intercomBridgeConn{outbound: make(chan signaling.Message, 1), done: make(chan struct{})}
	client.enqueue(signaling.Message{Type: signaling.TypeIntercomSFUSession, RequestID: "one"})
	client.enqueue(signaling.Message{Type: signaling.TypeIntercomState})
	select {
	case <-client.done:
	default:
		t.Fatal("newest authority was silently dropped on overflow")
	}
}

func TestIntercomBridgeClosesBeforeDroppingRPCResponseOnOverflow(t *testing.T) {
	client := &intercomBridgeConn{outbound: make(chan signaling.Message, 1), done: make(chan struct{})}
	client.enqueue(signaling.Message{Type: signaling.TypeIntercomSFUSession, RequestID: "one"})
	client.enqueue(signaling.Message{Type: signaling.TypeIntercomSFUPublished, RequestID: "two"})
	select {
	case <-client.done:
	default:
		t.Fatal("RPC response overflow was silently dropped")
	}
}
