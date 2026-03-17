package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"os/signal"
	"syscall"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/rtc"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	signalingURL := os.Getenv("SIGNALING_URL")
	if signalingURL == "" {
		signalingURL = "wss://signaling-server-production-23c9.up.railway.app/ws"
	}

	udpPort := 20777
	if p := os.Getenv("F1_UDP_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &udpPort)
	}

	fmt.Println("F1 25 Telemetry Sender")
	fmt.Println("======================")

	// Create UDP listener & parser
	udpListener, err := udp.NewListener(udpPort, 2048, logger)
	if err != nil {
		logger.Error("failed to create UDP listener", "error", err)
		os.Exit(1)
	}
	parser := udp.NewParser(logger)

	// Load track data (for delta calculations)
	trackStore := tracks.NewTrackStore("data")

	// Create peer manager
	peerManager := rtc.NewPeerManager(signalingURL, logger)

	// Create DataChannel broadcaster
	broadcaster := rtc.NewDataChannelBroadcaster(peerManager)

	// Create telemetry processor (pitwallState at 4Hz, skip dashboard telemetry)
	processor := telemetry.NewProcessor(parser, broadcaster, 0, logger, trackStore)

	// Track recorder (read-only, no writes in sender mode)
	recorder := telemetry.NewTrackRecorder("data", trackStore, logger)
	processor.PitwallManager().SetRecorder(recorder)

	// Set handlers BEFORE Connect() to avoid races with pion callbacks
	peerManager.SetCountChangeHandler(func(count int) {
		fmt.Printf("\r  Connected Engineers: %d   \n", count)
	})

	peerManager.SetRequestHandler(func(peerID string, msg []byte) []byte {
		var req dto.WSRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			return nil
		}

		switch req.Type {
		case dto.MessageTypeGetBestLap:
			deltaCalc := processor.DeltaCalculator()
			bestLap := deltaCalc.GetBestLapData()
			currentLap := deltaCalc.GetCurrentLapData()

			response := dto.WSResponse{
				Type:      dto.MessageTypeLapData,
				RequestID: req.RequestID,
				Data: dto.LapDataResponse{
					BestLap:     convertLapTelemetryToDTO(bestLap),
					CurrentLap:  convertTelemetryPointsToDTO(currentLap),
					BestLapTime: deltaCalc.GetBestLapTime(),
				},
			}

			responseJSON, err := json.Marshal(response)
			if err != nil {
				logger.Error("failed to marshal lap data response", "error", err)
				return nil
			}
			return responseJSON
		default:
			return nil
		}
	})

	// Connect to signaling server (starts goroutine that reads peer events)
	if err := peerManager.Connect(); err != nil {
		logger.Error("failed to connect to signaling server", "error", err)
		os.Exit(1)
	}

	// Race summary: broadcast result instead of saving to disk
	processor.SetRaceSummarySaveCallback(func(sessionUID uint64, counts telemetry.RaceSummaryCounts, state *dto.PitwallState) error {
		result := dto.WSResponse{
			Type: dto.MessageTypeRaceResult,
			Data: state,
		}
		if msg, err := json.Marshal(result); err == nil {
			broadcaster.Broadcast(msg)
		}
		return nil
	})
	processor.SetRaceSummaryRecording(true)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start components
	go udpListener.Start(ctx)
	go processor.Start(ctx, udpListener.Packets())

	fmt.Printf("  UDP: listening on :%d\n", udpPort)
	fmt.Printf("  Signaling: connected\n")
	fmt.Printf("  Room Code: %s\n", peerManager.RoomCode())
	fmt.Printf("  Connected Engineers: 0\n")
	fmt.Println()
	fmt.Println("Share the room code with your engineer.")
	fmt.Println("Press Ctrl+C to stop.")

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("\nShutting down...")
	cancel()
	peerManager.Close()
	logger.Info("sender shutdown complete")
}

func cleanF32(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

func convertLapTelemetryToDTO(lap *telemetry.LapTelemetry) *dto.LapTelemetryDTO {
	if lap == nil {
		return nil
	}
	result := &dto.LapTelemetryDTO{
		TrackID:   lap.TrackID,
		LapTimeMS: lap.LapTimeMS,
		Sector1MS: lap.Sector1MS,
		Sector2MS: lap.Sector2MS,
		Sector3MS: lap.Sector3MS,
	}
	if len(lap.DataPoints) > 0 {
		result.DataPoints = make([]dto.TelemetryPointDTO, len(lap.DataPoints))
		for i, p := range lap.DataPoints {
			result.DataPoints[i] = dto.TelemetryPointDTO{
				LapDistance: cleanF32(p.LapDistance),
				LapTime:     p.LapTime,
				Speed:       p.Speed,
				Throttle:    cleanF32(p.Throttle),
				Brake:       cleanF32(p.Brake),
				Gear:        p.Gear,
			}
		}
	}
	return result
}

func convertTelemetryPointsToDTO(points []telemetry.TelemetryPoint) []dto.TelemetryPointDTO {
	if len(points) == 0 {
		return nil
	}
	result := make([]dto.TelemetryPointDTO, len(points))
	for i, p := range points {
		result[i] = dto.TelemetryPointDTO{
			LapDistance: p.LapDistance,
			LapTime:     p.LapTime,
			Speed:       p.Speed,
			Throttle:    p.Throttle,
			Brake:       p.Brake,
			Gear:        p.Gear,
		}
	}
	return result
}
