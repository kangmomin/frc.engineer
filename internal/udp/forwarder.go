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
	updateMu sync.Mutex
	mu       sync.RWMutex
	targets  []forwardConn
	closed   bool
	logger   *slog.Logger
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
	f.updateMu.Lock()
	defer f.updateMu.Unlock()

	f.mu.RLock()
	if f.closed {
		f.mu.RUnlock()
		return
	}
	oldTargets := f.targets
	f.mu.RUnlock()

	// Resolve and dial without blocking Forward on the current targets.
	nextTargets := make([]forwardConn, 0, len(targets))
	reused := make([]bool, len(oldTargets))
	for _, t := range targets {
		addr := fmt.Sprintf("%s:%d", t.Host, t.Port)
		fc := forwardConn{addr: addr, enabled: t.Enabled}
		if t.Enabled {
			udpAddr, err := net.ResolveUDPAddr("udp4", addr)
			if err != nil {
				f.logger.Warn("failed to resolve forward target", "addr", addr, "error", err)
				nextTargets = append(nextTargets, fc)
				continue
			}
			// Re-resolve hostnames on every update, but retain the socket if its
			// endpoint is unchanged. Match duplicates one-to-one.
			for i, old := range oldTargets {
				if !reused[i] && old.addr == addr && old.conn != nil && old.conn.RemoteAddr().String() == udpAddr.String() {
					fc.conn = old.conn
					reused[i] = true
					break
				}
			}
			if fc.conn != nil {
				nextTargets = append(nextTargets, fc)
				continue
			}
			conn, err := net.DialUDP("udp4", nil, udpAddr)
			if err != nil {
				f.logger.Warn("failed to dial forward target", "addr", addr, "error", err)
				nextTargets = append(nextTargets, fc)
				continue
			}
			fc.conn = conn
		}
		nextTargets = append(nextTargets, fc)
	}

	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		// Close may finish while DNS is pending. Never publish these sockets.
		for _, t := range nextTargets {
			if t.conn != nil {
				t.conn.Close()
			}
		}
		return
	}
	f.targets = nextTargets
	f.mu.Unlock()

	// Close old connections outside lock to avoid blocking Forward()
	for i, t := range oldTargets {
		if !reused[i] && t.conn != nil {
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

// Close permanently stops forwarding, including updates still resolving DNS.
func (f *Forwarder) Close() {
	f.mu.Lock()
	f.closed = true
	oldTargets := f.targets
	f.targets = nil
	f.mu.Unlock()
	for _, t := range oldTargets {
		if t.conn != nil {
			t.conn.Close()
		}
	}
}
