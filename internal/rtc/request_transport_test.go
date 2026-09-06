package rtc

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestRequestCancellationBeforeWorkerAndAcrossGenerations(t *testing.T) {
	parent, closePeer := context.WithCancel(context.Background())
	old := &RequestTransport{ctx: parent}
	first, finishFirst := old.BeginRequest("request")
	old.CancelRequest("request")
	if !errors.Is(first.Err(), context.Canceled) {
		t.Fatal("cancel arriving before worker was lost")
	}
	second, finishSecond := old.BeginRequest("request")
	finishFirst()
	old.CancelRequest("request")
	if second.Err() == nil {
		t.Fatal("old cleanup deleted the replacement request")
	}
	finishSecond()
	nextPeer := &RequestTransport{ctx: context.Background()}
	next, finishNext := nextPeer.BeginRequest("request")
	defer finishNext()
	closePeer()
	old.CancelRequest("request")
	if next.Err() != nil {
		t.Fatal("previous connection canceled a new peer generation")
	}
	closed, finishClosed := old.BeginRequest("after-close")
	defer finishClosed()
	if closed.Err() == nil {
		t.Fatal("closed peer accepted a stream")
	}
}

func TestBufferedCancellationStopsWhileSendLockBusy(t *testing.T) {
	channel := openTestDataChannel(t)
	var sendMu sync.Mutex
	sendMu.Lock()
	defer sendMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- sendDataChannelWithContext(ctx, channel, &sendMu, 1, 5*time.Second, func() error { t.Error("canceled send ran"); return nil })
	}()
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("send error: %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("cancel did not interrupt backpressure")
	}
}
