package telemetry

import (
	"io"
	"log/slog"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRaceSummarySavedOncePerSession(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	saveCount := 0
	p.SetRaceSummarySaveCallback(func(sessionUID uint64, counts RaceSummaryCounts, _ *dto.PitwallState) error {
		saveCount++
		if sessionUID == 0 {
			t.Fatal("sessionUID should be non-zero")
		}
		_ = counts
		return nil
	})
	p.SetRaceSummaryRecording(true)

	// Save once for first session.
	p.trySaveRaceSummary(1001, "SEND")
	p.trySaveRaceSummary(1001, "CHQF")
	if saveCount != 1 {
		t.Fatalf("save count = %d, want 1", saveCount)
	}

	// New session should allow a new save.
	p.observeSessionUID(1002)
	p.trySaveRaceSummary(1002, "SEND")
	if saveCount != 2 {
		t.Fatalf("save count = %d, want 2", saveCount)
	}
}

func TestRaceSummaryRespectsDisabledFlag(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	saveCount := 0
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ *dto.PitwallState) error {
		saveCount++
		return nil
	})
	p.SetRaceSummaryRecording(false)

	p.trySaveRaceSummary(2001, "SEND")
	if saveCount != 0 {
		t.Fatalf("save count = %d, want 0", saveCount)
	}
}
