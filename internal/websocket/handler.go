package websocket

import (
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
)

// upgrader is configured to upgrade HTTP connections to WebSocket
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins for development (restrict in production)
	CheckOrigin: func(r *http.Request) bool {
		return true
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
