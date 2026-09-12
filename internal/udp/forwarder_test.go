package udp

import (
	"bytes"
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"frc.engineer/internal/config"
	"frc.engineer/internal/packets"

	"golang.org/x/net/dns/dnsmessage"
)

func newForwardReceiver(t testing.TB) (*net.UDPConn, config.ForwardTarget) {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, config.ForwardTarget{Host: "127.0.0.1", Port: conn.LocalAddr().(*net.UDPAddr).Port, Enabled: true}
}

func receiveForwarded(t *testing.T, conn *net.UDPConn, want []byte) *net.UDPAddr {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, packets.MaxPacketSize)
	n, addr, err := conn.ReadFromUDP(buf)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf[:n], want) {
		t.Fatalf("forwarded %x, want %x", buf[:n], want)
	}
	return addr
}

func TestForwarderReusesUnchangedTargets(t *testing.T) {
	receiver, target := newForwardReceiver(t)
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	want := []byte("packet")
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	forwarder.Forward(want)
	before := receiveForwarded(t, receiver, want)
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	forwarder.Forward(want)
	after := receiveForwarded(t, receiver, want)
	if before.String() != after.String() {
		t.Fatalf("unchanged target reopened its socket: %v -> %v", before, after)
	}
}

func TestForwarderDuplicateTargetsAndRemoval(t *testing.T) {
	receiver, target := newForwardReceiver(t)
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	want := []byte("packet")
	forwarder.UpdateTargets([]config.ForwardTarget{target, target})
	forwarder.Forward(want)
	first := receiveForwarded(t, receiver, want)
	second := receiveForwarded(t, receiver, want)
	if first.String() == second.String() {
		t.Fatal("duplicate targets unexpectedly share one connection")
	}
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	forwarder.Forward(want)
	if got := receiveForwarded(t, receiver, want); got.String() != first.String() {
		t.Fatalf("retained target = %v, want %v", got, first)
	}
	target.Enabled = false
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	forwarder.Forward(want)
	forwarder.UpdateTargets(nil)
	forwarder.Forward(want)
	forwarder.Close()
	forwarder.Forward(want)
	receiver.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
	if _, _, err := receiver.ReadFromUDP(make([]byte, 64)); err == nil {
		t.Fatal("removed or disabled target still received data")
	}
}

func TestForwarderRefreshesDNSBeforeReusingSocket(t *testing.T) {
	first, target := newForwardReceiver(t)
	second, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 2), Port: target.Port})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { second.Close() })
	dns, _ := newForwardReceiver(t)
	var address atomic.Uint32
	address.Store(1)
	dnsStopped := make(chan struct{})
	go func() {
		defer close(dnsStopped)
		buf := make([]byte, 512)
		for {
			n, client, err := dns.ReadFromUDP(buf)
			if err != nil {
				return
			}
			var query dnsmessage.Message
			if err := query.Unpack(buf[:n]); err != nil {
				t.Error(err)
				return
			}
			response := dnsmessage.Message{
				Header:    dnsmessage.Header{ID: query.ID, Response: true, RecursionAvailable: true},
				Questions: query.Questions,
			}
			lastOctet := address.Load()
			if lastOctet == 0 {
				response.RCode = dnsmessage.RCodeNameError
			} else {
				for _, q := range query.Questions {
					if q.Type == dnsmessage.TypeA {
						response.Answers = append(response.Answers, dnsmessage.Resource{
							Header: dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET},
							Body:   &dnsmessage.AResource{A: [4]byte{127, 0, 0, byte(lastOctet)}},
						})
					}
				}
			}
			data, err := response.Pack()
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := dns.WriteToUDP(data, client); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	oldResolver := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "udp4", dns.LocalAddr().String())
	}}
	t.Cleanup(func() {
		net.DefaultResolver = oldResolver
		dns.Close()
		<-dnsStopped
	})
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	hostnameTarget := target
	hostnameTarget.Host = "frc-dns.test"
	want := []byte("packet")
	forwarder.UpdateTargets([]config.ForwardTarget{hostnameTarget})
	forwarder.Forward(want)
	original := receiveForwarded(t, first, want)
	forwarder.UpdateTargets([]config.ForwardTarget{hostnameTarget})
	forwarder.Forward(want)
	if got := receiveForwarded(t, first, want); got.String() != original.String() {
		t.Fatal("unchanged DNS answer reopened the socket")
	}
	address.Store(2)
	forwarder.UpdateTargets([]config.ForwardTarget{hostnameTarget})
	forwarder.Forward(want)
	receiveForwarded(t, second, want)
	address.Store(0)
	forwarder.UpdateTargets([]config.ForwardTarget{hostnameTarget, target})
	forwarder.Forward(want)
	receiveForwarded(t, first, want)
	second.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
	if _, _, err := second.ReadFromUDP(make([]byte, 64)); err == nil {
		t.Fatal("failed DNS lookup retained the stale endpoint")
	}
}

