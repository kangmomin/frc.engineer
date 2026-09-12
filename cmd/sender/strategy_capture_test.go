package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

// These optional, local fixtures are real 2026 UDP captures. Feed both the main
// recording and its SEND/final-classification tail through the production
// processor and uploader, so isolated model fixtures cannot hide missing data.
func TestStrategyRawCapturesReachUpload(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		laps, clean int
	}{
		{"race-clean-start", 11, 3}, {"race-edge-cases", 3, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			files, err := filepath.Glob(filepath.Join("../../test-sets", scenario.name, "*", "raw.bin"))
			if err != nil {
				t.Fatal(err)
			}
			if len(files) == 0 {
				t.Skip("local real-race captures are not installed; see test-sets/README.md")
			}
			if len(files) != 2 {
				t.Fatal("both main capture and session-end tail are required")
			}
			sort.Strings(files)
			logger := testUploadLogger()
			p := telemetry.NewProcessor(udp.NewParser(logger), websocket.NewHub(8, logger), 0, logger, nil)
			p.SetDashboardEnabled(false)
			p.SetCheckpointSaves(true)
			p.SetRaceSummaryRecording(true)
			var summary *races.RaceSummary
			p.SetRaceSummarySaveCallback(func(uid uint64, _ telemetry.RaceSummaryCounts, timeline []dto.RaceControlNotification, state *dto.PitwallState, detail *dto.RaceDetailInput) error {
				summary = races.BuildSummary(uid, state, races.NotificationCounts{}, timeline, detail, time.Now())
				return nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			input := make(chan []byte, 64)
			go p.Start(ctx, input)
			t.Cleanup(func() { cancel(); <-p.Done() })
			for _, file := range files {
				feedStrategyCapture(t, ctx, input, file)
			}
			close(input)
			<-p.Done()
			if ctx.Err() != nil {
				t.Fatal("raw replay timed out")
			}
			if summary == nil || summary.PrivateCapture == nil || summary.PrivateCapture.Strategy == nil {
				t.Fatal("real race did not produce private strategy evidence")
			}
			req, ok := buildUploadRequest(summary, logger)
			if !ok || req.Strategy == nil || len(req.Strategy.Laps) != scenario.laps {
				t.Fatal("completed timings or evidence were lost before upload")
			}
			if err := strategy.ValidateEvidence(req.Strategy); err != nil {
				t.Fatal(err)
			}
			d := strategy.Diagnose([]strategy.Record{{TrackID: req.TrackID, AccountID: "capture", RaceID: "capture", Evidence: *req.Strategy}})
			if d.CleanLaps != scenario.clean || d.CollectedLaps != scenario.laps {
				t.Fatalf("real clean laps were excluded: %+v", d)
			}
			raw, err := json.Marshal(req)
			if err != nil || len(raw) > uploadRequestSafetyBytes {
				t.Fatal("upload exceeded HTTP budget", err)
			}
			t.Logf("real capture: uploaded laps=%d usable=%d request bytes=%d", d.CollectedLaps, d.CleanLaps, len(raw))
		})
	}
}

func feedStrategyCapture(t *testing.T, ctx context.Context, input chan<- []byte, path string) {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 256*1024)
	for {
		var size uint32
		if err := binary.Read(r, binary.LittleEndian, &size); err == io.EOF {
			return
		} else if err != nil {
			t.Fatal(err)
		}
		if size == 0 || size > 65536 {
			t.Fatal("invalid capture packet length", size)
		}
		packet := make([]byte, size)
		if _, err := io.ReadFull(r, packet); err != nil {
			t.Fatal(err)
		}
		select {
		case input <- packet:
		case <-ctx.Done():
			t.Fatal("capture replay interrupted", ctx.Err())
		}
	}
}
