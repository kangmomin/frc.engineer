package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/rtc"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/updater"
)

var appVersion = "v3.5.0"

func main() {
	// Log to file so the cmd banner stays clean
	if err := os.MkdirAll("logs", 0755); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logs dir: %v\n", err)
		os.Exit(1)
	}
	logFile, err := os.OpenFile("logs/sender.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open log file: %v\n", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewTextHandler(logFile, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Auto-update: clean previous artifacts, then check for updates
	updater.CleanOldBinary(logger)
	if err := updater.AutoUpdate(logger, appVersion); err != nil {
		logger.Warn("auto-update failed, continuing with current version", "error", err)
	}

	signalingURL := os.Getenv("SIGNALING_URL")
	if signalingURL == "" {
		signalingURL = "wss://signaling-server-production-23c9.up.railway.app/ws"
	}

	settingsPort := os.Getenv("SETTINGS_PORT")
	if settingsPort == "" {
		settingsPort = "8099"
	}
	comparePassword := os.Getenv("ERS_COMPARE_PASSWORD")
	roomName := strings.TrimSpace(os.Getenv("SENDER_ROOM_NAME"))
	if roomName == "" {
		if host, err := os.Hostname(); err == nil && strings.TrimSpace(host) != "" {
			roomName = strings.TrimSpace(host)
		} else {
			roomName = "Sender Room"
		}
	}
	roomPassword := os.Getenv("SENDER_ROOM_PASSWORD")

	udpPort := 20777
	if p := os.Getenv("F1_UDP_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &udpPort)
	}

	saveFiles := strings.EqualFold(os.Getenv("SAVE_FILES"), "true")
	trackRecording := saveFiles // default: follow saveFiles for backward compat

	// Create UDP listener & parser
	udpListener, err := udp.NewListener(udpPort, 2048, logger)
	if err != nil {
		logger.Error("failed to create UDP listener", "error", err)
		os.Exit(1)
	}
	parser := udp.NewParser(logger)

	// Create UDP forwarder and attach to listener
	forwarder := udp.NewForwarder(logger)
	udpListener.SetForwarder(forwarder)

	// Load track data (for delta calculations)
	trackDataDir := filepath.Join("data", "tracks")
	trackStore := tracks.NewTrackStore(trackDataDir)

	// Create peer manager
	peerManager := rtc.NewPeerManager(signalingURL, logger)
	peerManager.SetRoomMetadata(roomName, roomPassword)

	// Create DataChannel broadcaster
	broadcaster := rtc.NewDataChannelBroadcaster(peerManager)

	// Create telemetry processor (pitwallState at 4Hz, skip dashboard telemetry)
	processor := telemetry.NewProcessor(parser, broadcaster, 0, logger, trackStore)
	compareGate, err := newERSCompareGate(comparePassword)
	if err != nil {
		logger.Error("failed to initialize ERS compare gate", "error", err)
		os.Exit(1)
	}
	compareMonitor := newERSCompareMonitor("logs/ers_compare", logger)
	processor.SetPitwallStateObserver(compareMonitor.Observe)

	// Track recorder (independently toggled from save files)
	recorder := telemetry.NewTrackRecorder(trackDataDir, trackStore, logger)
	recorder.SetEnabled(trackRecording)
	processor.PitwallManager().SetRecorder(recorder)
	processor.PitwallManager().SetERSActualEnabled(true)
	processor.PitwallManager().SetERSComparisonEnabled(false)
	trackState := senderProcessorTrackState{processor: processor}

	// Runtime config state protected by mutex
	var cfgMu sync.Mutex
	cfgUDPPort := udpPort
	cfgSaveFiles := saveFiles
	cfgTrackRecording := trackRecording
	cfgRoomName := roomName
	cfgRoomPassword := roomPassword
	cfgForwardTargets := []rtconfig.ForwardTarget{}
	var raceStorage *races.FileStorage
	if saveFiles {
		rs, err := races.NewFileStorage("data/races", logger)
		if err != nil {
			logger.Warn("failed to create race storage, file saving disabled", "error", err)
		}
		raceStorage = rs
	}

	// Set handlers BEFORE Connect() to avoid races with pion callbacks
	peerManager.SetCountChangeHandler(func(count int) {
		logger.Info("peer count changed", "connectedEngineers", count)
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

	processor.SetRaceSummarySaveCallback(func(sessionUID uint64, counts telemetry.RaceSummaryCounts, state *dto.PitwallState) error {
		cfgMu.Lock()
		rs := raceStorage
		cfgMu.Unlock()

		if rs != nil {
			summary := races.BuildSummary(sessionUID, state, races.NotificationCounts{
				Penalty: counts.Penalty,
				Warning: counts.Warning,
				Info:    counts.Info,
			}, time.Now())
			if _, err := rs.Save(summary); err != nil {
				logger.Error("failed to save race summary", "error", err)
			}
		}

		// Always broadcast to connected engineers
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

	// Settings HTTP server
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(settingsHTML)
	})

	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		port := cfgUDPPort
		sf := cfgSaveFiles
		rn := cfgRoomName
		rp := cfgRoomPassword
		cfgMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"roomCode":           peerManager.RoomCode(),
			"roomName":           rn,
			"roomProtected":      rp != "",
			"connectedEngineers": peerManager.ConnectedCount(),
			"udpPort":            port,
			"saveFiles":          sf,
			"ersCompareEnabled":  compareGate.Enabled(),
			"ersCompareMetrics":  compareMonitor.Snapshot(),
			"currentTrack":       getCurrentTrack(trackState, trackStore),
		})
	})

	mux.HandleFunc("GET /api/tracks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trackStore.ListLoaded())
	})

	mux.HandleFunc("GET /api/tracks/current-preview", func(w http.ResponseWriter, r *http.Request) {
		preview, err := getCurrentTrackPreview(trackState, trackStore)
		if err != nil {
			logger.Error("failed to load current track preview", "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to load current track preview"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(preview)
	})

	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		port := cfgUDPPort
		sf := cfgSaveFiles
		tr := cfgTrackRecording
		rn := cfgRoomName
		rp := cfgRoomPassword
		ft := make([]rtconfig.ForwardTarget, len(cfgForwardTargets))
		copy(ft, cfgForwardTargets)
		cfgMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":        port,
			"saveFiles":      sf,
			"trackRecording": tr,
			"roomName":       rn,
			"roomPassword":   rp,
			"forwardTargets": ft,
		})
	})

	mux.HandleFunc("PUT /api/config", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UDPPort                            int                      `json:"udpPort"`
			SaveFiles                          bool                     `json:"saveFiles"`
			TrackRecording                     bool                     `json:"trackRecording"`
			TrackRecordingOverwriteApprovedFor string                   `json:"trackRecordingOverwriteApprovedFor"`
			RoomName                           string                   `json:"roomName"`
			RoomPassword                       string                   `json:"roomPassword"`
			ForwardTargets                     []rtconfig.ForwardTarget `json:"forwardTargets"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}
		if body.UDPPort < 1 || body.UDPPort > 65535 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "port must be 1-65535"})
			return
		}
		if len(body.ForwardTargets) > 16 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "too many forward targets (max 16)"})
			return
		}
		for _, ft := range body.ForwardTargets {
			if ft.Host == "" || ft.Port < 1 || ft.Port > 65535 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid forward target: host required, port 1-65535"})
				return
			}
		}

		cfgMu.Lock()
		defer cfgMu.Unlock()

		nextRoomName := strings.TrimSpace(body.RoomName)
		if nextRoomName == "" {
			nextRoomName = "Sender Room"
		}
		nextRoomPassword := body.RoomPassword

		if body.TrackRecording && !cfgTrackRecording {
			currentTrack := getCurrentTrack(trackState, trackStore)
			if currentTrack != nil && currentTrack.HasRecordedPreview && body.TrackRecordingOverwriteApprovedFor != currentTrack.Filename {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{
					"error":                    "recorded track data already exists for the current track",
					"requiresOverwriteConfirm": true,
					"currentTrack":             currentTrack,
				})
				return
			}
		}

		// Rebind UDP port if changed
		if body.UDPPort != cfgUDPPort {
			if err := udpListener.Rebind(body.UDPPort); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("rebind failed: %v", err)})
				return
			}
			logger.Info("UDP port changed", "from", cfgUDPPort, "to", body.UDPPort)
			cfgUDPPort = body.UDPPort
		}

		// Toggle save files (race storage) if changed
		if body.SaveFiles != cfgSaveFiles {
			cfgSaveFiles = body.SaveFiles
			if body.SaveFiles {
				if raceStorage == nil {
					rs, err := races.NewFileStorage("data/races", logger)
					if err != nil {
						logger.Warn("failed to create race storage", "error", err)
					} else {
						raceStorage = rs
					}
				}
			} else {
				raceStorage = nil
			}
			logger.Info("save files changed", "enabled", body.SaveFiles)
		}

		// Toggle track recording independently
		if body.TrackRecording != cfgTrackRecording {
			cfgTrackRecording = body.TrackRecording
			recorder.SetEnabled(body.TrackRecording)
			logger.Info("track recording changed", "enabled", body.TrackRecording)
		}

		if nextRoomName != cfgRoomName || nextRoomPassword != cfgRoomPassword {
			cfgRoomName = nextRoomName
			cfgRoomPassword = nextRoomPassword
			peerManager.UpdateRoomMetadata(cfgRoomName, cfgRoomPassword)
			logger.Info("room metadata changed", "roomName", cfgRoomName, "protected", cfgRoomPassword != "")
		}

		// Update forward targets
		cfgForwardTargets = make([]rtconfig.ForwardTarget, len(body.ForwardTargets))
		copy(cfgForwardTargets, body.ForwardTargets)
		forwarder.UpdateTargets(body.ForwardTargets)
		logger.Info("forward targets updated", "count", len(body.ForwardTargets))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":        cfgUDPPort,
			"saveFiles":      cfgSaveFiles,
			"trackRecording": cfgTrackRecording,
			"roomName":       cfgRoomName,
			"roomPassword":   cfgRoomPassword,
			"forwardTargets": cfgForwardTargets,
		})
	})

	mux.HandleFunc("POST /api/ers-compare/unlock", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}
		if !compareGate.Enable(body.Password) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid compare password"})
			return
		}
		processor.PitwallManager().SetERSComparisonEnabled(true)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"enabled": true})
	})

	mux.HandleFunc("POST /api/ers-compare/lock", func(w http.ResponseWriter, r *http.Request) {
		compareGate.Disable()
		compareMonitor.Reset()
		processor.PitwallManager().SetERSComparisonEnabled(false)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"enabled": false})
	})

	settingsSrv := &http.Server{Addr: ":" + settingsPort, Handler: mux}
	go func() {
		logger.Info("settings server starting", "port", settingsPort)
		if err := settingsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("settings server failed", "error", err)
		}
	}()

	logger.Info("sender started",
		"udpPort", udpPort,
		"roomName", cfgRoomName,
		"roomCode", peerManager.RoomCode(),
		"settingsURL", fmt.Sprintf("http://localhost:%s", settingsPort),
	)

	// System tray: blocks until user clicks Quit
	settingsURL := fmt.Sprintf("http://localhost:%s", settingsPort)
	runTray(settingsURL, func() {
		cancel()
		forwarder.Close()
		peerManager.Close()
		compareMonitor.Close()
		settingsSrv.Shutdown(context.Background())
		logger.Info("sender shutdown complete")
		logFile.Close()
	})
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
