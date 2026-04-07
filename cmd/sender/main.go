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

	"github.com/energye/systray"

	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/rtc"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
)

var appVersion = "v4.7.0"

// trackStrategyConfig holds per-track strategy overlay settings.
type trackStrategyConfig struct {
	PitTimeLossMs      int `json:"pitTimeLossMs"`
	UndercutDifficulty int `json:"undercutDifficulty"` // 1=easy, 2=medium, 3=hard
}

var defaultStrategyConfig = trackStrategyConfig{PitTimeLossMs: 22000, UndercutDifficulty: 2}

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

	settingsPort := os.Getenv("SETTINGS_PORT")
	if settingsPort == "" {
		settingsPort = "8099"
	}

	// Start system tray early so update progress is visible via tooltip
	ctx, cancel := context.WithCancel(context.Background())
	settingsURL := fmt.Sprintf("http://localhost:%s", settingsPort)
	trayReady := startTray(settingsURL, appVersion, func() {
		cancel()
	})
	<-trayReady

	systray.SetTooltip("FRC Pitwall Sender " + appVersion + " — Running")

	signalingURL := os.Getenv("SIGNALING_URL")
	if signalingURL == "" {
		signalingURL = "wss://signaling-server-production-23c9.up.railway.app/ws"
	}
	roomName := strings.TrimSpace(os.Getenv("SENDER_ROOM_NAME"))
	if roomName == "" {
		if host, err := os.Hostname(); err == nil && strings.TrimSpace(host) != "" {
			roomName = strings.TrimSpace(host)
		} else {
			roomName = "Sender Room"
		}
	}
	roomPassword := os.Getenv("SENDER_ROOM_PASSWORD")
	defaultPermissionsCode := os.Getenv("DEFAULT_PERMISSIONS_CODE")

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
	peerManager.SetDefaultPermissionsCode(defaultPermissionsCode)

	// Create DataChannel broadcaster
	broadcaster := rtc.NewDataChannelBroadcaster(peerManager)

	// Create telemetry processor (pitwallState at 4Hz, skip dashboard telemetry)
	processor := telemetry.NewProcessor(parser, broadcaster, 0, logger, trackStore)
	processor.SetFastBroadcaster(broadcaster)
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
	cfgDefaultPermissionsCode := defaultPermissionsCode
	cfgForwardTargets := []rtconfig.ForwardTarget{}
	cfgStrategySettings := map[int8]trackStrategyConfig{}
	getStrategyConfig := func(trackID int8) trackStrategyConfig {
		cfgMu.Lock()
		defer cfgMu.Unlock()
		if cfg, ok := cfgStrategySettings[trackID]; ok {
			return cfg
		}
		return defaultStrategyConfig
	}
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
		if count > 0 {
			processor.PitwallManager().ResendTrackMap()
		}
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

	// Start components
	go udpListener.Start(ctx)
	go processor.Start(ctx, udpListener.Packets())

	// Settings HTTP server
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(settingsHTML)
	})

	mux.HandleFunc("GET /radar", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(radarHTML)
	})

	mux.HandleFunc("GET /weather", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(weatherHTML)
	})

	radarSSE := newRadarSSEHub(processor.PitwallManager())
	mux.Handle("GET /api/radar/stream", radarSSE)

	weatherSSE := newWeatherSSEHub(processor.PitwallManager())
	mux.Handle("GET /api/weather/stream", weatherSSE)

	radarOv := newRadarOverlay(processor.PitwallManager())
	mux.HandleFunc("POST /api/radar/toggle", func(w http.ResponseWriter, r *http.Request) {
		active := radarOv.Toggle()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"active": active})
	})

	weatherOv := newWeatherOverlay(processor.PitwallManager())
	mux.HandleFunc("POST /api/weather/toggle", func(w http.ResponseWriter, r *http.Request) {
		active := weatherOv.Toggle()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"active": active})
	})

	mux.HandleFunc("GET /strategy", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(strategyHTML)
	})

	strategySSE := newStrategySSEHub(processor.PitwallManager(), getStrategyConfig)
	mux.Handle("GET /api/strategy/stream", strategySSE)

	strategyOv := newStrategyOverlay(processor.PitwallManager(), getStrategyConfig)
	mux.HandleFunc("POST /api/strategy/toggle", func(w http.ResponseWriter, r *http.Request) {
		active := strategyOv.Toggle()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"active": active})
	})

	mux.HandleFunc("GET /api/strategy-settings", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		settings := make(map[string]trackStrategyConfig, len(cfgStrategySettings))
		for k, v := range cfgStrategySettings {
			settings[fmt.Sprintf("%d", k)] = v
		}
		cfgMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"defaults": defaultStrategyConfig, "tracks": settings})
	})

	mux.HandleFunc("PUT /api/strategy-settings", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			TrackID            int8 `json:"trackId"`
			PitTimeLossMs      int  `json:"pitTimeLossMs"`
			UndercutDifficulty int  `json:"undercutDifficulty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid body"})
			return
		}
		if body.PitTimeLossMs < 5000 || body.PitTimeLossMs > 60000 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "pitTimeLossMs must be 5000-60000"})
			return
		}
		if body.UndercutDifficulty < 1 || body.UndercutDifficulty > 3 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "undercutDifficulty must be 1-3"})
			return
		}
		cfgMu.Lock()
		cfgStrategySettings[body.TrackID] = trackStrategyConfig{
			PitTimeLossMs:      body.PitTimeLossMs,
			UndercutDifficulty: body.UndercutDifficulty,
		}
		cfgMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
			"ersCompareMetrics":  compareMonitor.Snapshot(),
			"currentTrack":       getCurrentTrack(trackState, trackStore),
			"radarActive":        radarOv.IsRunning(),
			"weatherActive":      weatherOv.IsRunning(),
			"strategyActive":     strategyOv.IsRunning(),
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
		dpc := cfgDefaultPermissionsCode
		ft := make([]rtconfig.ForwardTarget, len(cfgForwardTargets))
		copy(ft, cfgForwardTargets)
		cfgMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":                port,
			"saveFiles":              sf,
			"trackRecording":         tr,
			"roomName":               rn,
			"roomPassword":           rp,
			"defaultPermissionsCode": dpc,
			"forwardTargets":         ft,
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
			DefaultPermissionsCode             string                   `json:"defaultPermissionsCode"`
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

		nextDefaultCode := strings.TrimSpace(body.DefaultPermissionsCode)
		if nextRoomName != cfgRoomName || nextRoomPassword != cfgRoomPassword || nextDefaultCode != cfgDefaultPermissionsCode {
			cfgRoomName = nextRoomName
			cfgRoomPassword = nextRoomPassword
			cfgDefaultPermissionsCode = nextDefaultCode
			peerManager.SetDefaultPermissionsCode(cfgDefaultPermissionsCode)
			peerManager.UpdateRoomMetadata(cfgRoomName, cfgRoomPassword)
			logger.Info("room metadata changed", "roomName", cfgRoomName, "protected", cfgRoomPassword != "", "defaultPermissionsCode", cfgDefaultPermissionsCode)
		}

		// Update forward targets
		cfgForwardTargets = make([]rtconfig.ForwardTarget, len(body.ForwardTargets))
		copy(cfgForwardTargets, body.ForwardTargets)
		forwarder.UpdateTargets(body.ForwardTargets)
		logger.Info("forward targets updated", "count", len(body.ForwardTargets))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":                cfgUDPPort,
			"saveFiles":              cfgSaveFiles,
			"trackRecording":         cfgTrackRecording,
			"roomName":               cfgRoomName,
			"roomPassword":           cfgRoomPassword,
			"defaultPermissionsCode": cfgDefaultPermissionsCode,
			"forwardTargets":         cfgForwardTargets,
		})
	})


	mux.HandleFunc("GET /api/debug", func(w http.ResponseWriter, r *http.Request) {
		state := processor.PitwallManager().BuildState()
		stateJSON, _ := json.Marshal(state)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"version":            appVersion,
			"connectedEngineers": peerManager.ConnectedCount(),
			"roomCode":           peerManager.RoomCode(),
			"pitwallStateBytes":  len(stateJSON),
			"pitwallState":       json.RawMessage(stateJSON),
		})
	})

	// Try settingsPort, then auto-increment up to 10 times on conflict
	actualSettingsPort := settingsPort
	settingsSrv := &http.Server{Handler: mux}
	go func() {
		basePort := 0
		fmt.Sscanf(settingsPort, "%d", &basePort)
		if basePort == 0 {
			basePort = 8099
		}
		for attempt := range 10 {
			port := basePort + attempt
			actualSettingsPort = fmt.Sprintf("%d", port)
			settingsSrv.Addr = ":" + actualSettingsPort
			logger.Info("settings server starting", "port", actualSettingsPort)
			err := settingsSrv.ListenAndServe()
			if err != nil && err != http.ErrServerClosed {
				logger.Warn("settings server port in use, trying next", "port", port, "error", err)
				continue
			}
			return
		}
		logger.Error("settings server failed after 10 port attempts")
	}()

	logger.Info("sender started",
		"udpPort", udpPort,
		"roomName", cfgRoomName,
		"roomCode", peerManager.RoomCode(),
		"settingsPort", settingsPort,
	)

	// Auto-open browser to settings page (skip if embedded in another app)
	if os.Getenv("FRC_NO_BROWSER") == "" {
		time.Sleep(200 * time.Millisecond)
		openBrowser(settingsURL)
	}

	// Block until user clicks Quit in the system tray
	<-ctx.Done()
	forwarder.Close()
	peerManager.Close()
	compareMonitor.Close()
	settingsSrv.Shutdown(context.Background())
	logger.Info("sender shutdown complete")
	logFile.Close()
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
