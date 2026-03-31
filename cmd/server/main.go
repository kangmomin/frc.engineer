package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"frc.engineer/internal/analysis"
	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/storage"
	"frc.engineer/internal/strategydata"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
	"frc.engineer/pkg/config"
	"frc.engineer/web"
)

func main() {
	// Setup structured logging
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Auto-update: clean previous update artifacts, then check for updates
	cleanOldBinary(logger)
	if err := autoUpdate(logger); err != nil {
		logger.Warn("auto-update failed, continuing with current version", "error", err)
	}

	// Load configuration
	cfg := config.LoadFromEnv()
	logger.Info("configuration loaded",
		"udpPort", cfg.UDPPort,
		"wsPort", cfg.WSPort,
		"updateHz", cfg.TelemetryUpdateHz,
		"dataDir", cfg.DataDir,
	)

	// Initialize runtime config manager (loads saved config.json if exists)
	runtimeCfg := rtconfig.NewRuntimeConfigManager("config.json", cfg.UDPPort, cfg.WSPort)

	// Use saved ports from config.json instead of defaults
	savedCfg := runtimeCfg.Get()
	storageMode := rtconfig.NormalizeDataStorageMode(savedCfg.DataStorageMode)
	if savedCfg.UDPPort != 0 {
		cfg.UDPPort = savedCfg.UDPPort
		logger.Info("using saved UDP port from config", "udpPort", cfg.UDPPort)
	}
	if savedCfg.BackendPort != 0 {
		cfg.WSPort = savedCfg.BackendPort
		logger.Info("using saved backend port from config", "backendPort", cfg.WSPort)
	}

	// Initialize lap storage
	lapStorage, err := storage.NewFileLapStorage(cfg.DataDir)
	if err != nil {
		logger.Error("failed to create lap storage", "error", err)
		os.Exit(1)
	}
	logger.Info("lap storage initialized", "dataDir", cfg.DataDir)

	// Initialize race summary storage
	raceStorage, err := races.NewFileStorage(filepath.Join("data", "races"), logger)
	if err != nil {
		logger.Error("failed to create race summary storage", "error", err)
		os.Exit(1)
	}
	logger.Info("race summary storage initialized", "dir", filepath.Join("data", "races"))

	// Create context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Create UDP listener (game sends to a fixed port, so no auto-increment)
	udpListener, err := udp.NewListener(cfg.UDPPort, cfg.UDPBufferSize, logger)
	if err != nil {
		logger.Error("failed to create UDP listener", "error", err, "port", cfg.UDPPort)
		os.Exit(1)
	}

	// Create UDP forwarder and attach to listener
	forwarder := udp.NewForwarder(logger)
	udpListener.SetForwarder(forwarder)

	// Apply saved forward targets
	if len(savedCfg.ForwardTargets) > 0 {
		forwarder.UpdateTargets(savedCfg.ForwardTargets)
	}

	// Create packet parser
	parser := udp.NewParser(logger)

	// Setup packet logging if enabled (env var or saved config)
	var packetLogger *udp.PacketLogger
	if cfg.PacketLogging || storageMode == rtconfig.DataStorageModeAdvanced {
		packetLogger = udp.NewPacketLogger(cfg.PacketLogDir, logger)
		parser.SetPacketLogger(packetLogger)
		logger.Info("packet logging enabled", "dir", cfg.PacketLogDir)
	}

	// Create WebSocket hub
	hub := websocket.NewHub(cfg.WSBroadcastBuffer, logger)

	// Load track map data
	trackStore := tracks.NewTrackStore(cfg.DataDir)

	// Create track recorder
	recorder := telemetry.NewTrackRecorder(cfg.DataDir, trackStore, logger)
	if savedCfg.TrackRecording {
		recorder.SetEnabled(true)
	}

	// Create telemetry processor
	processor := telemetry.NewProcessor(parser, hub, cfg.TelemetryUpdateHz, logger, trackStore)
	processor.PitwallManager().SetRecorder(recorder)
	processor.SetRaceSummarySaveCallback(func(sessionUID uint64, counts telemetry.RaceSummaryCounts, state *dto.PitwallState) error {
		currentCfg := runtimeCfg.Get()
		mode := rtconfig.NormalizeDataStorageMode(currentCfg.DataStorageMode)

		summary := races.BuildSummary(sessionUID, state, races.NotificationCounts{
			Penalty: counts.Penalty,
			Warning: counts.Warning,
			Info:    counts.Info,
		}, time.Now())
		summary.DataStorageMode = mode
		if mode == rtconfig.DataStorageModeSummary || mode == rtconfig.DataStorageModeAdvanced {
			summary.Replay = convertReplayTimeline(processor.GetReplayTimeline(sessionUID))
		}
		_, err := raceStorage.Save(summary)
		if err != nil {
			return err
		}

		// Broadcast result (without replay data) to connected clients
		broadcast := *summary
		broadcast.Replay = nil
		if msg, err := json.Marshal(dto.WSResponse{Type: dto.MessageTypeRaceResult, Data: broadcast}); err == nil {
			hub.Broadcast(msg)
		}
		return nil
	})
	processor.SetRaceSummaryRecording(savedCfg.RaceSummaryRecording)
	processor.SetReplayRecording(storageMode == rtconfig.DataStorageModeSummary || storageMode == rtconfig.DataStorageModeAdvanced)

	// Connect storage to delta calculator
	processor.DeltaCalculator().SetStorageCallbacks(
		func(trackID int8, lap *telemetry.LapTelemetry) error {
			logger.Info("saving best lap", "trackID", trackID, "lapTimeMS", lap.LapTimeMS, "points", len(lap.DataPoints))
			return lapStorage.SaveBestLap(trackID, lap)
		},
		func(trackID int8) (*telemetry.LapTelemetry, error) {
			lap, err := lapStorage.LoadBestLap(trackID)
			if err != nil {
				return nil, err
			}
			if lap != nil {
				logger.Info("loaded best lap from storage", "trackID", trackID, "lapTimeMS", lap.LapTimeMS)
			}
			return lap, nil
		},
	)

	// Create WebSocket handler
	wsHandler := websocket.NewHandler(hub, logger)

	// Set up message handler for client requests (e.g., getBestLap)
	wsHandler.SetMessageHandler(func(_ *websocket.Client, message []byte) []byte {
		var req dto.WSRequest
		if err := json.Unmarshal(message, &req); err != nil {
			logger.Debug("failed to parse WebSocket request", "error", err)
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
			logger.Debug("unknown WebSocket request type", "type", req.Type)
			return nil
		}
	})

	// Start components
	go udpListener.Start(ctx)
	go hub.Run(ctx)
	go processor.Start(ctx, udpListener.Packets())

	// HTTP server management (declared early for handler closures)
	var serverMu sync.Mutex
	var server *http.Server
	var restartHTTPServer func(int)

	// Load normalized strategy guide data if available.
	strategyStore, err := strategydata.LoadStore(filepath.Join("data", "strategy", "normalized"))
	if err != nil {
		logger.Warn("strategy guide data unavailable", "error", err)
	} else {
		logger.Info("strategy guide data loaded", "tracks", strategyStore.TrackCount())
	}

	// Setup HTTP server
	mux := http.NewServeMux()
	mux.Handle("/ws", wsHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","clients":%d}`, hub.ClientCount())
	})

	// REST API: GET /api/config
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			current := runtimeCfg.Get()
			json.NewEncoder(w).Encode(current)

		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16)) // 64KB max
			if err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			var newCfg rtconfig.RuntimeConfig
			if err := json.Unmarshal(body, &newCfg); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			newCfg.DataStorageMode = rtconfig.NormalizeDataStorageMode(newCfg.DataStorageMode)
			// Validate
			if newCfg.UDPPort < 1 || newCfg.UDPPort > 65535 {
				http.Error(w, "udpPort must be 1-65535", http.StatusBadRequest)
				return
			}
			if newCfg.BackendPort < 1 || newCfg.BackendPort > 65535 {
				http.Error(w, "backendPort must be 1-65535", http.StatusBadRequest)
				return
			}
			if len(newCfg.ForwardTargets) > 16 {
				http.Error(w, "too many forward targets (max 16)", http.StatusBadRequest)
				return
			}
			for _, ft := range newCfg.ForwardTargets {
				if ft.Host == "" || ft.Port < 1 || ft.Port > 65535 {
					http.Error(w, "invalid forward target: host required, port 1-65535", http.StatusBadRequest)
					return
				}
			}
			oldCfg := runtimeCfg.Get()

			// UDP port rebind (try before saving config to avoid mismatch on failure)
			if newCfg.UDPPort != oldCfg.UDPPort {
				if err := udpListener.Rebind(newCfg.UDPPort); err != nil {
					http.Error(w, fmt.Sprintf("UDP port %d unavailable: %v", newCfg.UDPPort, err), http.StatusConflict)
					return
				}
				logger.Info("UDP port rebound", "port", newCfg.UDPPort)
			}

			if err := runtimeCfg.Update(newCfg); err != nil {
				// Rollback UDP rebind if it happened
				if newCfg.UDPPort != oldCfg.UDPPort {
					if rbErr := udpListener.Rebind(oldCfg.UDPPort); rbErr != nil {
						logger.Error("failed to rollback UDP rebind", "error", rbErr)
					}
				}
				http.Error(w, "failed to save config", http.StatusInternalServerError)
				return
			}
			// Apply changes
			forwarder.UpdateTargets(newCfg.ForwardTargets)
			recorder.SetEnabled(newCfg.TrackRecording)
			processor.SetRaceSummaryRecording(newCfg.RaceSummaryRecording)
			processor.SetReplayRecording(
				newCfg.DataStorageMode == rtconfig.DataStorageModeSummary ||
					newCfg.DataStorageMode == rtconfig.DataStorageModeAdvanced,
			)

			// Toggle packet logging at runtime.
			shouldPacketLogging := cfg.PacketLogging || newCfg.DataStorageMode == rtconfig.DataStorageModeAdvanced
			if shouldPacketLogging && packetLogger == nil {
				packetLogger = udp.NewPacketLogger(cfg.PacketLogDir, logger)
				parser.SetPacketLogger(packetLogger)
				logger.Info("packet logging enabled at runtime", "dir", cfg.PacketLogDir)
			} else if !shouldPacketLogging && packetLogger != nil {
				parser.SetPacketLogger(nil)
				packetLogger.Close()
				packetLogger = nil
				logger.Info("packet logging disabled at runtime")
			}

			// Backend port hot-reload
			if newCfg.BackendPort != oldCfg.BackendPort {
				ln, err := net.Listen("tcp", fmt.Sprintf(":%d", newCfg.BackendPort))
				if err != nil {
					// Rollback only backend port in config
					rollback := newCfg
					rollback.BackendPort = oldCfg.BackendPort
					if rbErr := runtimeCfg.Update(rollback); rbErr != nil {
						logger.Error("failed to rollback backend port in config", "error", rbErr)
					}
					http.Error(w, fmt.Sprintf("backend port %d unavailable: %v", newCfg.BackendPort, err), http.StatusConflict)
					return
				}
				ln.Close()

				// Send response before restarting the server
				json.NewEncoder(w).Encode(newCfg)
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
				go func() {
					time.Sleep(100 * time.Millisecond)
					restartHTTPServer(newCfg.BackendPort)
				}()
				return
			}

			json.NewEncoder(w).Encode(newCfg)

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// REST API: GET /api/tracks
	mux.HandleFunc("/api/tracks", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trackStore.ListRecordedFiles())
	})

	// REST API: GET /api/sessions
	mux.HandleFunc("/api/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		sessions, err := analysis.ListSessions(cfg.PacketLogDir)
		if err != nil {
			json.NewEncoder(w).Encode([]struct{}{})
			return
		}
		json.NewEncoder(w).Encode(sessions)
	})

	// REST API: GET /api/sessions/{dir}/analysis
	mux.HandleFunc("/api/sessions/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Parse path: /api/sessions/{dir}/analysis
		path := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
		if !strings.HasSuffix(path, "/analysis") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		dir := strings.TrimSuffix(path, "/analysis")
		if dir == "" || strings.Contains(dir, "..") || strings.Contains(dir, "/") {
			http.Error(w, "invalid directory", http.StatusBadRequest)
			return
		}

		fullPath := filepath.Join(cfg.PacketLogDir, dir)
		result, err := analysis.Analyze(fullPath)
		if err != nil {
			logger.Error("analysis failed", "dir", dir, "error", err)
			http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	// REST API: GET /api/races
	mux.HandleFunc("/api/races", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		list, err := raceStorage.List()
		if err != nil {
			logger.Error("failed to list race summaries", "error", err)
			http.Error(w, "failed to list race summaries", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	})

	// REST API: GET /api/replay/{id} (NDJSON stream: meta + frames)
	mux.HandleFunc("/api/replay/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := strings.TrimPrefix(r.URL.Path, "/api/replay/")
		id = strings.TrimSuffix(id, "/")
		if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
			http.Error(w, "invalid race id", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")

		if err := raceStorage.StreamReplayNDJSON(id, w); err != nil {
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, races.ErrUnsafeID) {
				http.Error(w, "race summary not found", http.StatusNotFound)
				return
			}
			logger.Error("failed to stream replay", "id", id, "error", err)
			// If streaming started, status may already be committed; keep body minimal.
			_, _ = w.Write([]byte(`{"type":"error","message":"failed to stream replay"}` + "\n"))
			return
		}
	})

	// REST API: GET|DELETE /api/races/{id}
	mux.HandleFunc("/api/races/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/races/")
		id = strings.TrimSuffix(id, "/")
		if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
			http.Error(w, "invalid race id", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			err := raceStorage.CopyRawJSON(id, w)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					http.Error(w, "race summary not found", http.StatusNotFound)
					return
				}
				if errors.Is(err, races.ErrUnsafeID) {
					http.Error(w, "invalid race id", http.StatusBadRequest)
					return
				}
				logger.Error("failed to load race summary", "id", id, "error", err)
				http.Error(w, "failed to load race summary", http.StatusInternalServerError)
				return
			}

		case http.MethodDelete:
			if err := raceStorage.Delete(id); err != nil {
				if errors.Is(err, os.ErrNotExist) {
					http.Error(w, "race summary not found", http.StatusNotFound)
					return
				}
				if errors.Is(err, races.ErrUnsafeID) {
					http.Error(w, "invalid race id", http.StatusBadRequest)
					return
				}
				logger.Error("failed to delete race summary", "id", id, "error", err)
				http.Error(w, "failed to delete race summary", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Debug: dump current pitwall state
	mux.HandleFunc("/api/debug/pitwall", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		state := processor.PitwallManager().BuildState()
		json.NewEncoder(w).Encode(state)
	})

	mux.HandleFunc("/api/strategy/guide", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strategyStore == nil {
			http.Error(w, "strategy guide unavailable", http.StatusServiceUnavailable)
			return
		}

		trackIDParam := strings.TrimSpace(r.URL.Query().Get("trackId"))
		if trackIDParam == "" {
			http.Error(w, "trackId is required", http.StatusBadRequest)
			return
		}
		trackIDValue, err := strconv.Atoi(trackIDParam)
		if err != nil {
			http.Error(w, "invalid trackId", http.StatusBadRequest)
			return
		}
		trackName := strings.TrimSpace(r.URL.Query().Get("trackName"))

		trackGuide := strategyStore.TrackBySession(int8(trackIDValue), trackName)
		if trackGuide == nil {
			http.Error(w, "strategy guide not found", http.StatusNotFound)
			return
		}

		response := struct {
			Track     *strategydata.NormalizedTrackFile       `json:"track"`
			TyreTemps *strategydata.NormalizedTyreTempDataset `json:"tyreTemps"`
		}{
			Track:     trackGuide,
			TyreTemps: strategyStore.TyreTemps(),
		}

		json.NewEncoder(w).Encode(response)
	})

	// Serve embedded frontend (SPA fallback)
	distFS, err := fs.Sub(web.DistFS, "dist")
	if err != nil {
		logger.Error("failed to create sub filesystem", "error", err)
		os.Exit(1)
	}
	fileServer := http.FileServer(http.FS(distFS))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try serving the file directly; fall back to index.html for SPA routes
		f, err := distFS.Open(r.URL.Path[1:]) // strip leading "/"
		if err != nil {
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	}))

	newHTTPServer := func(port int) *http.Server {
		return &http.Server{
			Addr:              fmt.Sprintf(":%d", port),
			Handler:           mux,
			ReadTimeout:       15 * time.Second,
			ReadHeaderTimeout: 10 * time.Second,
			WriteTimeout:      3 * time.Minute,
			IdleTimeout:       2 * time.Minute,
		}
	}

	// Bind HTTP port (auto-increment on conflict)
	var httpLn net.Listener
	for attempt := 0; attempt < 100; attempt++ {
		httpLn, err = net.Listen("tcp", fmt.Sprintf(":%d", cfg.WSPort))
		if err == nil {
			break
		}
		logger.Warn("HTTP port in use, trying next", "port", cfg.WSPort, "error", err)
		cfg.WSPort++
	}
	if httpLn == nil {
		logger.Error("failed to bind HTTP port after 100 attempts", "startPort", cfg.WSPort-100)
		os.Exit(1)
	}

	server = newHTTPServer(cfg.WSPort)

	restartHTTPServer = func(port int) {
		serverMu.Lock()
		oldServer := server
		newSrv := newHTTPServer(port)
		server = newSrv
		serverMu.Unlock()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		oldServer.Shutdown(shutdownCtx)
		shutdownCancel()

		logger.Info("HTTP server restarted", "addr", fmt.Sprintf(":%d", port))
		if err := newSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error after restart", "error", err)
		}
	}

	// Start HTTP server
	go func() {
		logger.Info("HTTP server started", "addr", server.Addr)
		if err := server.Serve(httpLn); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error", "error", err)
		}
	}()

	logger.Info("F1 25 Telemetry Server started",
		"udp", fmt.Sprintf(":%d", cfg.UDPPort),
		"ws", fmt.Sprintf("ws://localhost:%d/ws", cfg.WSPort),
	)
	printStartupAccessGuide(logger, cfg.WSPort)
	checkForUpdateAsync(logger)

	// Wait for shutdown signal
	sig := <-sigChan
	logger.Info("shutdown signal received", "signal", sig)

	// Graceful shutdown
	cancel()
	forwarder.Close()
	if packetLogger != nil {
		packetLogger.Close()
	}

	serverMu.Lock()
	s := server
	serverMu.Unlock()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := s.Shutdown(shutdownCtx); err != nil {
		logger.Error("HTTP server shutdown error", "error", err)
	}

	logger.Info("server shutdown complete")
}

func cleanF32(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

func convertReplayTimeline(in *telemetry.ReplayTimeline) *races.ReplayTimeline {
	if in == nil || len(in.Frames) == 0 {
		return nil
	}

	out := &races.ReplayTimeline{
		FrameIntervalMS: in.FrameIntervalMS,
		TrackMap:        in.TrackMap,
		Session:         in.Session,
		Frames:          make([]races.ReplayFrame, len(in.Frames)),
	}

	for i := range in.Frames {
		frame := in.Frames[i]
		out.Frames[i] = races.ReplayFrame{
			Timestamp: frame.Timestamp,
			Pitwall:   frame.Pitwall,
		}
		if len(frame.RaceControl) > 0 {
			out.Frames[i].RaceControl = append([]dto.RaceControlNotification(nil), frame.RaceControl...)
		}
		if len(frame.BattleAlerts) > 0 {
			out.Frames[i].BattleAlerts = append([]dto.BattleAlertDTO(nil), frame.BattleAlerts...)
		}
	}

	return out
}

// convertLapTelemetryToDTO converts internal lap telemetry to DTO
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

// convertTelemetryPointsToDTO converts internal telemetry points to DTOs
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
