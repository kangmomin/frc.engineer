package signaling

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type intercomFixture struct {
	messageType string
	payload     func() any
	requestID   bool
}

func TestIntercomCanonicalMessages(t *testing.T) {
	fixtures := map[string]intercomFixture{
		"client_group_create.json":         {TypeIntercomGroupCreate, func() any { return &IntercomGroupCreatePayload{} }, true},
		"client_join.json":                 {TypeIntercomJoin, func() any { return &IntercomJoinPayload{} }, true},
		"client_leave.json":                {TypeIntercomLeave, func() any { return &IntercomLeavePayload{} }, true},
		"client_activity.json":             {TypeIntercomActivity, func() any { return &IntercomActivityPayload{} }, false},
		"client_private_set.json":          {TypeIntercomPrivateSet, func() any { return &IntercomPrivateSetPayload{} }, true},
		"client_private_ready.json":        {TypeIntercomPrivateReady, func() any { return &IntercomPrivateReadyPayload{} }, false},
		"client_sfu_session_new.json":      {TypeIntercomSFUSessionNew, func() any { return &IntercomSFUSessionNewPayload{} }, true},
		"client_sfu_publish.json":          {TypeIntercomSFUPublish, func() any { return &IntercomSFUPublishPayload{} }, true},
		"client_sfu_subscribe.json":        {TypeIntercomSFUSubscribe, func() any { return &IntercomSFUSubscribePayload{} }, true},
		"client_sfu_renegotiate.json":      {TypeIntercomSFURenegotiate, func() any { return &IntercomSFURenegotiatePayload{} }, true},
		"client_sfu_close.json":            {TypeIntercomSFUClose, func() any { return &IntercomSFUClosePayload{} }, true},
		"server_room_joined_features.json": {TypeRoomJoined, nil, false},
		"server_joined.json":               {TypeIntercomJoined, func() any { return &IntercomJoinedPayload{} }, true},
		"server_left.json":                 {TypeIntercomLeft, func() any { return &IntercomLeftPayload{} }, true},
		"server_state.json":                {TypeIntercomState, func() any { return &IntercomSnapshot{} }, false},
		"server_private_state.json":        {TypeIntercomState, func() any { return &IntercomSnapshot{} }, true},
		"server_error.json":                {TypeIntercomError, func() any { return &IntercomErrorPayload{} }, true},
		"server_sfu_session.json":          {TypeIntercomSFUSession, func() any { return &IntercomSFUSessionPayload{} }, true},
		"server_sfu_published.json":        {TypeIntercomSFUPublished, func() any { return &IntercomSFUPublishedPayload{} }, true},
		"server_sfu_subscribed.json":       {TypeIntercomSFUSubscribed, func() any { return &IntercomSFUSubscribedPayload{} }, true},
		"server_sfu_renegotiated.json":     {TypeIntercomSFURenegotiated, func() any { return &IntercomSFURenegotiatedPayload{} }, true},
		"server_sfu_closed.json":           {TypeIntercomSFUClosed, func() any { return &IntercomSFUClosedPayload{} }, true},
		"local_bridge_state.json":          {TypeIntercomBridgeState, func() any { return &IntercomBridgeStatePayload{} }, false},
	}

	entries, err := os.ReadDir("testdata/intercom")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != len(fixtures) {
		t.Fatalf("fixture count = %d, registry count = %d", len(entries), len(fixtures))
	}

	seenTypes := make(map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() {
			t.Fatalf("unexpected fixture directory %q", entry.Name())
		}
		fixture, ok := fixtures[entry.Name()]
		if !ok {
			t.Fatalf("unregistered canonical fixture %q", entry.Name())
		}
		t.Run(entry.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("testdata/intercom", entry.Name()))
			if err != nil {
				t.Fatal(err)
			}

			var message Message
			decodeJSONStrict(t, raw, &message)
			if message.Type != fixture.messageType {
				t.Fatalf("type = %q, want %q", message.Type, fixture.messageType)
			}
			if (message.RequestID != "") != fixture.requestID {
				t.Fatalf("requestId presence = %t, want %t", message.RequestID != "", fixture.requestID)
			}
			if entry.Name() == "server_room_joined_features.json" {
				if message.Features == nil || message.Features.IntercomVersion != IntercomProtocolVersion {
					t.Fatalf("features = %+v, want intercom version %d", message.Features, IntercomProtocolVersion)
				}
			} else if message.Features != nil {
				t.Fatalf("unexpected features: %+v", message.Features)
			}
			if fixture.payload == nil {
				if len(message.Payload) != 0 {
					t.Fatalf("unexpected payload: %s", message.Payload)
				}
			} else {
				if len(message.Payload) == 0 {
					t.Fatal("missing payload")
				}
				payload := fixture.payload()
				decodeJSONStrict(t, message.Payload, payload)
				roundTripped, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				assertJSONEqual(t, message.Payload, roundTripped)
			}

			roundTripped, err := json.Marshal(message)
			if err != nil {
				t.Fatal(err)
			}
			assertJSONEqual(t, raw, roundTripped)
			seenTypes[message.Type] = true
		})
	}

	for _, messageType := range intercomMessageTypes() {
		if !seenTypes[messageType] {
			t.Errorf("message type %q has no canonical fixture", messageType)
		}
	}
}

