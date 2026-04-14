package main

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/skip2/go-qrcode"

	"frc.engineer/internal/analysis"
	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/frcapi"
	"frc.engineer/internal/races"
	"frc.engineer/internal/rtc"
	"frc.engineer/internal/signaling"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
	"github.com/pion/webrtc/v4"
)

var appVersion = "v4.30.1"

// trackStrategyConfig holds per-track strategy overlay settings.
type trackStrategyConfig struct {
	PitTimeLossMs      int `json:"pitTimeLossMs"`
	UndercutDifficulty int `json:"undercutDifficulty"` // 1=easy, 2=medium, 3=hard
}

var defaultStrategyConfig = trackStrategyConfig{PitTimeLossMs: 22000, UndercutDifficulty: 2}

// senderConfig is the persistent config saved to disk.
type senderConfig struct {
	UDPPort              int                      `json:"udpPort"`
	RoomName             string                   `json:"roomName,omitempty"`
	RoomPassword         string                   `json:"roomPassword,omitempty"`
	FRCAccountKey        string                   `json:"frcAccountKey,omitempty"`
	EngineerDashboardURL string                   `json:"engineerDashboardUrl,omitempty"`
	SaveFiles            bool                     `json:"saveFiles"`
	TrackRecording       bool                     `json:"trackRecording"`
	ForwardTargets       []rtconfig.ForwardTarget `json:"forwardTargets"`
	OverlayPresets       []overlayPreset          `json:"overlayPresets,omitempty"`
	OverlayHotkeys       *overlayHotkeys          `json:"overlayHotkeys,omitempty"`
	OverlayWindows       *overlayWindowSettings   `json:"overlayWindows,omitempty"`
}

const senderConfigPath = "data/sender-config.json"

func resolveSenderStorageRoot() string {
	root := strings.TrimSpace(os.Getenv("FRC_STORAGE_DIR"))
	if root == "" {
		return ""
	}
	return filepath.Clean(root)
}

func resolveSenderStoragePath(parts ...string) string {
	root := resolveSenderStorageRoot()
	if root == "" {
		return filepath.Join(parts...)
	}

	joined := make([]string, 0, len(parts)+1)
	joined = append(joined, root)
	joined = append(joined, parts...)
	return filepath.Join(joined...)
}

func loadICEServers(raw string) ([]webrtc.ICEServer, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	var servers []webrtc.ICEServer
	if err := json.Unmarshal([]byte(trimmed), &servers); err != nil {
		return nil, fmt.Errorf("parse WEBRTC_ICE_SERVERS: %w", err)
	}

	filtered := make([]webrtc.ICEServer, 0, len(servers))
	for _, server := range servers {
		urls := make([]string, 0, len(server.URLs))
		for _, url := range server.URLs {
			if strings.TrimSpace(url) != "" {
				urls = append(urls, strings.TrimSpace(url))
			}
		}
		if len(urls) == 0 {
			continue
		}
		server.URLs = urls
		filtered = append(filtered, server)
	}

	return filtered, nil
}

func loadSenderConfig() *senderConfig {
	data, err := os.ReadFile(senderConfigPath)
	if err != nil {
		return nil
	}
	var cfg senderConfig
	if json.Unmarshal(data, &cfg) != nil {
		return nil
	}
	return &cfg
}

