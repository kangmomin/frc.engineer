package rtc

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"frc.engineer/internal/signaling"
	"github.com/gorilla/websocket"
)

func TestIntercomTransportIsJoinedBeforeIntercomMembership(t *testing.T) {
	manager := NewPeerManager("ws://unused", slog.New(slog.NewTextHandler(io.Discard, nil)))
	manager.sigMu.Lock()
	manager.signalingReady = true
	manager.intercomVersion = 1
	manager.intercomJoined = false
	state := manager.intercomTransportStateLocked()
	manager.sigMu.Unlock()
	if !state.Joined || state.IntercomVersion != 1 {
		t.Fatalf("fresh authenticated transport state = %+v", state)
	}
}

func TestIntercomSignalingWriteRejectsReplacedConnection(t *testing.T) {
	manager := NewPeerManager("ws://unused", slog.New(slog.NewTextHandler(io.Discard, nil)))
	current := &websocket.Conn{}
	stale := &websocket.Conn{}
	manager.sigMu.Lock()
	manager.sigConn = current
	manager.signalingReady = true
	manager.intercomVersion = signaling.IntercomProtocolVersion
	manager.sigMu.Unlock()
	if manager.sendSignalingOn(stale, signaling.Message{Type: signaling.TypeIntercomLeave, RequestID: "leave-1"}) {
		t.Fatal("intercom message crossed onto a replacement signaling connection")
	}
}

func TestIntercomReplayKeepsHighestRevisionWithinMembershipGeneration(t *testing.T) {
	manager := NewPeerManager("ws://unused", slog.New(slog.NewTextHandler(io.Discard, nil)))
	payload := func(value any) json.RawMessage {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
	joined := signaling.Message{Type: signaling.TypeIntercomJoined, RequestID: "join-1", Payload: payload(signaling.IntercomJoinedPayload{
		MembershipGeneration: 1,
		Snapshot:             signaling.IntercomSnapshot{Revision: 1},
	})}
	newest := signaling.Message{Type: signaling.TypeIntercomState, Payload: payload(signaling.IntercomSnapshot{Revision: 3})}
	duplicateJoined := cloneSignalingMessage(joined)
	older := signaling.Message{Type: signaling.TypeIntercomState, RequestID: "private-retry", Payload: payload(signaling.IntercomSnapshot{Revision: 2})}

	manager.handleIntercomMessage(joined)
	manager.handleIntercomMessage(newest)
	manager.handleIntercomMessage(duplicateJoined)
	manager.handleIntercomMessage(older)
	_, replay := manager.IntercomReplay()
	if len(replay) != 2 || replay[0].Type != signaling.TypeIntercomJoined || replay[1].Type != signaling.TypeIntercomState {
		t.Fatalf("replay = %+v", replay)
	}
	var state signaling.IntercomSnapshot
	if err := json.Unmarshal(replay[1].Payload, &state); err != nil || state.Revision != 3 {
		t.Fatalf("replayed state = %+v, %v", state, err)
	}
}