func TestIntercomProtocolScalarConstants(t *testing.T) {
	want := map[string]string{
		"version":                    fmt.Sprint(IntercomProtocolVersion),
		"role_driver":                string(IntercomRoleDriver),
		"role_engineer":              string(IntercomRoleEngineer),
		"role_chief":                 string(IntercomRoleChief),
		"track_driver_engineer":      string(IntercomTrackDriverEngineer),
		"track_driver_chief":         string(IntercomTrackDriverChief),
		"track_engineer_bus":         string(IntercomTrackEngineerBus),
		"track_driver_radio":         string(IntercomTrackDriverRadio),
		"track_chief_private":        string(IntercomTrackChiefPrivate),
		"private_preparing":          string(IntercomPrivatePreparing),
		"private_active":             string(IntercomPrivateActive),
		"session_description_offer":  string(IntercomSDPOffer),
		"session_description_answer": string(IntercomSDPAnswer),
	}

	expected := map[string]string{
		"version":                    "1",
		"role_driver":                "driver",
		"role_engineer":              "engineer",
		"role_chief":                 "chief",
		"track_driver_engineer":      "driver_engineer",
		"track_driver_chief":         "driver_chief",
		"track_engineer_bus":         "engineer_bus",
		"track_driver_radio":         "driver_radio",
		"track_chief_private":        "chief_private",
		"private_preparing":          "preparing",
		"private_active":             "active",
		"session_description_offer":  "offer",
		"session_description_answer": "answer",
	}
	if !reflect.DeepEqual(want, expected) {
		t.Fatalf("protocol constants = %#v, want %#v", want, expected)
	}
}

func TestIntercomRequestIDUsesRawUTF8ByteLimit(t *testing.T) {
	if !validIntercomRequestID(strings.Repeat("a", maxIntercomRequestID)) {
		t.Fatal("request ID at the raw byte limit was rejected")
	}
	if validIntercomRequestID(" " + strings.Repeat("a", maxIntercomRequestID) + " ") {
		t.Fatal("oversized raw request ID was accepted after trimming")
	}
	if validIntercomRequestID(string([]byte{0xff})) {
		t.Fatal("invalid UTF-8 request ID was accepted")
	}
}

func TestIntercomCanonicalPayloadRejectsUnknownField(t *testing.T) {
	raw := []byte(`{"displayName":"Engineer A","password":"secret","unexpected":true}`)
	var payload IntercomGroupCreatePayload
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err == nil {
		t.Fatal("unknown payload field was accepted by strict contract decoder")
	}
}

func intercomMessageTypes() []string {
	messageTypes := []string{
		TypeIntercomGroupCreate,
		TypeIntercomJoin,
		TypeIntercomLeave,
		TypeIntercomActivity,
		TypeIntercomPrivateSet,
		TypeIntercomPrivateReady,
		TypeIntercomSFUSessionNew,
		TypeIntercomSFUPublish,
		TypeIntercomSFUSubscribe,
		TypeIntercomSFURenegotiate,
		TypeIntercomSFUClose,
		TypeIntercomJoined,
		TypeIntercomLeft,
		TypeIntercomState,
		TypeIntercomError,
		TypeIntercomSFUSession,
		TypeIntercomSFUPublished,
		TypeIntercomSFUSubscribed,
		TypeIntercomSFURenegotiated,
		TypeIntercomSFUClosed,
		TypeIntercomBridgeState,
	}
	sort.Strings(messageTypes)
	return messageTypes
}

func decodeJSONStrict(t *testing.T, raw []byte, destination any) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		t.Fatal(err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		t.Fatalf("canonical fixture has trailing JSON: %v", err)
	}
}

func assertJSONEqual(t *testing.T, left, right []byte) {
	t.Helper()
	var leftValue any
	var rightValue any
	if err := json.Unmarshal(left, &leftValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(right, &rightValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(leftValue, rightValue) {
		t.Fatalf("JSON mismatch\nleft:  %s\nright: %s", left, right)
	}
}