func TestForwarderKeepsForwardingDuringDNSUpdate(t *testing.T) {
	testForwarderDNSUpdate(t, false)
}

func TestForwarderCloseDuringDNSUpdate(t *testing.T) {
	testForwarderDNSUpdate(t, true)
}

func testForwarderDNSUpdate(t *testing.T, closeDuringUpdate bool) {
	t.Helper()
	receiver, target := newForwardReceiver(t)
	addedReceiver, addedTarget := newForwardReceiver(t)
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	resolving, release := make(chan struct{}), make(chan struct{})
	var entered, released sync.Once
	oldResolver := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		entered.Do(func() { close(resolving) })
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil, errors.New("test DNS unavailable")
	}}
	updated := make(chan struct{})
	defer func() {
		released.Do(func() { close(release) })
		<-updated
		net.DefaultResolver = oldResolver
	}()
	go func() {
		defer close(updated)
		forwarder.UpdateTargets([]config.ForwardTarget{target, addedTarget, {Host: "frc-update.test", Port: target.Port, Enabled: true}})
	}()
	select {
	case <-resolving:
	case <-time.After(3 * time.Second):
		t.Fatal("DNS resolver was not called")
	}
	want := []byte("keep receiving")
	forwarded := make(chan struct{})
	go func() { forwarder.Forward(want); close(forwarded) }()
	defer func() {
		released.Do(func() { close(release) })
		<-forwarded
	}()
	select {
	case <-forwarded:
	case <-time.After(time.Second):
		t.Fatal("DNS update blocked forwarding on the existing target")
	}
	receiveForwarded(t, receiver, want)
	if closeDuringUpdate {
		closed := make(chan struct{})
		go func() { forwarder.Close(); close(closed) }()
		defer func() {
			released.Do(func() { close(release) })
			<-closed
		}()
		select {
		case <-closed:
		case <-time.After(time.Second):
			t.Fatal("DNS update blocked Close")
		}
	}
	released.Do(func() { close(release) })
	<-updated
	if closeDuringUpdate {
		forwarder.UpdateTargets([]config.ForwardTarget{target})
		forwarder.Forward(want)
		for _, conn := range []*net.UDPConn{receiver, addedReceiver} {
			conn.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
			if _, _, err := conn.ReadFromUDP(make([]byte, 64)); err == nil {
				t.Fatal("an update revived the closed forwarder")
			}
		}
		forwarder.mu.RLock()
		targetCount := len(forwarder.targets)
		forwarder.mu.RUnlock()
		if targetCount != 0 {
			t.Fatalf("closed forwarder has %d targets", targetCount)
		}
		return
	}
	forwarder.Forward(want)
	receiveForwarded(t, receiver, want)
	receiveForwarded(t, addedReceiver, want)
}

func TestListenerForwardsWhenPacketQueueIsFull(t *testing.T) {
	receiver, target := newForwardReceiver(t)
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	forwarder.UpdateTargets([]config.ForwardTarget{target})
	listener, err := NewListener(0, 1, udpTestLogger())
	if err != nil {
		t.Fatal(err)
	}
	listener.SetForwarder(forwarder)
	startTestListener(t, listener)
	packet := bytes.Repeat([]byte{9}, packets.PacketHeaderSize)
	for range 3 {
		sendTestPacket(t, listener, packet)
		receiveForwarded(t, receiver, packet)
	}
	readTestPacket(t, listener)
}

func TestForwarderConcurrentUpdatesAndClose(t *testing.T) {
	_, target := newForwardReceiver(t)
	forwarder := NewForwarder(udpTestLogger())
	t.Cleanup(forwarder.Close)
	var work sync.WaitGroup
	work.Go(func() {
		for range 100 {
			forwarder.UpdateTargets([]config.ForwardTarget{target})
		}
	})
	work.Go(func() {
		for range 100 {
			forwarder.Close()
		}
	})
	work.Go(func() {
		for range 1000 {
			forwarder.Forward([]byte("packet"))
		}
	})
	work.Wait()
	forwarder.Close()
}

func BenchmarkForwarderUpdateTargets(b *testing.B) {
	_, target := newForwardReceiver(b)
	forwarder := NewForwarder(udpTestLogger())
	defer forwarder.Close()
	targets := []config.ForwardTarget{target}
	forwarder.UpdateTargets(targets)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		forwarder.UpdateTargets(targets)
	}
}