func saveSenderConfig(cfg senderConfig) error {
	dir := filepath.Dir(senderConfigPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(senderConfigPath, data, 0644)
}

func buildSenderState(saveFiles, trackRecording bool) dto.SenderState {
	raceStorageMode := "off"
	if saveFiles {
		// Sender currently persists race archives in result-only mode.
		raceStorageMode = string(rtconfig.DataStorageModeResultOnly)
	}
	return dto.SenderState{
		SaveFiles:       saveFiles,
		TrackRecording:  trackRecording,
		RaceStorageMode: raceStorageMode,
	}
}

func main() {
	// Log to file so the cmd banner stays clean
	logDir := resolveSenderStoragePath("logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logs dir: %v\n", err)
		os.Exit(1)
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "sender.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open log file: %v\n", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewTextHandler(logFile, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)
	if storageRoot := resolveSenderStorageRoot(); storageRoot != "" {
		logger.Info("custom sender storage root enabled", "root", storageRoot)
	}

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
	// Defaults from environment variables
	roomName := strings.TrimSpace(os.Getenv("SENDER_ROOM_NAME"))
	if roomName == "" {
		if host, err := os.Hostname(); err == nil && strings.TrimSpace(host) != "" {
			roomName = strings.TrimSpace(host)
		} else {
			roomName = "Sender Room"
		}
	}
	roomPassword := os.Getenv("SENDER_ROOM_PASSWORD")
	frcAccountKey := os.Getenv("FRC_ACCOUNT_KEY")
	engineerDashboardURL := normalizeEngineerDashboardURL("")
	udpPort := 20777
	if p := os.Getenv("F1_UDP_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &udpPort)
	}
	embeddedDriverPack := os.Getenv("DRIVER_PACK_EMBEDDED") == "1"
	saveFiles := strings.EqualFold(os.Getenv("SAVE_FILES"), "true") || os.Getenv("SAVE_FILES") == "1"
	trackRecording := saveFiles
	savedConfig := loadSenderConfig()

	// Override with saved config (persisted from previous session)
	if saved := savedConfig; saved != nil {
		if saved.UDPPort > 0 && saved.UDPPort <= 65535 {
			udpPort = saved.UDPPort
		}
		if saved.RoomName != "" {
			roomName = saved.RoomName
		}
		roomPassword = saved.RoomPassword
		if saved.FRCAccountKey != "" {
			frcAccountKey = saved.FRCAccountKey
		}
		saveFiles = saved.SaveFiles
		trackRecording = saved.TrackRecording
	}
	if embeddedDriverPack {
		saveFiles = true
	}

	// Create UDP listener & parser
	udpListener, err := udp.NewListener(udpPort, 2048, logger)
	if err != nil {
		logger.Error("failed to create UDP listener", "error", err)
		os.Exit(1)
	}
	parser := udp.NewParser(logger)
	packetLogDir := resolveSenderStoragePath("data", "packets")
	var packetLogger *udp.PacketLogger
	if saveFiles {
		packetLogger = udp.NewPacketLogger(packetLogDir, logger)
		parser.SetPacketLogger(packetLogger)
		logger.Info("packet logging enabled", "dir", packetLogDir)
	}

	// Create UDP forwarder and attach to listener
	forwarder := udp.NewForwarder(logger)
	udpListener.SetForwarder(forwarder)

	// Load track data (for delta calculations)
	trackDataDir := resolveSenderStoragePath("data", "tracks")
	trackStore := tracks.NewTrackStore(trackDataDir)

	// Create peer manager
	peerManager := rtc.NewPeerManager(signalingURL, logger)
	if iceServers, err := loadICEServers(os.Getenv("WEBRTC_ICE_SERVERS")); err != nil {
		logger.Warn("invalid WEBRTC_ICE_SERVERS config, falling back to default STUN servers", "error", err)
	} else if len(iceServers) > 0 {
		peerManager.SetICEServers(iceServers)
		logger.Info("configured custom WebRTC ICE servers", "count", len(iceServers))
	}
	peerManager.SetRoomMetadata(roomName, roomPassword)
	peerManager.SetDefaultPermissionsCode(frcAccountKey)

	// Create DataChannel broadcaster
	broadcaster := rtc.NewDataChannelBroadcaster(peerManager)

	// Create telemetry processor (pitwallState at 4Hz, skip dashboard telemetry)
	processor := telemetry.NewProcessor(parser, broadcaster, 0, logger, trackStore)
	processor.SetFastBroadcaster(broadcaster)
	compareMonitor := newERSCompareMonitor(resolveSenderStoragePath("logs", "ers_compare"), logger)
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
	cfgDefaultPermissionsCode := frcAccountKey
	cfgFRCAccountKey := frcAccountKey
	cfgEngineerDashboardURL := engineerDashboardURL
	var cachedDriverPerms *signaling.DriverPermissions
	var cfgForwardTargets []rtconfig.ForwardTarget
	cfgOverlayPresets := []overlayPreset{}
	cfgOverlayHotkeys := defaultedOverlayHotkeys(nil)
	overlayWindowDefaults := defaultedOverlayWindowSettings(nil)
	cfgOverlayWindows := overlayWindowDefaults
	if saved := savedConfig; saved != nil && len(saved.ForwardTargets) > 0 {
		cfgForwardTargets = saved.ForwardTargets
		forwarder.UpdateTargets(cfgForwardTargets)
	} else {
		cfgForwardTargets = []rtconfig.ForwardTarget{}
	}
	if saved := savedConfig; saved != nil {
		cfgOverlayPresets = normalizeOverlayPresets(saved.OverlayPresets)
		cfgOverlayHotkeys = defaultedOverlayHotkeys(saved.OverlayHotkeys)
		cfgOverlayWindows = defaultedOverlayWindowSettings(saved.OverlayWindows)
	}
	cfgStrategySettings := map[int8]trackStrategyConfig{}
	getStrategyConfig := func(trackID int8) trackStrategyConfig {
		cfgMu.Lock()
		defer cfgMu.Unlock()
		if cfg, ok := cfgStrategySettings[trackID]; ok {
			return cfg
		}
		return defaultStrategyConfig
	}
	processor.PitwallManager().SetSenderState(buildSenderState(cfgSaveFiles, cfgTrackRecording))
	var raceStorage *races.FileStorage
	if saveFiles {
		rs, err := races.NewFileStorage(resolveSenderStoragePath("data", "races"), logger)
		if err != nil {
			logger.Warn("failed to create race storage, file saving disabled", "error", err)
		}
		raceStorage = rs
	}
	var raceSummaryMu sync.RWMutex
	var latestRaceSummary *races.RaceSummary
	var sessionAnalysisCacheMu sync.RWMutex
	sessionAnalysisCache := make(map[string]sessionAnalysisCacheEntry)
	const maxRaceArchiveListChunkBytes = 48 * 1024
	const maxRaceReplayChunkBytes = 48 * 1024
	const maxRaceReplaySendWait = 5 * time.Second

	encodeP2PResponse := func(response dto.WSResponse) []byte {
		payload, err := dto.MsgpackMarshal(response)
		if err != nil {
			logger.Error("failed to encode p2p response", "type", response.Type, "error", err)
			return nil
		}
		return payload
	}

	sendP2PResponse := func(peerID string, response dto.WSResponse) {
		payload := encodeP2PResponse(response)
		if payload == nil {
			return
		}
		peerManager.SendTo(peerID, payload)
	}

	sendBufferedP2PResponse := func(peerID string, response dto.WSResponse) error {
		payload := encodeP2PResponse(response)
		if payload == nil {
			return fmt.Errorf("encode p2p response")
		}
		return peerManager.SendToBuffered(peerID, payload, maxRaceReplaySendWait)
	}

	getRaceArchiveStorage := func() (*races.FileStorage, error) {
		cfgMu.Lock()
		rs := raceStorage
		cfgMu.Unlock()
		if rs != nil {
			return rs, nil
		}
		return races.NewFileStorage(resolveSenderStoragePath("data", "races"), logger)
	}

	streamRaceReplay := func(peerID, requestID, raceID string) {
		rs, err := getRaceArchiveStorage()
		if err != nil {
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceReplayDone,
				RequestID: requestID,
				Error:     "race archive unavailable",
			})
			return
		}

		sendChunk := func(frames []races.ReplayFrame) error {
			if len(frames) == 0 {
				return nil
			}
			return sendBufferedP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceReplayChunk,
				RequestID: requestID,
				Data: map[string]any{
					"frames": frames,
				},
			})
		}

		frameCount := 0
		batch := make([]races.ReplayFrame, 0, 8)
		err = rs.WalkReplay(
			raceID,
			func(meta races.ReplayStreamMeta) error {
				return sendBufferedP2PResponse(peerID, dto.WSResponse{
					Type:      dto.MessageTypeRaceReplayMeta,
					RequestID: requestID,
					Data:      meta,
				})
			},
			func(frame races.ReplayFrame) error {
				tentative := append(batch, frame)
				testPayload := encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeRaceReplayChunk,
					RequestID: requestID,
					Data: map[string]any{
						"frames": tentative,
					},
				})
				if testPayload == nil {
					return fmt.Errorf("encode race replay chunk")
				}
				if len(batch) > 0 && len(testPayload) > maxRaceReplayChunkBytes {
					if err := sendChunk(batch); err != nil {
						return err
					}
					batch = append(batch[:0], frame)
				} else {
					batch = tentative
				}
				frameCount++
				return nil
			},
		)
		if err != nil {
			logger.Warn("failed to stream race replay", "raceId", raceID, "error", err)
			errorMessage := "failed to stream race replay"
			if os.IsNotExist(err) {
				errorMessage = "race replay not found"
			}
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceReplayDone,
				RequestID: requestID,
				Error:     errorMessage,
			})
			return
		}

		if err := sendChunk(batch); err != nil {
			logger.Warn("failed to send race replay chunk", "raceId", raceID, "error", err)
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceReplayDone,
				RequestID: requestID,
				Error:     "failed to send race replay chunk",
			})
			return
		}

		if err := sendBufferedP2PResponse(peerID, dto.WSResponse{
			Type:      dto.MessageTypeRaceReplayDone,
			RequestID: requestID,
			Data: map[string]any{
				"frameCount": frameCount,
			},
		}); err != nil {
			logger.Warn("failed to finish race replay stream", "raceId", raceID, "error", err)
		}
	}

	streamRaceArchiveList := func(peerID, requestID string) {
		rs, err := getRaceArchiveStorage()
		if err != nil {
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveListDone,
				RequestID: requestID,
				Error:     "race archive unavailable",
			})
			return
		}

		list, err := rs.List()
		if err != nil {
			logger.Warn("failed to list race archive", "error", err)
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveListDone,
				RequestID: requestID,
				Error:     "failed to load race archive",
			})
			return
		}

		sendChunk := func(items []races.RaceListItem) error {
			if len(items) == 0 {
				return nil
			}
			return sendBufferedP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveList,
				RequestID: requestID,
				Data:      items,
			})
		}

		batch := make([]races.RaceListItem, 0, 16)
		for _, item := range list {
			tentative := append(batch, item)
			testPayload := encodeP2PResponse(dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveList,
				RequestID: requestID,
				Data:      tentative,
			})
			if testPayload == nil {
				sendP2PResponse(peerID, dto.WSResponse{
					Type:      dto.MessageTypeRaceArchiveListDone,
					RequestID: requestID,
					Error:     "failed to encode race archive list",
				})
				return
			}
			if len(batch) > 0 && len(testPayload) > maxRaceArchiveListChunkBytes {
				if err := sendChunk(batch); err != nil {
					logger.Warn("failed to send race archive list chunk", "error", err)
					sendP2PResponse(peerID, dto.WSResponse{
						Type:      dto.MessageTypeRaceArchiveListDone,
						RequestID: requestID,
						Error:     "failed to send race archive list",
					})
					return
				}
				batch = append(batch[:0], item)
				continue
			}
			batch = tentative
		}

		if err := sendChunk(batch); err != nil {
			logger.Warn("failed to send race archive list chunk", "error", err)
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveListDone,
				RequestID: requestID,
				Error:     "failed to send race archive list",
			})
			return
		}

		if err := sendBufferedP2PResponse(peerID, dto.WSResponse{
			Type:      dto.MessageTypeRaceArchiveListDone,
			RequestID: requestID,
			Data: map[string]any{
				"count": len(list),
			},
		}); err != nil {
			logger.Warn("failed to finish race archive list stream", "error", err)
		}
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
		case dto.MessageTypeGetRaceArchiveList:
			go streamRaceArchiveList(peerID, req.RequestID)
			return nil
		case dto.MessageTypeGetRaceReplay:
			var body struct {
				ID string `json:"id"`
			}
			if len(req.Data) > 0 && json.Unmarshal(req.Data, &body) != nil {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeRaceReplayDone,
					RequestID: req.RequestID,
					Error:     "invalid race replay request",
				})
			}
			body.ID = strings.TrimSpace(body.ID)
			if body.ID == "" {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeRaceReplayDone,
					RequestID: req.RequestID,
					Error:     "race id is required",
				})
			}
			go streamRaceReplay(peerID, req.RequestID, body.ID)
			return nil
		default:
			return nil
		}
	})

	// Check driver permissions before connecting to signaling
	frcClient := frcapi.NewClient("https://f1-rivals-cup-production.up.railway.app")
	resolveDriverPerms := func(accountKey string) *signaling.DriverPermissions {
		if accountKey == "" || !frcapi.IsAccountKey(accountKey) {
			return nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		result, err := frcClient.CheckPermissions(ctx, accountKey, signaling.FRCDriverPermissionKeys())
		if err != nil {
			logger.Warn("failed to check driver permissions", "error", err)
			return nil
		}
		if result == nil {
			return nil
		}
		dp := signaling.MapFRCDriverPermissions(result)
		return &dp
	}

	cfgMu.Lock()
	cachedDriverPerms = resolveDriverPerms(cfgFRCAccountKey)
	cfgMu.Unlock()

	// Connect to signaling server (require pitwall permission)
	shouldConnect := cachedDriverPerms != nil && cachedDriverPerms.Pitwall
	if shouldConnect {
		if err := peerManager.Connect(); err != nil {
			logger.Error("failed to connect to signaling server", "error", err)
			os.Exit(1)
		}
	} else {
		logger.Warn("pitwall permission denied, skipping signaling connection")
	}

	processor.SetRaceSummarySaveCallback(func(sessionUID uint64, counts telemetry.RaceSummaryCounts, timeline []dto.RaceControlNotification, state *dto.PitwallState) error {
		cfgMu.Lock()
		rs := raceStorage
		cfgMu.Unlock()

		summary := races.BuildSummary(sessionUID, state, races.NotificationCounts{
			Penalty: counts.Penalty,
			Warning: counts.Warning,
			Info:    counts.Info,
		}, timeline, time.Now())
		raceSummaryMu.Lock()
		latestRaceSummary = summary
		raceSummaryMu.Unlock()

		if rs != nil {
			if _, err := rs.Save(summary); err != nil {
				logger.Error("failed to save race summary", "error", err)
			}
		}

		broadcaster.BroadcastRaceResult(summary)
		return nil
	})
	processor.SetRaceSummaryRecording(true)

	// Start components
	go udpListener.Start(ctx)
	go processor.Start(ctx, udpListener.Packets())

	// Settings HTTP server
	mux := http.NewServeMux()
	buildSenderConfigSnapshot := func() senderConfig {
		forwardTargets := append([]rtconfig.ForwardTarget(nil), cfgForwardTargets...)
		presets := append([]overlayPreset(nil), cfgOverlayPresets...)
		return senderConfig{
			UDPPort:              cfgUDPPort,
			RoomName:             cfgRoomName,
			RoomPassword:         cfgRoomPassword,
			FRCAccountKey:        cfgFRCAccountKey,
			EngineerDashboardURL: cfgEngineerDashboardURL,
			SaveFiles:            cfgSaveFiles,
			TrackRecording:       cfgTrackRecording,
			ForwardTargets:       forwardTargets,
			OverlayPresets:       presets,
			OverlayHotkeys:       cloneOverlayHotkeys(cfgOverlayHotkeys),
			OverlayWindows:       cloneOverlayWindowSettings(cfgOverlayWindows),
		}
	}

	persistOverlayWindow := func(kind string, state overlayWindowState) {
		cfgMu.Lock()
		switch kind {
		case "radar":
			cfgOverlayWindows.Radar = normalizeOverlayWindowState(kind, state, overlayWindowDefaults.Radar)
		case "weather":
			cfgOverlayWindows.Weather = normalizeOverlayWindowState(kind, state, overlayWindowDefaults.Weather)
		case "strategy":
			cfgOverlayWindows.Strategy = normalizeOverlayWindowState(kind, state, overlayWindowDefaults.Strategy)
		default:
			cfgMu.Unlock()
			return
		}
		if err := saveSenderConfig(buildSenderConfigSnapshot()); err != nil {
			logger.Warn("failed to save overlay window config", "kind", kind, "error", err)
		}
		cfgMu.Unlock()
	}

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

	radarOv := newRadarOverlay(processor.PitwallManager(), cfgOverlayWindows.Radar, func(state overlayWindowState) {
		persistOverlayWindow("radar", state)
	})
	mux.HandleFunc("POST /api/radar/toggle", func(w http.ResponseWriter, r *http.Request) {
		active := radarOv.Toggle()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"active": active})
	})

	weatherOv := newWeatherOverlay(processor.PitwallManager(), cfgOverlayWindows.Weather, func(state overlayWindowState) {
		persistOverlayWindow("weather", state)
	})
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

	strategyOv := newStrategyOverlay(processor.PitwallManager(), getStrategyConfig, cfgOverlayWindows.Strategy, func(state overlayWindowState) {
		persistOverlayWindow("strategy", state)
	})
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
		tr := cfgTrackRecording
		rn := cfgRoomName
		rp := cfgRoomPassword
		dp := cachedDriverPerms
		dashboardURL := cfgEngineerDashboardURL
		cfgMu.Unlock()
		senderState := buildSenderState(sf, tr)

		invite := buildInviteInfo(dashboardURL, signalingURL, peerManager.RoomID(), peerManager.RoomCode(), rp != "")
		peers := peerManager.DebugPeers()

		statusMap := map[string]any{
			"roomCode":           peerManager.RoomCode(),
			"roomId":             peerManager.RoomID(),
			"roomName":           rn,
			"roomProtected":      rp != "",
			"connectedEngineers": peerManager.ConnectedCount(),
			"udpPort":            port,
			"saveFiles":          sf,
			"trackRecording":     tr,
			"raceStorageMode":    senderState.RaceStorageMode,
			"ersCompareMetrics":  compareMonitor.Snapshot(),
			"currentTrack":       getCurrentTrack(trackState, trackStore),
			"radarActive":        radarOv.IsRunning(),
			"weatherActive":      weatherOv.IsRunning(),
			"strategyActive":     strategyOv.IsRunning(),
			"invite":             invite,
			"peers":              peers,
		}
		if dp != nil {
			statusMap["driverPermissions"] = dp
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(statusMap)
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

	mux.HandleFunc("GET /api/races/latest", func(w http.ResponseWriter, r *http.Request) {
		raceSummaryMu.RLock()
		summary := latestRaceSummary
		raceSummaryMu.RUnlock()
		if summary != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(summary)
			return
		}

		cfgMu.Lock()
		rs := raceStorage
		cfgMu.Unlock()
		if rs == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
			return
		}

		list, err := rs.List()
		if err != nil {
			logger.Error("failed to list race summaries", "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to load race summary"})
			return
		}
		if len(list) == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
			return
		}

		loaded, err := rs.Load(list[0].ID)
		if err != nil {
			logger.Error("failed to load latest race summary", "id", list[0].ID, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to load race summary"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(loaded)
	})

	mux.HandleFunc("GET /api/races", func(w http.ResponseWriter, r *http.Request) {
		rs, err := getRaceArchiveStorage()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "race archive unavailable"})
			return
		}

		list, err := rs.List()
		if err != nil {
			logger.Error("failed to list race summaries", "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to list race summaries"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	})

	mux.HandleFunc("GET /api/replay/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid race id"})
			return
		}

		rs, err := getRaceArchiveStorage()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "race archive unavailable"})
			return
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")

		if err := rs.StreamReplayNDJSON(id, w); err != nil {
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, races.ErrUnsafeID) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
				return
			}
			logger.Error("failed to stream replay", "id", id, "error", err)
			_, _ = w.Write([]byte(`{"type":"error","message":"failed to stream replay"}` + "\n"))
		}
	})

	mux.HandleFunc("GET /api/races/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid race id"})
			return
		}

		rs, err := getRaceArchiveStorage()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "race archive unavailable"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := rs.CopyRawJSON(id, w); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
				return
			}
			if errors.Is(err, races.ErrUnsafeID) {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid race id"})
				return
			}
			logger.Error("failed to load race summary", "id", id, "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to load race summary"})
		}
	})

	mux.HandleFunc("GET /api/sessions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		sessions, err := analysis.ListSessions(packetLogDir)
		if err != nil {
			json.NewEncoder(w).Encode([]struct{}{})
			return
		}
		json.NewEncoder(w).Encode(sessions)
	})

	mux.HandleFunc("GET /api/sessions/{dir}/analysis", func(w http.ResponseWriter, r *http.Request) {
		dir := r.PathValue("dir")
		if dir == "" || strings.Contains(dir, "..") || strings.Contains(dir, "/") || strings.Contains(dir, "\\") {
			http.Error(w, "invalid directory", http.StatusBadRequest)
			return
		}

		fullPath := filepath.Join(packetLogDir, dir)
		if fingerprint, err := sessionAnalysisFingerprint(fullPath); err == nil {
			sessionAnalysisCacheMu.RLock()
			cached, ok := sessionAnalysisCache[dir]
			sessionAnalysisCacheMu.RUnlock()
			if ok && cached.fingerprint == fingerprint && cached.result != nil {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(cached.result)
				return
			}
		}

		result, err := analysis.Analyze(fullPath)
		if err != nil {
			logger.Error("analysis failed", "dir", dir, "error", err)
			http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if fingerprint, err := sessionAnalysisFingerprint(fullPath); err == nil {
			sessionAnalysisCacheMu.Lock()
			sessionAnalysisCache[dir] = sessionAnalysisCacheEntry{
				fingerprint: fingerprint,
				result:      result,
			}
			sessionAnalysisCacheMu.Unlock()
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		port := cfgUDPPort
		sf := cfgSaveFiles
		tr := cfgTrackRecording
		rn := cfgRoomName
		rp := cfgRoomPassword
		fak := cfgFRCAccountKey
		dashboardURL := cfgEngineerDashboardURL
		ft := make([]rtconfig.ForwardTarget, len(cfgForwardTargets))
		copy(ft, cfgForwardTargets)
		presets := append([]overlayPreset(nil), cfgOverlayPresets...)
		hotkeys := cfgOverlayHotkeys
		cfgMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":              port,
			"saveFiles":            sf,
			"trackRecording":       tr,
			"roomName":             rn,
			"roomPassword":         rp,
			"frcAccountKey":        fak,
			"engineerDashboardUrl": dashboardURL,
			"forwardTargets":       ft,
			"overlayPresets":       presets,
			"overlayHotkeys":       hotkeys,
		})
	})

	mux.HandleFunc("GET /api/local-ops", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		dashboardURL := cfgEngineerDashboardURL
		presets := append([]overlayPreset(nil), cfgOverlayPresets...)
		hotkeys := cfgOverlayHotkeys
		cfgMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"engineerDashboardUrl": dashboardURL,
			"overlayPresets":       presets,
			"overlayHotkeys":       hotkeys,
		})
	})

	mux.HandleFunc("PUT /api/local-ops", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OverlayPresets []overlayPreset `json:"overlayPresets"`
			OverlayHotkeys overlayHotkeys  `json:"overlayHotkeys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}

		nextDashboardURL := normalizeEngineerDashboardURL("")
		nextPresets := normalizeOverlayPresets(body.OverlayPresets)
		nextHotkeys := normalizeOverlayHotkeys(body.OverlayHotkeys)

		cfgMu.Lock()
		cfgEngineerDashboardURL = nextDashboardURL
		cfgOverlayPresets = nextPresets
		cfgOverlayHotkeys = nextHotkeys
		persisted := buildSenderConfigSnapshot()
		cfgMu.Unlock()

		if err := saveSenderConfig(persisted); err != nil {
			logger.Warn("failed to save sender local-ops config", "error", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"engineerDashboardUrl": nextDashboardURL,
			"overlayPresets":       nextPresets,
			"overlayHotkeys":       nextHotkeys,
		})
	})

	mux.HandleFunc("POST /api/overlay/apply", func(w http.ResponseWriter, r *http.Request) {
		var desired overlayState
		if err := json.NewDecoder(r.Body).Decode(&desired); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}

		applied := applyOverlayState(desired, radarOv, weatherOv, strategyOv)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(applied)
	})

	mux.HandleFunc("GET /api/invite/qr", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		dashboardURL := cfgEngineerDashboardURL
		rp := cfgRoomPassword
		cfgMu.Unlock()

		invite := buildInviteInfo(dashboardURL, signalingURL, peerManager.RoomID(), peerManager.RoomCode(), rp != "")
		if invite.Link == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "invite link unavailable"})
			return
		}

		png, err := qrcode.Encode(invite.Link, qrcode.Medium, 256)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to encode QR"})
			return
		}

		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(png)
	})

	mux.HandleFunc("PUT /api/config", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			UDPPort                            int                      `json:"udpPort"`
			SaveFiles                          bool                     `json:"saveFiles"`
			TrackRecording                     bool                     `json:"trackRecording"`
			TrackRecordingOverwriteApprovedFor string                   `json:"trackRecordingOverwriteApprovedFor"`
			RoomName                           string                   `json:"roomName"`
			RoomPassword                       string                   `json:"roomPassword"`
			FRCAccountKey                      string                   `json:"frcAccountKey"`
			ForwardTargets                     []rtconfig.ForwardTarget `json:"forwardTargets"`
			OverlayPresets                     *[]overlayPreset         `json:"overlayPresets"`
			OverlayHotkeys                     *overlayHotkeys          `json:"overlayHotkeys"`
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
		cfgEngineerDashboardURL = normalizeEngineerDashboardURL("")
		if body.OverlayPresets != nil {
			cfgOverlayPresets = normalizeOverlayPresets(*body.OverlayPresets)
		}
		if body.OverlayHotkeys != nil {
			cfgOverlayHotkeys = normalizeOverlayHotkeys(*body.OverlayHotkeys)
		}

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
		effectiveSaveFiles := body.SaveFiles || embeddedDriverPack
		if effectiveSaveFiles != cfgSaveFiles {
			cfgSaveFiles = effectiveSaveFiles
			if effectiveSaveFiles {
				if raceStorage == nil {
					rs, err := races.NewFileStorage(resolveSenderStoragePath("data", "races"), logger)
					if err != nil {
						logger.Warn("failed to create race storage", "error", err)
					} else {
						raceStorage = rs
					}
				}
				if packetLogger == nil {
					packetLogger = udp.NewPacketLogger(packetLogDir, logger)
					parser.SetPacketLogger(packetLogger)
				}
			} else {
				raceStorage = nil
				parser.SetPacketLogger(nil)
				if packetLogger != nil {
					packetLogger.Close()
					packetLogger = nil
				}
				sessionAnalysisCacheMu.Lock()
				sessionAnalysisCache = make(map[string]sessionAnalysisCacheEntry)
				sessionAnalysisCacheMu.Unlock()
			}
			logger.Info("save files changed", "requested", body.SaveFiles, "effective", effectiveSaveFiles, "embeddedDriverPack", embeddedDriverPack)
		}

		// Toggle track recording independently
		if body.TrackRecording != cfgTrackRecording {
			cfgTrackRecording = body.TrackRecording
			recorder.SetEnabled(body.TrackRecording)
			logger.Info("track recording changed", "enabled", body.TrackRecording)
		}
		processor.PitwallManager().SetSenderState(buildSenderState(cfgSaveFiles, cfgTrackRecording))

		prevFRCKey := cfgFRCAccountKey
		cfgFRCAccountKey = strings.TrimSpace(body.FRCAccountKey)
		if nextRoomName != cfgRoomName || nextRoomPassword != cfgRoomPassword || cfgFRCAccountKey != cfgDefaultPermissionsCode {
			cfgRoomName = nextRoomName
			cfgRoomPassword = nextRoomPassword
			cfgDefaultPermissionsCode = cfgFRCAccountKey
			peerManager.SetDefaultPermissionsCode(cfgDefaultPermissionsCode)
			peerManager.UpdateRoomMetadata(cfgRoomName, cfgRoomPassword)
			logger.Info("room metadata changed", "roomName", cfgRoomName, "protected", cfgRoomPassword != "")
		}

		// Re-check driver permissions when FRC key changes
		if cfgFRCAccountKey != prevFRCKey {
			newDP := resolveDriverPerms(cfgFRCAccountKey)
			prevDP := cachedDriverPerms
			cachedDriverPerms = newDP
			wasPitwall := prevDP != nil && prevDP.Pitwall
			nowPitwall := newDP != nil && newDP.Pitwall
			if wasPitwall && !nowPitwall {
				peerManager.Close()
				logger.Warn("pitwall permission revoked, disconnected from signaling")
			} else if !wasPitwall && nowPitwall {
				go func() {
					if err := peerManager.Connect(); err != nil {
						logger.Error("failed to reconnect to signaling", "error", err)
					}
				}()
				logger.Info("pitwall permission granted, reconnecting to signaling")
			}
		}

		// Update forward targets
		cfgForwardTargets = make([]rtconfig.ForwardTarget, len(body.ForwardTargets))
		copy(cfgForwardTargets, body.ForwardTargets)
		forwarder.UpdateTargets(body.ForwardTargets)
		logger.Info("forward targets updated", "count", len(body.ForwardTargets))

		// Persist config to disk
		if err := saveSenderConfig(buildSenderConfigSnapshot()); err != nil {
			logger.Warn("failed to save sender config", "error", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":              cfgUDPPort,
			"saveFiles":            cfgSaveFiles,
			"trackRecording":       cfgTrackRecording,
			"roomName":             cfgRoomName,
			"roomPassword":         cfgRoomPassword,
			"frcAccountKey":        cfgFRCAccountKey,
			"engineerDashboardUrl": cfgEngineerDashboardURL,
			"forwardTargets":       cfgForwardTargets,
			"overlayPresets":       cfgOverlayPresets,
			"overlayHotkeys":       cfgOverlayHotkeys,
		})
	})

	mux.HandleFunc("GET /api/frc-verify", func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Query().Get("key")
		if key == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "key parameter required"})
			return
		}
		info, err := frcClient.VerifyKey(r.Context(), key)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		if info == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "account key not found"})
			return
		}
		// Also check driver permissions
		dp := resolveDriverPerms(key)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"valid":             info.Valid,
			"accountKey":        info.AccountKey,
			"id":                info.ID,
			"nickname":          info.Nickname,
			"avatarUrl":         info.AvatarURL,
			"role":              info.Role,
			"createdAt":         info.CreatedAt,
			"driverPermissions": dp,
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

	// Try settingsPort, then auto-increment up to 10 times on conflict.
	// In the embedded driver pack, keep the API contract pinned to the requested port.
	actualSettingsPort := settingsPort
	settingsSrv := &http.Server{Handler: mux}
	go func() {
		basePort := 0
		fmt.Sscanf(settingsPort, "%d", &basePort)
		if basePort == 0 {
			basePort = 8099
		}
		maxAttempts := 10
		if embeddedDriverPack {
			maxAttempts = 1
		}
		for attempt := range maxAttempts {
			port := basePort + attempt
			actualSettingsPort = fmt.Sprintf("%d", port)
			settingsSrv.Addr = ":" + actualSettingsPort
			logger.Info("settings server starting", "port", actualSettingsPort)
			err := settingsSrv.ListenAndServe()
			if err != nil && err != http.ErrServerClosed {
				if embeddedDriverPack {
					logger.Error("embedded settings server failed", "port", port, "error", err)
					return
				}
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
	if packetLogger != nil {
		packetLogger.Close()
	}
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
