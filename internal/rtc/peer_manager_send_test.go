package rtc

import (
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func openTestDataChannel(t *testing.T) *webrtc.DataChannel {
	t.Helper()
	channel, _, _ := openTestDataChannelPair(t)
	return channel
}

func openTestDataChannelPair(t *testing.T) (*webrtc.DataChannel, *webrtc.PeerConnection, <-chan string) {
	t.Helper()
	offerer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = offerer.Close() })
	answerer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = answerer.Close() })
	received := make(chan string, 8)
	answerer.OnDataChannel(func(remote *webrtc.DataChannel) {
		remote.OnMessage(func(message webrtc.DataChannelMessage) { received <- string(message.Data) })
	})
	channel, err := offerer.CreateDataChannel("data", nil)
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	channel.OnOpen(func() { close(opened) })
	offer, err := offerer.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(offerer)
	if err := offerer.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	<-gathered
	if err := answerer.SetRemoteDescription(*offerer.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	answer, err := answerer.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered = webrtc.GatheringCompletePromise(answerer)
	if err := answerer.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	<-gathered
	if err := offerer.SetRemoteDescription(*answerer.LocalDescription()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-time.After(10 * time.Second):
		t.Fatal("local data channel did not open")
	}
	return channel, offerer, received
}

func TestReliableResponsesWaitForBusyChannel(t *testing.T) {
	for _, synchronous := range []bool{false, true} {
		t.Run(map[bool]string{false: "unicast", true: "request_response"}[synchronous], func(t *testing.T) {
			channel, pc, received := openTestDataChannelPair(t)
			meta := &peerMeta{}
			pm := &PeerManager{
				channels: map[string]*webrtc.DataChannel{"viewer": channel},
				peers:    map[string]*webrtc.PeerConnection{"viewer": pc},
				peerMeta: map[string]*peerMeta{"viewer": meta},
				logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			meta.reliableSendMu.Lock()
			var unlock sync.Once
			defer unlock.Do(meta.reliableSendMu.Unlock)
			done := make(chan struct{})
			go func() {
				defer close(done)
				if synchronous {
					pm.sendToIfCurrent("viewer", pc, channel, []byte("response"))
				} else {
					pm.SendTo("viewer", []byte("response"))
				}
			}()
			select {
			case <-done:
				t.Fatal("response was discarded while the send lock was busy")
			case <-time.After(20 * time.Millisecond):
			}
			unlock.Do(meta.reliableSendMu.Unlock)
			select {
			case message := <-received:
				if message != "response" {
					t.Fatalf("received %q", message)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("reliable response did not arrive after congestion cleared")
			}
			<-done
		})
	}
}

func TestBroadcastPerPeerDropsBusyChannel(t *testing.T) {
	channel := openTestDataChannel(t)
	meta := &peerMeta{}
	pm := &PeerManager{
		channels: map[string]*webrtc.DataChannel{"viewer": channel},
		peerMeta: map[string]*peerMeta{"viewer": meta},
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	meta.reliableSendMu.Lock()
	var unlock sync.Once
	defer unlock.Do(meta.reliableSendMu.Unlock)
	result := make(chan [2]int, 1)
	go func() {
		dropped, total := pm.BroadcastPerPeer(func(string, string) []byte { return []byte("live") })
		result <- [2]int{dropped, total}
	}()
	select {
	case got := <-result:
		if got != [2]int{1, 1} {
			t.Fatalf("broadcast result = %v, want one dropped peer", got)
		}
	case <-time.After(time.Second):
		unlock.Do(meta.reliableSendMu.Unlock)
		<-result
		t.Fatal("live broadcast waited on another send")
	}
	unlock.Do(meta.reliableSendMu.Unlock)
	dropped, total := pm.BroadcastPerPeer(func(string, string) []byte { return []byte("live") })
	if dropped != 0 || total != 1 {
		t.Fatalf("broadcast after release = (%d, %d), want (0, 1)", dropped, total)
	}
}

func TestBufferedSendDeadlineIncludesLockContention(t *testing.T) {
	channel := openTestDataChannel(t)
	var sendMu sync.Mutex
	sendMu.Lock()
	var unlock sync.Once
	defer unlock.Do(sendMu.Unlock)
	result := make(chan error, 1)
	go func() { result <- sendDataChannel(channel, &sendMu, []byte("archive"), 30*time.Millisecond) }()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("buffered send should time out while another send holds the lock")
		}
	case <-time.After(time.Second):
		unlock.Do(sendMu.Unlock)
		<-result
		t.Fatal("buffered send deadline did not bound lock contention")
	}
}
