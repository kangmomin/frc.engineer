package websocket

import (
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 512

	// Size of the client send buffer
	sendBufferSize = 256
)

// MessageHandler handles incoming client messages and returns a response (or nil)
type MessageHandler func(client *Client, message []byte) []byte

// Client represents a WebSocket client connection
type Client struct {
	hub            *Hub
	conn           *websocket.Conn
	send           chan []byte
	logger         *slog.Logger
	messageHandler MessageHandler
}

// NewClient creates a new Client instance
func NewClient(hub *Hub, conn *websocket.Conn, logger *slog.Logger, messageHandler MessageHandler) *Client {
	return &Client{
		hub:            hub,
		conn:           conn,
		send:           make(chan []byte, sendBufferSize),
		logger:         logger,
		messageHandler: messageHandler,
	}
}

// Send queues a message to be sent to this client
func (c *Client) Send(message []byte) {
	select {
	case c.send <- message:
	default:
		c.logger.Warn("client send buffer full, dropping message")
	}
}

// ReadPump pumps messages from the websocket connection to the hub
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Debug("websocket read error", "error", err)
			}
			break
		}

		// Process incoming messages if handler is set
		if c.messageHandler != nil && len(message) > 0 {
			response := c.messageHandler(c, message)
			if response != nil {
				c.Send(response)
			}
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
