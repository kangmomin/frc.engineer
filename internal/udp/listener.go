package udp

import (
	"context"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"

	"frc.engineer/internal/packets"
)

// Listener handles UDP packet reception from F1 25 game
type Listener struct {
	conn       *net.UDPConn
	mu         sync.Mutex
	started    bool
	closed     bool
	packetChan chan []byte
	logger     *slog.Logger
	forwarder  atomic.Pointer[Forwarder]
	// bound closes on the first successful bind; done closes on Close.
	// Start waits on them when the listener was created unbound.
	bound chan struct{}
	done  chan struct{}
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

	l := newListener(bufferSize, logger)
	l.conn = conn
	close(l.bound)
	return l, nil
}

// NewUnboundListener creates a listener without a socket, for when the
// configured port is unavailable. Start waits until Rebind succeeds, so the
// sender can stay up and retry or switch ports instead of exiting.
func NewUnboundListener(bufferSize int, logger *slog.Logger) *Listener {
	return newListener(bufferSize, logger)
}

func newListener(bufferSize int, logger *slog.Logger) *Listener {
	return &Listener{
		packetChan: make(chan []byte, bufferSize),
		logger:     logger,
		bound:      make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Rebind rebinds the listener to a new port without stopping packet processing.
func (l *Listener) Rebind(port int) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return net.ErrClosed
	}

	addr := &net.UDPAddr{Port: port, IP: net.IPv4zero}
	newConn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return err
	}
	if err := newConn.SetReadBuffer(1024 * 1024); err != nil {
		l.logger.Warn("failed to set UDP read buffer on rebind", "error", err)
	}

	oldConn := l.conn
	l.conn = newConn
	if oldConn == nil {
		close(l.bound)
		return nil
	}
	// Wake the reader; it always picks up the latest connection under mu.
	oldConn.Close()

	return nil
}

// Start runs the single packet reader until cancellation or Close.
// Further calls do not start another reader.
func (l *Listener) Start(ctx context.Context) {
	l.mu.Lock()
	if l.started || l.closed {
		l.mu.Unlock()
		return
	}
	l.started = true
	l.mu.Unlock()

	// Only the reader closes the packet stream once Start has claimed it.
	defer close(l.packetChan)
	defer l.Close()
	stop := context.AfterFunc(ctx, func() { _ = l.Close() })
	defer stop()

	select {
	case <-l.bound:
	case <-l.done:
		return
	}
	l.mu.Lock()
	currentConn := l.conn
	l.mu.Unlock()
	if currentConn == nil {
		return
	}
	l.logger.Info("UDP listener started", "addr", currentConn.LocalAddr().String())
	defer l.logger.Info("UDP listener shutting down")

	buf := make([]byte, packets.MaxPacketSize)
	for ctx.Err() == nil {
		n, _, err := currentConn.ReadFromUDPAddrPort(buf)
		if err != nil {
			l.mu.Lock()
			closed := l.closed
			replaced := l.conn != currentConn
			currentConn = l.conn
			l.mu.Unlock()
			if closed || ctx.Err() != nil {
				return
			}
			if replaced {
				l.logger.Info("UDP listener rebound", "addr", currentConn.LocalAddr().String())
				continue
			}
			l.logger.Error("UDP read error", "error", err)
			continue
		}

		if n < packets.PacketHeaderSize {
			continue
		}

		// Consumers own this copy; the reader reuses buf for the next datagram.
		data := make([]byte, n)
		copy(data, buf[:n])

		// Forward to configured targets
		if forwarder := l.forwarder.Load(); forwarder != nil {
			forwarder.Forward(data)
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
	l.forwarder.Store(f)
}

// Close stops reception and prevents future rebinds. It is safe to repeat.
// The packet stream closes after the reader's final in-flight packet.
func (l *Listener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	close(l.done)
	if !l.started {
		close(l.packetChan)
	}
	if l.conn == nil {
		return nil
	}
	return l.conn.Close()
}
