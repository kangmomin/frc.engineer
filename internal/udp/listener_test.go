package udp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/packets"
)

func udpTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func startTestListener(t *testing.T, listener *Listener) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { defer close(stopped); listener.Start(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(3 * time.Second):
			t.Error("UDP listener did not stop")
		}
	})
}

func listenerAddress(listener *Listener) *net.UDPAddr {
	listener.mu.Lock()
	defer listener.mu.Unlock()
	return &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: listener.conn.LocalAddr().(*net.UDPAddr).Port}
}

func sendTestPacket(t *testing.T, listener *Listener, data []byte) {
	t.Helper()
	conn, err := net.DialUDP("udp4", nil, listenerAddress(listener))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write(data); err != nil {
		t.Fatal(err)
	}
}

func readTestPacket(t *testing.T, listener *Listener) []byte {
	t.Helper()
	select {
	case data, ok := <-listener.Packets():
		if !ok {
			t.Fatal("packet stream closed before receiving data")
		}
		return data
	case <-time.After(3 * time.Second):
		t.Fatal("packet did not arrive")
		return nil
	}
}

func TestListenerCloseBeforeStart(t *testing.T) {
	listener, err := NewListener(0, 1, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("repeat close: %v", err)
	}
	if _, ok := <-listener.Packets(); ok {
		t.Fatal("packet stream remains open")
	}
	if err := listener.Rebind(0); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("rebind after close = %v, want net.ErrClosed", err)
	}
	startTestListener(t, listener)
}

func TestListenerContextCancellationClosesStream(t *testing.T) {
	listener, err := NewListener(0, 4, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopped := make(chan struct{})
	go func() { defer close(stopped); listener.Start(ctx) }()
	sendTestPacket(t, listener, make([]byte, packets.PacketHeaderSize))
	readTestPacket(t, listener)
	cancel()
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("context cancellation did not stop the reader")
	}
	select {
	case _, ok := <-listener.Packets():
		if ok {
			t.Fatal("unexpected packet after cancellation")
		}
	default:
		t.Fatal("context cancellation left the packet stream open")
	}
	if err := listener.Rebind(0); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("rebind after cancellation = %v, want net.ErrClosed", err)
	}
}

func TestListenerStartWithCancelledContext(t *testing.T) {
	listener, err := NewListener(0, 1, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	listener.Start(ctx)
	select {
	case _, ok := <-listener.Packets():
		if ok {
			t.Fatal("unexpected packet")
		}
	default:
		t.Fatal("cancelled start left the stream open")
	}
	if err := listener.Rebind(0); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("rebind after cancelled start = %v", err)
	}
}

