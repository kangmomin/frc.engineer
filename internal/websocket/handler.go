package websocket

import (
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gorilla/websocket"
)

// allowedOrigins는 same-host/localhost 외에 텔레메트리 WS 핸드셰이크에서 추가로
// 허용할 브라우저 Origin 목록이다. 시작 시 ALLOWED_PITWALL_ORIGINS(콤마 구분,
// cmd/server의 /api CORS 허용목록과 동일 변수)로 채워져 같은 배포에서 REST와 WS
// 허용목록이 어긋나지 않게 하고, 비어 있으면 legacy ALLOWED_ORIGINS를 읽는다.
// 둘 다 비어 있으면 same-host + localhost 변형만 허용한다.
var allowedOrigins = loadAllowedOrigins()

func loadAllowedOrigins() []string {
	raw := os.Getenv("ALLOWED_PITWALL_ORIGINS")
	if strings.TrimSpace(raw) == "" {
		raw = os.Getenv("ALLOWED_ORIGINS") // legacy alias
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if o := strings.TrimSpace(part); o != "" {
			out = append(out, o)
		}
	}
	return out
}

// upgrader is configured to upgrade HTTP connections to WebSocket
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 브라우저에서 직접 여는 텔레메트리 WS라 Origin을 검사한다. Origin이 없으면
	// (Go sender 등 비브라우저 클라이언트) 허용하고, 요청 Host와 동일 host이거나
	// localhost 변형이면 same-origin/개발로 허용하며, 그 외에는 ALLOWED_ORIGINS
	// 허용목록에 있을 때만 허용한다.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		spec, ok := parseOriginSpec(origin)
		if !ok {
			return false
		}
		if isLoopbackHost(spec.host) {
			return true
		}
		if strings.EqualFold(spec.host, hostOnly(r.Host)) {
			return true
		}
		return isOriginAllowed(origin, allowedOrigins)
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

// hostOnly는 "host:port" 또는 "host"에서 host만 추출한다(IPv6 대괄호/포트 처리).
func hostOnly(hostport string) string {
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		return h
	}
	return hostport
}

// isLoopbackHost는 host가 localhost 또는 loopback IP인지 판별한다(로컬 개발 허용).
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return ip.IsLoopback()
	}
	return false
}
