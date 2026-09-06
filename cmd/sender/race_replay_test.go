package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func TestReplayCancellationStopsProductionReaderAndBatch(t *testing.T) {
	storage, err := races.NewFileStorage(t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	summary := &races.RaceSummary{ID: "cancel", Replay: &races.ReplayTimeline{Frames: make([]races.ReplayFrame, 200)}}
	for i := range summary.Replay.Frames {
		summary.Replay.Frames[i] = races.ReplayFrame{Timestamp: int64(i), Pitwall: &dto.PitwallState{Drivers: make([]dto.DriverInfo, 24)}}
	}
	if _, err := storage.Save(summary); err != nil {
		t.Fatal(err)
	}
	for _, cancelAt := range []string{dto.MessageTypeRaceReplayMeta, dto.MessageTypeRaceReplayChunk} {
		t.Run(cancelAt, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			callsAfterCancel, chunks := 0, 0
			err := streamRaceReplay(ctx, storage, "request", "cancel", func(message dto.WSResponse) error {
				if ctx.Err() != nil {
					callsAfterCancel++
				}
				if message.Type == dto.MessageTypeRaceReplayChunk {
					chunks++
				}
				if message.Type == cancelAt {
					cancel()
				}
				return nil
			})
			if !errors.Is(err, context.Canceled) || callsAfterCancel != 0 || chunks > 1 {
				t.Fatalf("cancel: err=%v late=%d chunks=%d", err, callsAfterCancel, chunks)
			}
			// Reader/Windows snapshot cleanup must let the actual same-ID file be replaced.
			if _, err := storage.Save(summary); err != nil {
				t.Fatal(err)
			}
		})
	}
}