func TestListenerDuplicateStartDoesNotStopActiveReader(t *testing.T) {
	listener, err := NewListener(0, 2, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	startTestListener(t, listener)
	packet := make([]byte, packets.PacketHeaderSize)
	sendTestPacket(t, listener, packet)
	readTestPacket(t, listener)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	listener.Start(ctx)
	sendTestPacket(t, listener, packet)
	readTestPacket(t, listener)
}

func TestListenerStartCloseRace(t *testing.T) {
	for range 25 {
		listener, err := NewListener(0, 1, udpTestLogger())
		if err != nil {
			t.Fatal(err)
		}
		var work sync.WaitGroup
		work.Go(func() { listener.Start(context.Background()) })
		work.Go(func() { listener.Start(context.Background()) })
		work.Go(func() {
			if err := listener.Close(); err != nil {
				t.Error(err)
			}
		})
		work.Wait()
		if _, ok := <-listener.Packets(); ok {
			t.Fatal("packet stream remained open")
		}
	}
}

func TestListenerCloseDuringTraffic(t *testing.T) {
	listener, err := NewListener(0, 1, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	startTestListener(t, listener)
	conn, err := net.DialUDP("udp4", nil, listenerAddress(listener))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	packet := make([]byte, packets.PacketHeaderSize)
	if _, err := conn.Write(packet); err != nil {
		t.Fatal(err)
	}
	readTestPacket(t, listener)
	var work sync.WaitGroup
	work.Go(func() {
		for range 100 {
			_, _ = conn.Write(packet)
		}
	})
	work.Go(func() {
		for range 100 {
			listener.SetForwarder(nil)
		}
	})
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	work.Wait()
	for range listener.Packets() {
	}
}

func TestListenerRebindBeforeStart(t *testing.T) {
	listener, err := NewListener(0, 4, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	rebound := make(chan error, 1)
	go func() {
		for range 5 {
			if err := listener.Rebind(0); err != nil {
				rebound <- err
				return
			}
		}
		rebound <- nil
	}()
	select {
	case err := <-rebound:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		// Start the old implementation to release its pending rebind sends.
		startTestListener(t, listener)
		select {
		case <-rebound:
		case <-time.After(3 * time.Second):
			t.Fatal("rebind stayed blocked even after start")
		}
		t.Fatal("rebind requires a running reader")
	}
	startTestListener(t, listener)
	want := bytes.Repeat([]byte{7}, packets.PacketHeaderSize)
	sendTestPacket(t, listener, want)
	if got := readTestPacket(t, listener); !bytes.Equal(got, want) {
		t.Fatalf("received %x, want %x", got, want)
	}
}

func TestListenerConcurrentRebindAndClose(t *testing.T) {
	listener, err := NewListener(0, 16, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	startTestListener(t, listener)
	var updates sync.WaitGroup
	for range 4 {
		updates.Go(func() {
			for range 20 {
				if err := listener.Rebind(0); err != nil {
					t.Error(err)
					return
				}
			}
		})
	}
	updated := make(chan struct{})
	go func() { updates.Wait(); close(updated) }()
	select {
	case <-updated:
	case <-time.After(3 * time.Second):
		t.Fatal("concurrent rebinds did not return")
	}
	want := bytes.Repeat([]byte{3}, packets.PacketHeaderSize)
	sendTestPacket(t, listener, want)
	if got := readTestPacket(t, listener); !bytes.Equal(got, want) {
		t.Fatalf("latest port received %x, want %x", got, want)
	}
	var closing sync.WaitGroup
	for range 4 {
		closing.Go(func() {
			for range 20 {
				if err := listener.Rebind(0); err != nil && !errors.Is(err, net.ErrClosed) {
					t.Error(err)
				}
				if err := listener.Close(); err != nil {
					t.Error(err)
				}
			}
		})
	}
	closing.Wait()
	if err := listener.Rebind(0); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("final rebind = %v", err)
	}
}

func TestListenerRebindFailureKeepsReceivingAndOwnsPackets(t *testing.T) {
	listener, err := NewListener(0, 4, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	startTestListener(t, listener)
	if err := listener.Rebind(listenerAddress(listener).Port); err == nil {
		t.Fatal("rebind to occupied port succeeded")
	}
	sendTestPacket(t, listener, []byte{1}) // too short: ignore
	first := bytes.Repeat([]byte{1}, packets.PacketHeaderSize)
	sendTestPacket(t, listener, first)
	retained := readTestPacket(t, listener)
	second := bytes.Repeat([]byte{2}, packets.MaxPacketSize)
	sendTestPacket(t, listener, second)
	if got := readTestPacket(t, listener); !bytes.Equal(got, second) {
		t.Fatal("second packet was truncated or altered")
	}
	if !bytes.Equal(retained, first) {
		t.Fatal("a later receive overwrote the retained packet")
	}
}

func BenchmarkListenerReceive(b *testing.B) {
	listener, err := NewListener(0, 8, udpTestLogger())
	if err != nil {
		b.Fatal(err)
	}
	conn, err := net.DialUDP("udp4", nil, listenerAddress(listener))
	if err != nil {
		b.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { defer close(stopped); listener.Start(ctx) }()
	defer func() { cancel(); <-stopped }()
	packet := make([]byte, 1460)
	b.SetBytes(int64(len(packet)))
	b.ReportAllocs()
	// Warm the receive buffer and socket before measuring.
	if _, err := conn.Write(packet); err != nil {
		b.Fatal(err)
	}
	<-listener.Packets()
	b.ResetTimer()
	for range b.N {
		if _, err := conn.Write(packet); err != nil {
			b.Fatal(err)
		}
		if data := <-listener.Packets(); len(data) != len(packet) {
			b.Fatal("packet lost or truncated")
		}
	}
	b.StopTimer()
}

func TestUnboundListenerReceivesAfterRebind(t *testing.T) {
	listener := NewUnboundListener(4, udpTestLogger())
	startTestListener(t, listener)
	if err := listener.Rebind(0); err != nil {
		t.Fatal(err)
	}
	want := bytes.Repeat([]byte{9}, packets.PacketHeaderSize)
	sendTestPacket(t, listener, want)
	if got := readTestPacket(t, listener); !bytes.Equal(got, want) {
		t.Fatalf("received %x, want %x", got, want)
	}
}

func TestUnboundListenerCloseStopsWaitingReader(t *testing.T) {
	listener := NewUnboundListener(4, udpTestLogger())
	stopped := make(chan struct{})
	go func() { defer close(stopped); listener.Start(context.Background()) }()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("waiting reader did not stop on Close")
	}
	if _, ok := <-listener.Packets(); ok {
		t.Fatal("packet stream still open after Close")
	}
	if err := listener.Rebind(0); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Rebind after Close = %v, want net.ErrClosed", err)
	}
}

func TestUnboundListenerCloseBeforeStart(t *testing.T) {
	listener := NewUnboundListener(4, udpTestLogger())
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if _, ok := <-listener.Packets(); ok {
		t.Fatal("packet stream still open after Close")
	}
	listener.Start(context.Background())
}
