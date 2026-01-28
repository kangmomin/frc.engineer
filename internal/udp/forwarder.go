package udp

import (
	"fmt"
	"log/slog"
	"net"
	"sync"

	"frc.engineer/internal/config"
)

// Forwarder sends copies of UDP packets to configured targets
type Forwarder struct {
	mu      sync.RWMutex
	targets []forwardConn
	logger  *slog.Logger
}

type forwardConn struct {
	addr    string
	conn    *net.UDPConn
	enabled bool
}

// NewForwarder creates a new UDP forwarder
func NewForwarder(logger *slog.Logger) *Forwarder {
	return &Forwarder{logger: logger}
}

// UpdateTargets replaces forwarding targets, reusing existing connections where possible
func (f *Forwarder) UpdateTargets(targets []config.ForwardTarget) {
	f.mu.Lock()

	// Save old connections to close after releasing lock
	oldTargets := f.targets

	f.targets = make([]forwardConn, 0, len(targets))
	for _, t := range targets {
		addr := fmt.Sprintf("%s:%d", t.Host, t.Port)
		fc := forwardConn{addr: addr, enabled: t.Enabled}
		if t.Enabled {
			udpAddr, err := net.ResolveUDPAddr("udp4", addr)
			if err != nil {
				f.logger.Warn("failed to resolve forward target", "addr", addr, "error", err)
				f.targets = append(f.targets, fc)
				continue
			}
			conn, err := net.DialUDP("udp4", nil, udpAddr)
			if err != nil {
				f.logger.Warn("failed to dial forward target", "addr", addr, "error", err)
				f.targets = append(f.targets, fc)
				continue
			}
			fc.conn = conn
		}
		f.targets = append(f.targets, fc)
	}

	f.mu.Unlock()

	// Close old connections outside lock to avoid blocking Forward()
	for _, t := range oldTargets {
		if t.conn != nil {
			t.conn.Close()
		}
	}
}

// Forward sends data to all enabled targets
func (f *Forwarder) Forward(data []byte) {
	f.mu.RLock()
	defer f.mu.RUnlock()

	for i := range f.targets {
		t := &f.targets[i]
		if !t.enabled || t.conn == nil {
			continue
		}
		if _, err := t.conn.Write(data); err != nil {
			f.logger.Debug("forward write error", "addr", t.addr, "error", err)
		}
	}
}

// Close closes all forwarding connections
func (f *Forwarder) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.targets {
		if t.conn != nil {
			t.conn.Close()
		}
	}
	f.targets = nil
}
