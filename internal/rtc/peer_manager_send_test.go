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
	return channel
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
