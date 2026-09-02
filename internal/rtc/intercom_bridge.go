package rtc

import (
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"frc.engineer/internal/signaling"
	"github.com/gorilla/websocket"
)

const (
	IntercomBridgeTokenEnv  = "FRC_INTERCOM_BRIDGE_TOKEN"
	intercomProtocol        = "frc-intercom-v1"
	intercomAuthPrefix      = "frc-auth."
	intercomBridgeWriteWait = 10 * time.Second
	intercomBridgeQueue     = 32
)

type intercomTransport interface {
	SetIntercomHandler(func(signaling.Message))
	SetIntercomStateHandler(func(IntercomTransportState))
	IntercomReplay() (IntercomTransportState, []signaling.Message)
	SendIntercom(signaling.Message) bool
}

type IntercomBridge struct {
	transport intercomTransport
	token     string
	logger    *slog.Logger
	upgrader  websocket.Upgrader
	sendMu    sync.Mutex
	mu        sync.Mutex
	current   *intercomBridgeConn
}

type intercomBridgeConn struct {
	conn     *websocket.Conn
	outbound chan signaling.Message
	done     chan struct{}
	once     sync.Once
}

func NewIntercomBridge(transport intercomTransport, token string, logger *slog.Logger) *IntercomBridge {
	bridge := &IntercomBridge{
		transport: transport,
		token:     token,
		logger:    logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			Subprotocols:    []string{intercomProtocol},
			CheckOrigin: func(r *http.Request) bool {
				return validIntercomBridgeOrigin(r.Header.Get("Origin"))
			},
		},
	}
	if transport != nil {
		transport.SetIntercomHandler(bridge.forward)
		transport.SetIntercomStateHandler(bridge.forwardState)
	}
	return bridge
}

func (b *IntercomBridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if b.transport == nil || !ValidIntercomBridgeToken(b.token) {
		http.Error(w, "intercom bridge unavailable", http.StatusServiceUnavailable)
		return
	}
	if !remoteIsLoopback(r.RemoteAddr) || !validIntercomBridgeProtocols(websocket.Subprotocols(r), b.token) || !validIntercomBridgeOrigin(r.Header.Get("Origin")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	conn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(signaling.MaxIntercomEnvelopeBytes)
	client := &intercomBridgeConn{conn: conn, outbound: make(chan signaling.Message, intercomBridgeQueue), done: make(chan struct{})}
	go client.writeLoop()
	b.sendMu.Lock()
	b.mu.Lock()
	previous := b.current
	b.current = client
	if previous != nil {
		previous.close()
	}
	state, replay := b.transport.IntercomReplay()
	client.enqueue(intercomBridgeStateMessage(state))
	for _, message := range replay {
		client.enqueue(message)
	}
	b.mu.Unlock()
	b.sendMu.Unlock()

	defer func() {
		client.close()
		b.mu.Lock()
		if b.current == client {
			b.current = nil
		}
		b.mu.Unlock()
	}()
	for {
		messageType, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage || len(raw) > signaling.MaxIntercomEnvelopeBytes || !utf8.Valid(raw) {
			client.enqueue(localIntercomError("", "invalid_request", "invalid intercom bridge message"))
			continue
		}
		var message signaling.Message
		if err := json.Unmarshal(raw, &message); err != nil || !signaling.IsIntercomClientMessageType(message.Type) {
			client.enqueue(localIntercomError(message.RequestID, "invalid_request", "unsupported intercom bridge message"))
			continue
		}
		if !b.sendFromCurrent(client, message) {
			client.enqueue(localIntercomError(message.RequestID, "signaling_unavailable", "central signaling is unavailable"))
		}
	}
}

func (b *IntercomBridge) sendFromCurrent(client *intercomBridgeConn, message signaling.Message) bool {
	b.sendMu.Lock()
	defer b.sendMu.Unlock()
	b.mu.Lock()
	current := b.current == client
	b.mu.Unlock()
	return current && b.transport.SendIntercom(message)
}

func (b *IntercomBridge) forward(message signaling.Message) {
	b.mu.Lock()
	current := b.current
	b.mu.Unlock()
	if current != nil {
		current.enqueue(message)
	}
}

func (b *IntercomBridge) forwardState(state IntercomTransportState) {
	b.forward(intercomBridgeStateMessage(state))
}

func (c *intercomBridgeConn) enqueue(message signaling.Message) {
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.outbound <- message:
	default:
		// Reconnect replays the newest authority. Closing is safer than silently
		// dropping either that authority or an ordered RPC response.
		c.close()
	}
}

func (c *intercomBridgeConn) writeLoop() {
	for {
		select {
		case <-c.done:
			return
		case message := <-c.outbound:
			c.conn.SetWriteDeadline(time.Now().Add(intercomBridgeWriteWait))
			if err := c.conn.WriteJSON(message); err != nil {
				c.close()
				return
			}
		}
	}
}

func (c *intercomBridgeConn) close() {
	c.once.Do(func() {
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
}

func ValidIntercomBridgeToken(token string) bool {
	if len(token) != 64 || strings.ToLower(token) != token {
		return false
	}
	decoded, err := hex.DecodeString(token)
	return err == nil && len(decoded) == 32
}

func validIntercomBridgeProtocols(protocols []string, token string) bool {
	baseFound := false
	authFound := false
	expected := intercomAuthPrefix + token
	for _, protocol := range protocols {
		switch {
		case protocol == intercomProtocol:
			baseFound = true
		case strings.HasPrefix(protocol, intercomAuthPrefix):
			if authFound || subtle.ConstantTimeCompare([]byte(protocol), []byte(expected)) != 1 {
				return false
			}
			authFound = true
		}
	}
	return baseFound && authFound
}

func validIntercomBridgeOrigin(origin string) bool {
	return origin == "file://" || origin == "http://localhost:5173"
}

func remoteIsLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func intercomBridgeStateMessage(state IntercomTransportState) signaling.Message {
	payload, _ := json.Marshal(signaling.IntercomBridgeStatePayload{
		Generation:      state.Generation,
		Joined:          state.Joined,
		IntercomVersion: state.IntercomVersion,
	})
	return signaling.Message{Type: signaling.TypeIntercomBridgeState, Payload: payload}
}

func localIntercomError(requestID, code, message string) signaling.Message {
	payload, _ := json.Marshal(signaling.IntercomErrorPayload{Code: code, Message: message, Retryable: code == "signaling_unavailable"})
	return signaling.Message{Type: signaling.TypeIntercomError, RequestID: requestID, Payload: payload}
}
