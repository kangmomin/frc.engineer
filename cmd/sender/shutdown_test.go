package main

import (
	"context"
	"encoding/binary"
	"io"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/races"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

func TestManagedShutdownFlushesProcessorBeforeDone(t *testing.T) {
	for _, command := range []string{"shutdown\n", ""} {
		name := "command"
		if command == "" {
			name = "parent-pipe-closed"
		}
		t.Run(name, func(t *testing.T) {
			logger := testUploadLogger()
			rs, err := races.NewFileStorage(t.TempDir(), logger)
			if err != nil {
				t.Fatal(err)
			}
			p := telemetry.NewProcessor(udp.NewParser(logger), websocket.NewHub(8, logger), 0, logger, nil)
			p.SetCheckpointSaves(true)
			p.SetRaceSummaryRecording(true)
			saving := make(chan struct{})
			finishSave := make(chan struct{})
			releaseSave := sync.OnceFunc(func() { close(finishSave) })
			defer releaseSave()
			var savedID string
			p.SetRaceSummarySaveCallback(func(uid uint64, counts telemetry.RaceSummaryCounts, timeline []dto.RaceControlNotification, state *dto.PitwallState, detail *dto.RaceDetailInput) error {
				close(saving)
				<-finishSave
				summary := races.BuildSummary(uid, state, races.NotificationCounts{}, timeline, detail, time.Now())
				var err error
				savedID, err = rs.Save(summary)
				return err
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			input, control := io.Pipe()
			defer input.Close()
			defer control.Close()
			go watchManagedShutdown(input, cancel)
			packetCh := make(chan []byte)
			go p.Start(ctx, packetCh)
			// Feed a real wire-format history packet: one completed lap, no SEND.
			raw := make([]byte, packets.PacketHeaderSize+7+packets.LapHistoryDataSize*packets.MaxNumLapsInHistory+packets.TyreStintHistorySize*packets.MaxTyreStints)
			binary.LittleEndian.PutUint16(raw, packets.PacketFormat2026)
			raw[6] = byte(packets.PacketIDSessionHistory)
			binary.LittleEndian.PutUint64(raw[7:], 42)
			raw[packets.PacketHeaderSize+1] = 1
			binary.LittleEndian.PutUint32(raw[packets.PacketHeaderSize+7:], 90000)
			packetCh <- raw
			deadline := time.After(3 * time.Second)
			for !p.PitwallManager().PlayerHasCompletedLap() {
				select {
				case <-deadline:
					t.Fatal("history packet was not processed")
				case <-time.After(time.Millisecond):
				}
			}
			if command != "" {
				if _, err := io.WriteString(control, command); err != nil {
					t.Fatal(err)
				}
			} else {
				control.Close()
			}
			select {
			case <-saving:
			case <-time.After(3 * time.Second):
				releaseSave()
				t.Fatal("managed shutdown did not trigger a checkpoint")
			}
			select {
			case <-p.Done():
				t.Error("processor exited before its checkpoint finished")
			default:
			}
			releaseSave()
			select {
			case <-p.Done():
			case <-time.After(3 * time.Second):
				t.Fatal("processor did not exit after saving")
			}
			saved, err := rs.Load(savedID)
			if err != nil {
				t.Fatal(err)
			}
			if saved.SessionUID != 42 || len(saved.Detail.Laps) != 1 || saved.Detail.FinalizeTrigger != "shutdown" {
				t.Fatalf("shutdown checkpoint lost capture: %+v", saved)
			}
		})
	}
}
