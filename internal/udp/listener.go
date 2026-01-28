package udp

import (
	"context"
	"log/slog"
	"net"
	"sync"

	"frc.engineer/internal/packets"
)

// Listener handles UDP packet reception from F1 25 game
type Listener struct {
	conn       *net.UDPConn
	bufferPool sync.Pool
	packetChan chan []byte
	logger     *slog.Logger
	forwarder  *Forwarder
}

// NewListener creates a new UDP listener
func NewListener(port int, bufferSize int, logger *slog.Logger) (*Listener, error) {
	addr := &net.UDPAddr{
		Port: port,
		IP:   net.IPv4zero,
	}

	conn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return nil, err
	}

	// Set receive buffer size to handle burst traffic
	if err := conn.SetReadBuffer(1024 * 1024); err != nil {
		logger.Warn("failed to set UDP read buffer", "error", err)
	}

	l := &Listener{
		conn: conn,
		bufferPool: sync.Pool{
			New: func() interface{} {
				buf := make([]byte, packets.MaxPacketSize)
				return &buf
			},
		},
		packetChan: make(chan []byte, bufferSize),
		logger:     logger,
	}

	return l, nil
}

// Start begins listening for UDP packets
func (l *Listener) Start(ctx context.Context) {
	l.logger.Info("UDP listener started", "addr", l.conn.LocalAddr().String())

	go func() {
		<-ctx.Done()
		l.conn.Close()
	}()

	for {
		bufPtr := l.bufferPool.Get().(*[]byte)
		buf := *bufPtr

		n, _, err := l.conn.ReadFromUDP(buf)
		if err != nil {
			if ctx.Err() != nil {
				// Context cancelled, clean shutdown
				l.logger.Info("UDP listener shutting down")
				return
			}
			l.logger.Error("UDP read error", "error", err)
			l.bufferPool.Put(bufPtr)
			continue
		}

		if n < packets.PacketHeaderSize {
			l.bufferPool.Put(bufPtr)
			continue
		}

		// Copy the data to avoid buffer pool issues
		data := make([]byte, n)
		copy(data, buf[:n])
		l.bufferPool.Put(bufPtr)

		// Forward to configured targets
		if l.forwarder != nil {
			l.forwarder.Forward(data)
		}

		select {
		case l.packetChan <- data:
		default:
			// Channel full, drop packet
			l.logger.Warn("packet dropped: channel full")
		}
	}
}

// Packets returns the channel for received packets
func (l *Listener) Packets() <-chan []byte {
	return l.packetChan
}

// SetForwarder attaches a forwarder to the listener
func (l *Listener) SetForwarder(f *Forwarder) {
	l.forwarder = f
}

// Close closes the UDP connection
func (l *Listener) Close() error {
	close(l.packetChan)
	return l.conn.Close()
}
