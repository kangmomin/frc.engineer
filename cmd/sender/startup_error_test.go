package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"
)

func TestClassifyBindErrorDetectsPortInUse(t *testing.T) {
	first, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer first.Close()

	_, err = net.ListenUDP("udp4", first.LocalAddr().(*net.UDPAddr))
	if err == nil {
		t.Fatal("second bind on the same port unexpectedly succeeded")
	}
	if got := classifyBindError(err); got != bindReasonInUse {
		t.Fatalf("classifyBindError(%v) = %q, want %q", err, got, bindReasonInUse)
	}
}

func TestClassifyBindErrorUnknown(t *testing.T) {
	if got := classifyBindError(errors.New("boom")); got != bindReasonUnknown {
		t.Fatalf("classifyBindError = %q, want %q", got, bindReasonUnknown)
	}
}

func TestWriteStartupErrorEmitsSinglePrefixedJSONLine(t *testing.T) {
	var buf bytes.Buffer
	writeStartupError(&buf, startupError{
		Code: startupErrorUDPPort, Protocol: "udp", Port: 20777,
		Reason: bindReasonInUse, Detail: "listen udp4 0.0.0.0:20777: bind: address already in use", Fatal: true,
	})

	line := buf.String()
	if !strings.HasPrefix(line, startupErrorPrefix) || !strings.HasSuffix(line, "\n") || strings.Count(line, "\n") != 1 {
		t.Fatalf("unexpected line framing: %q", line)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(strings.TrimPrefix(strings.TrimSuffix(line, "\n"), startupErrorPrefix)), &got); err != nil {
		t.Fatalf("payload is not JSON: %v", err)
	}
	// Driver Pack (electron/sender-startup-error.cjs) depends on these keys.
	want := map[string]any{"code": "udp_port_unavailable", "protocol": "udp", "port": float64(20777), "reason": "in_use", "fatal": true}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("%s = %v, want %v", key, got[key], value)
		}
	}
}
