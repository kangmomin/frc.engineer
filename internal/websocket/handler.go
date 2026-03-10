package websocket

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

var allowedOrigins = []string{"*"}

// upgrader is configured to upgrade HTTP connections to WebSocket
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return isOriginAllowed(r.Header.Get("Origin"), allowedOrigins)
	},
}

// Handler handles WebSocket upgrade requests
type Handler struct {
	hub            *Hub
	logger         *slog.Logger
	messageHandler MessageHandler
}

// NewHandler creates a new WebSocket handler
func NewHandler(hub *Hub, logger *slog.Logger) *Handler {
	return &Handler{
		hub:    hub,
		logger: logger,
	}
}

// SetMessageHandler sets the handler for incoming client messages
func (h *Handler) SetMessageHandler(handler MessageHandler) {
	h.messageHandler = handler
}

// ServeHTTP handles the WebSocket upgrade and client lifecycle
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("websocket upgrade failed", "error", err)
		return
	}

	client := NewClient(h.hub, conn, h.logger, h.messageHandler)
	h.hub.Register(client)

	// Start client pumps in separate goroutines
	go client.WritePump()
	go client.ReadPump()
}

func isOriginAllowed(origin string, allow []string) bool {
	if origin == "" {
		return true
	}
	if len(allow) == 0 {
		return false
	}

	originSpec, ok := parseOriginSpec(origin)
	if !ok {
		return false
	}

	for _, candidate := range allow {
		if candidate == "*" {
			return true
		}

		allowSpec, ok := parseOriginSpec(candidate)
		if !ok {
			continue
		}
		if !strings.EqualFold(originSpec.scheme, allowSpec.scheme) {
			continue
		}
		if !strings.EqualFold(originSpec.host, allowSpec.host) {
			continue
		}
		if allowSpec.port == "*" {
			return true
		}
		if normalizePort(originSpec.scheme, originSpec.port) == normalizePort(allowSpec.scheme, allowSpec.port) {
			return true
		}
	}

	return false
}

type originSpec struct {
	scheme string
	host   string
	port   string
}

func parseOriginSpec(raw string) (originSpec, bool) {
	raw = strings.TrimSpace(raw)
	scheme, remainder, ok := strings.Cut(raw, "://")
	if !ok || scheme == "" {
		return originSpec{}, false
	}
	if cut := strings.IndexAny(remainder, "/?#"); cut >= 0 {
		remainder = remainder[:cut]
	}
	if remainder == "" {
		return originSpec{}, false
	}
	if strings.HasSuffix(remainder, ":*") {
		host := strings.TrimSuffix(remainder, ":*")
		if host == "" {
			return originSpec{}, false
		}
		return originSpec{
			scheme: scheme,
			host:   host,
			port:   "*",
		}, true
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return originSpec{}, false
	}

	return originSpec{
		scheme: parsed.Scheme,
		host:   parsed.Hostname(),
		port:   parsed.Port(),
	}, true
}

func normalizePort(scheme, port string) string {
	if port != "" {
		return port
	}

	switch strings.ToLower(scheme) {
	case "http", "ws":
		return "80"
	case "https", "wss":
		return "443"
	default:
		return ""
	}
}
