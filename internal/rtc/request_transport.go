package rtc

import (
	"context"
	"sync"
	"time"
)

// RequestTransport belongs to one reliable channel generation, even when the
// same peer ID reconnects. BeginRequest registers cancellation synchronously,
// before the caller starts its stream goroutine.
type RequestTransport struct {
	ctx      context.Context
	send     func(context.Context, []byte, time.Duration) error
	mu       sync.Mutex
	requests map[string]*requestCancellation
}

type requestCancellation struct{ cancel context.CancelFunc }

func (t *RequestTransport) BeginRequest(id string) (context.Context, func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.requests == nil {
		t.requests = make(map[string]*requestCancellation)
	}
	if previous := t.requests[id]; previous != nil {
		previous.cancel()
	}
	ctx, cancel := context.WithCancel(t.ctx)
	request := &requestCancellation{cancel: cancel}
	t.requests[id] = request
	return ctx, func() {
		cancel()
		t.mu.Lock()
		defer t.mu.Unlock()
		if t.requests[id] == request {
			delete(t.requests, id)
		}
	}
}

func (t *RequestTransport) CancelRequest(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if request := t.requests[id]; request != nil {
		request.cancel()
	}
}

func (t *RequestTransport) SendBuffered(ctx context.Context, message []byte, wait time.Duration) error {
	if err := t.ctx.Err(); err != nil {
		return err
	}
	return t.send(ctx, message, wait)
}
