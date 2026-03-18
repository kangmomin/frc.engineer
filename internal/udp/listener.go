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
	mu         sync.Mutex
	rebindCh   chan *net.UDPConn
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
		conn:     conn,
		rebindCh: make(chan *net.UDPConn, 1),
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

// Rebind rebinds the listener to a new port without stopping packet processing.
func (l *Listener) Rebind(port int) error {
	addr := &net.UDPAddr{Port: port, IP: net.IPv4zero}
	newConn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return err
	}
	if err := newConn.SetReadBuffer(1024 * 1024); err != nil {
		l.logger.Warn("failed to set UDP read buffer on rebind", "error", err)
	}

	l.mu.Lock()
	oldConn := l.conn
	l.conn = newConn
	l.mu.Unlock()

	oldConn.Close()
	l.rebindCh <- newConn

	return nil
}

// Start begins listening for UDP packets
func (l *Listener) Start(ctx context.Context) {
	l.logger.Info("UDP listener started", "addr", l.conn.LocalAddr().String())

	go func() {
		<-ctx.Done()
		l.mu.Lock()
		l.conn.Close()
		l.mu.Unlock()
	}()

	l.mu.Lock()
	currentConn := l.conn
	l.mu.Unlock()

	for {
		l.readLoop(ctx, currentConn)

		if ctx.Err() != nil {
			l.logger.Info("UDP listener shutting down")
			return
		}

		select {
		case currentConn = <-l.rebindCh:
			l.logger.Info("UDP listener rebound", "addr", currentConn.LocalAddr().String())
		case <-ctx.Done():
			l.logger.Info("UDP listener shutting down")
			return
		}
	}
}

func (l *Listener) readLoop(ctx context.Context, conn *net.UDPConn) {
	for {
		bufPtr := l.bufferPool.Get().(*[]byte)
		buf := *bufPtr

		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			l.bufferPool.Put(bufPtr)
			if ctx.Err() != nil {
				return
			}
			// Check if this conn was replaced by Rebind
			l.mu.Lock()
			replaced := l.conn != conn
			l.mu.Unlock()
			if replaced {
				return
			}
			l.logger.Error("UDP read error", "error", err)
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
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.conn.Close()
}
