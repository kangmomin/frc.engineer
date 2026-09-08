package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/energye/systray"
	"github.com/skip2/go-qrcode"

	"frc.engineer/internal/analysis"
	"frc.engineer/internal/analysishttp"
	"frc.engineer/internal/banlist"
	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/rbac"
	"frc.engineer/internal/rtc"
	"frc.engineer/internal/storage"
	"frc.engineer/internal/strategydata"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
	"github.com/pion/webrtc/v4"
)

var appVersion = "v4.54.0"

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
	EngineerDashboardURL string                   `json:"engineerDashboardUrl,omitempty"`
	SaveFiles            bool                     `json:"saveFiles"`
	DataStorageMode      rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	TrackRecording       bool                     `json:"trackRecording"`
	ForwardTargets       []rtconfig.ForwardTarget `json:"forwardTargets"`
	OverlayPresets       []overlayPreset          `json:"overlayPresets,omitempty"`
	OverlayHotkeys       *overlayHotkeys          `json:"overlayHotkeys,omitempty"`
	OverlayWindows       *overlayWindowSettings   `json:"overlayWindows,omitempty"`
	PlatformBaseURL      string                   `json:"platformBaseUrl,omitempty"`
	UploadToken          string                   `json:"uploadToken,omitempty"`
	// OverlayLanBind opt-in: 설정/오버레이 HTTP 서버를 전 인터페이스에 바인드해
	// 듀얼PC/OBS 등 LAN 기기에서 /radar·/weather·/strategy 접근을 복원한다.
	// 기본 false(루프백 전용) — 켜면 설정 API도 LAN에 노출되므로 명시적 선택일 때만.
	// 변경은 재시작 후 적용.
	OverlayLanBind bool `json:"overlayLanBind,omitempty"`
}

const senderLogTailMaxBytes int64 = 64 * 1024

type clientDebugPayload struct {
	Source  string         `json:"source"`
	Scope   string         `json:"scope"`
	Level   string         `json:"level"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

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

func resolveSenderAssetPaths(parts ...string) []string {
	paths := make([]string, 0, 4)

	// 읽기 전용 배포 자산(strategy/normalized 등)은 업데이트로 갱신되는
	// exe 옆 번들 사본을 userData(FRC_STORAGE_DIR)의 stale 사본보다 우선한다.
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		paths = append(paths,
			filepath.Join(append([]string{exeDir}, parts...)...),
			filepath.Join(append([]string{exeDir, "..", ".."}, parts...)...),
		)
	}

	paths = append(paths, resolveSenderStoragePath(parts...))
	paths = append(paths, filepath.Join(parts...))

	return paths
}

func loadSenderStrategyStore() (*strategydata.Store, string, error) {
	var lastErr error
	seen := make(map[string]struct{})
	for _, candidate := range resolveSenderAssetPaths("data", "strategy", "normalized") {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}

		store, err := strategydata.LoadStore(candidate)
		if err == nil {
			return store, candidate, nil
		}
		lastErr = err
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("strategy data path not found")
	}
	return nil, "", lastErr
}

func senderConfigFilePath() string {
	return resolveSenderStoragePath("data", "sender-config.json")
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
	data, err := os.ReadFile(senderConfigFilePath())
	if err != nil {
		return nil
	}
	var cfg senderConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		slog.Warn("failed to parse sender config, using defaults", "path", senderConfigFilePath(), "error", err)
		return nil
	}
	return &cfg
}

func saveSenderConfig(cfg senderConfig) error {
	path := senderConfigFilePath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	// tmp+rename 원자적 교체: 저장 중 크래시가 나도 기존 config가 깨지지 않게 한다.
	// (races.FileStorage.Save와 동일 패턴)
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func buildSenderState(saveFiles, trackRecording bool, dataStorageMode rtconfig.DataStorageMode) dto.SenderState {
	raceStorageMode := "off"
	if saveFiles {
		raceStorageMode = string(rtconfig.NormalizeDataStorageMode(dataStorageMode))
	}
	return dto.SenderState{
		SaveFiles:       saveFiles,
		TrackRecording:  trackRecording,
		RaceStorageMode: raceStorageMode,
	}
}

func logClientDebug(logger *slog.Logger, peerID string, payload clientDebugPayload) {
	level := strings.ToLower(strings.TrimSpace(payload.Level))
	if level == "" {
		level = "info"
	}

	attrs := []any{
		"source", strings.TrimSpace(payload.Source),
		"scope", strings.TrimSpace(payload.Scope),
		"message", strings.TrimSpace(payload.Message),
	}
	if peerID != "" {
		attrs = append(attrs, "peerId", peerID)
	}
	if len(payload.Details) > 0 {
		attrs = append(attrs, "details", payload.Details)
	}

	switch level {
	case "warn", "warning":
		logger.Warn("client debug log", attrs...)
	case "error":
		logger.Error("client debug log", attrs...)
	default:
		logger.Info("client debug log", attrs...)
	}
}

func readFileTail(path string, maxBytes int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}

	start := int64(0)
	if info.Size() > maxBytes {
		start = info.Size() - maxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(f)
}

func mergeCaptureProvenance(base, incident dto.RaceCaptureProvenance) dto.RaceCaptureProvenance {
	base.IncidentsCaptureActive = base.IncidentsCaptureActive || incident.IncidentsCaptureActive
	base.LapDataObserved = base.LapDataObserved || incident.LapDataObserved
	base.SessionHistoryObserved = base.SessionHistoryObserved || incident.SessionHistoryObserved
	base.CarStatusObserved = base.CarStatusObserved || incident.CarStatusObserved
	base.CarDamageObserved = base.CarDamageObserved || incident.CarDamageObserved
	base.TyreSetsObserved = base.TyreSetsObserved || incident.TyreSetsObserved
	base.PitMeasurementObserved = base.PitMeasurementObserved || incident.PitMeasurementObserved
	base.EventsCaptureActive = base.EventsCaptureActive || incident.EventsCaptureActive
	base.IncidentClipLimitReached = base.IncidentClipLimitReached || incident.IncidentClipLimitReached
	// Recorder metadata deliberately has no finalization state. Keep the save
	// snapshot's latest state instead of resurrecting an older checkpoint.
	if incident.CheckpointFinalize || incident.NormalFinalize {
		base.CheckpointFinalize = incident.CheckpointFinalize
		base.NormalFinalize = incident.NormalFinalize
	}
	base.IncidentMergeLimited = base.IncidentMergeLimited || incident.IncidentMergeLimited
	base.EventsSeen += incident.EventsSeen
	base.EventsBufferDropped += incident.EventsBufferDropped
	return base
}

// stripPrivateCapture returns an external-safe summary copy. Private capture
// state is intentionally retained in on-disk files for restart adoption, but no
// archive/API/DataChannel response may expose the eligible collision ledger or
// raw-source provenance.
func stripPrivateCapture(summary *races.RaceSummary) *races.RaceSummary {
	if summary == nil {
		return nil
	}
	copySummary := *summary
	copySummary.PrivateCapture = nil
	return &copySummary
}

func main() {
	// Log to file so the cmd banner stays clean
	logDir := resolveSenderStoragePath("logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logs dir: %v\n", err)
		os.Exit(1)
	}
	logFilePath := filepath.Join(logDir, "sender.log")
	logFile, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
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
	defer cancel()
	if os.Getenv("FRC_MANAGED_STDIN") == "1" {
		go watchManagedShutdown(os.Stdin, cancel)
	}
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
	engineerDashboardURL := normalizeEngineerDashboardURL("")
	udpPort := 20777
	if p := os.Getenv("F1_UDP_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &udpPort)
	}
	embeddedDriverPack := os.Getenv("DRIVER_PACK_EMBEDDED") == "1"
	saveFiles := strings.EqualFold(os.Getenv("SAVE_FILES"), "true") || os.Getenv("SAVE_FILES") == "1"
	dataStorageMode := rtconfig.DataStorageModeResultOnly
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
		saveFiles = saved.SaveFiles
		dataStorageMode = rtconfig.NormalizeDataStorageMode(saved.DataStorageMode)
		trackRecording = saved.TrackRecording
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
	if saveFiles && dataStorageMode == rtconfig.DataStorageModeAdvanced {
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
	strategyStore, strategyStorePath, err := loadSenderStrategyStore()
	if err != nil {
		logger.Warn("failed to load strategy guide data", "error", err)
	} else {
		logger.Info("strategy guide data loaded", "path", strategyStorePath, "tracks", strategyStore.TrackCount())
	}

	// Create peer manager
	peerManager := rtc.NewPeerManager(signalingURL, logger)
	if iceServers, err := loadICEServers(os.Getenv("WEBRTC_ICE_SERVERS")); err != nil {
		logger.Warn("invalid WEBRTC_ICE_SERVERS config, falling back to default STUN servers", "error", err)
	} else if len(iceServers) > 0 {
		peerManager.SetICEServers(iceServers)
		logger.Info("configured custom WebRTC ICE servers", "count", len(iceServers))
	}
	peerManager.SetRoomMetadata(roomName, roomPassword)
	peerManager.SetStatusHandler(func(status string) {
		systray.SetTooltip(fmt.Sprintf("FRC Pitwall Sender %s — %s", appVersion, status))
	})

	// Create DataChannel broadcaster
	broadcaster := rtc.NewDataChannelBroadcaster(peerManager)

	// Create telemetry processor (pitwallState at 4Hz, skip dashboard telemetry)
	processor := telemetry.NewProcessor(parser, broadcaster, 0, logger, trackStore)
	processor.SetDashboardEnabled(false)

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

	// Nickname ban: shared store fed by the central list (polled below) and read
	// by the processor on every packet to hard-stop transmission for banned players.
	banStore := banlist.NewStore()
	processor.SetBanChecker(banStore.IsBanned)

	// Runtime config state protected by mutex
	var cfgMu sync.Mutex
	cfgUDPPort := udpPort
	cfgSaveFiles := saveFiles
	cfgDataStorageMode := dataStorageMode
	bestLapStorage, err := storage.NewFileLapStorage(trackDataDir)
	if err != nil {
		logger.Warn("best lap storage unavailable", "error", err)
	} else {
		processor.DeltaCalculator().SetStorageCallbacks(func(trackID int8, lap *telemetry.LapTelemetry) error {
			cfgMu.Lock()
			enabled := cfgSaveFiles && cfgDataStorageMode == rtconfig.DataStorageModeAdvanced
			cfgMu.Unlock()
			if !enabled {
				return nil
			}
			err := bestLapStorage.SaveBestLap(trackID, lap)
			if err != nil {
				logger.Warn("failed to save best lap", "trackId", trackID, "error", err)
			}
			return err
		}, bestLapStorage.LoadBestLap)
	}

	cfgTrackRecording := trackRecording
	cfgRoomName := roomName
	cfgRoomPassword := roomPassword
	cfgEngineerDashboardURL := engineerDashboardURL
	var cfgForwardTargets []rtconfig.ForwardTarget
	cfgOverlayPresets := []overlayPreset{}
	cfgOverlayHotkeys := defaultedOverlayHotkeys(nil)
	overlayWindowDefaults := defaultedOverlayWindowSettings(nil)
	cfgOverlayWindows := overlayWindowDefaults
	cfgPlatformBaseURL := normalizePlatformBaseURL("")
	cfgUploadToken := ""
	// 플랫폼에서 가져온 계정 권한(자문 게이트 전용 — 보안 경계 아님). 메모리 캐시만:
	// cfgPermsFetched=false(미확인)면 전 기능 허용(fail-open, 20260727 업데이트
	// 게이트·banlist 폴러와 동일 정책). 차단은 fetch 200 + 그랜트 미커버일 때만.
	var cfgPermissions []string
	cfgPermsFetched := false
	if saved := savedConfig; saved != nil && len(saved.ForwardTargets) > 0 {
		cfgForwardTargets = saved.ForwardTargets
		forwarder.UpdateTargets(cfgForwardTargets)
	} else {
		cfgForwardTargets = []rtconfig.ForwardTarget{}
	}
	cfgOverlayLanBind := false
	if saved := savedConfig; saved != nil {
		cfgOverlayPresets = normalizeOverlayPresets(saved.OverlayPresets)
		cfgOverlayHotkeys = defaultedOverlayHotkeys(saved.OverlayHotkeys)
		cfgOverlayWindows = defaultedOverlayWindowSettings(saved.OverlayWindows)
		cfgPlatformBaseURL = normalizePlatformBaseURL(saved.PlatformBaseURL)
		cfgUploadToken = saved.UploadToken
		cfgOverlayLanBind = saved.OverlayLanBind
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
	processor.PitwallManager().SetSenderState(buildSenderState(cfgSaveFiles, cfgTrackRecording, cfgDataStorageMode))
	var raceStorage *races.FileStorage
	if saveFiles {
		rs, err := races.NewFileStorage(resolveSenderStoragePath("data", "races"), logger)
		if err != nil {
			logger.Warn("failed to create race storage, file saving disabled", "error", err)
		}
		raceStorage = rs
	}
	// Sealed-ID 업로드 상태: 세션당 단일 로컬 ID + 업로드 사이드카 + 부팅 sweep.
	upState := newUploadState(resolveSenderStoragePath("data", "races"), logger)
	var raceSummaryMu sync.RWMutex
	var latestRaceSummary *races.RaceSummary
	var sessionAnalysisCacheMu sync.RWMutex
	sessionAnalysisCache := make(map[string]sessionAnalysisCacheEntry)
	// 요약 파이프라인은 디브리프 브로드캐스트·플랫폼 업로드의 원천이라 항상 활성 —
	// saveFiles는 로컬 파일(요약/리플레이/패킷) 저장 여부만 정한다(콜백에서 분기).
	processor.SetRaceSummaryRecording(true)
	// 체크포인트 저장(idle/session-switch/shutdown flush) + CHQF/RCWN 강등 — sender 전용.
	processor.SetCheckpointSaves(true)
	processor.SetReplayRecording(saveFiles && (dataStorageMode == rtconfig.DataStorageModeSummary || dataStorageMode == rtconfig.DataStorageModeAdvanced))
	const maxRaceArchiveListChunkBytes = 48 * 1024
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

	cloneRaceSummaryWithoutReplay := func(summary *races.RaceSummary) *races.RaceSummary {
		if summary == nil {
			return nil
		}
		cloned := *summary
		cloned.Replay = nil
		return &cloned
	}

	loadRaceSummaryWithoutReplay := func(raceID string) (*races.RaceSummary, error) {
		rs, err := getRaceArchiveStorage()
		if err != nil {
			return nil, err
		}
		summary, err := rs.Load(raceID)
		if err != nil {
			return nil, err
		}
		return cloneRaceSummaryWithoutReplay(summary), nil
	}

	// 부팅 sweep: 업로드 안 된 요약(오프라인/크래시/체크포인트 저장분)을 재시도한다.
	// 페어링돼 있을 때만 — sweep 내부에서 요청별 deadline과 중단 조건을 관리한다.
	if cfgUploadToken != "" {
		go upState.sweep(ctx, cfgPlatformBaseURL, cfgUploadToken, loadRaceSummaryWithoutReplay)
	}

	streamRaceArchiveList := func(peerID, requestID string) {
		logger.Info("race archive list stream requested", "peerId", peerID, "requestId", requestID)
		rs, err := getRaceArchiveStorage()
		if err != nil {
			logger.Warn("race archive storage unavailable", "peerId", peerID, "requestId", requestID, "error", err)
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveListDone,
				RequestID: requestID,
				Error:     "race archive unavailable",
			})
			return
		}

		list, err := rs.List()
		if err != nil {
			logger.Warn("failed to list race archive", "peerId", peerID, "requestId", requestID, "error", err)
			sendP2PResponse(peerID, dto.WSResponse{
				Type:      dto.MessageTypeRaceArchiveListDone,
				RequestID: requestID,
				Error:     "failed to load race archive",
			})
			return
		}
		logger.Info("race archive list loaded", "peerId", peerID, "requestId", requestID, "count", len(list))

		chunkCount := 0
		sendChunk := func(items []races.RaceListItem) error {
			if len(items) == 0 {
				return nil
			}
			chunkCount++
			logger.Info("sending race archive list chunk", "peerId", peerID, "requestId", requestID, "chunkIndex", chunkCount, "items", len(items))
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
				logger.Warn("failed to encode race archive list chunk", "peerId", peerID, "requestId", requestID, "items", len(tentative))
				sendP2PResponse(peerID, dto.WSResponse{
					Type:      dto.MessageTypeRaceArchiveListDone,
					RequestID: requestID,
					Error:     "failed to encode race archive list",
				})
				return
			}
			if len(batch) > 0 && len(testPayload) > maxRaceArchiveListChunkBytes {
				if err := sendChunk(batch); err != nil {
					logger.Warn("failed to send race archive list chunk", "peerId", peerID, "requestId", requestID, "chunkCount", chunkCount, "error", err)
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
			logger.Warn("failed to send race archive list chunk", "peerId", peerID, "requestId", requestID, "chunkCount", chunkCount, "error", err)
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
			logger.Warn("failed to finish race archive list stream", "peerId", peerID, "requestId", requestID, "chunkCount", chunkCount, "count", len(list), "error", err)
			return
		}
		logger.Info("race archive list stream finished", "peerId", peerID, "requestId", requestID, "chunkCount", chunkCount, "count", len(list))
	}

	sendRaceSummary := func(peerID, requestID, raceID string) []byte {
		logger.Info("race summary requested", "peerId", peerID, "requestId", requestID, "raceId", raceID)
		summary, err := loadRaceSummaryWithoutReplay(raceID)
		if err != nil {
			logger.Warn("failed to load race summary for p2p response", "peerId", peerID, "requestId", requestID, "raceId", raceID, "error", err)
			errorMessage := "failed to load race summary"
			switch {
			case os.IsNotExist(err):
				errorMessage = "race summary not found"
			case errors.Is(err, races.ErrUnsafeID):
				errorMessage = "invalid race id"
			}
			return encodeP2PResponse(dto.WSResponse{
				Type:      dto.MessageTypeRaceSummary,
				RequestID: requestID,
				Error:     errorMessage,
			})
		}
		// 아카이브 상세도 단일 DataChannel 메시지 — 미트리밍 incidents(워스트 ~2MB)는
		// SCTP 256KB 예산을 깨므로 여기서만 제외한다. 공용 clone 헬퍼에서 strip하면
		// 수동 업로드 경로(loadRaceSummaryWithoutReplay 공유)의 클립까지 유실되므로 금지.
		summary = stripPrivateCapture(summary)
		summary.Incidents = nil
		return encodeP2PResponse(dto.WSResponse{
			Type:      dto.MessageTypeRaceSummary,
			RequestID: requestID,
			Data:      summary,
		})
	}

	// Set handlers BEFORE Connect() to avoid races with pion callbacks
	peerManager.SetCountChangeHandler(func(count int) {
		logger.Info("peer count changed", "connectedEngineers", count)
		if count > 0 {
			processor.PitwallManager().ResendTrackMap()
		}
	})

	peerManager.SetRequestHandler(func(peerID string, msg []byte, transport *rtc.RequestTransport) []byte {
		var req dto.WSRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			logger.Warn("failed to decode peer request", "peerId", peerID, "bytes", len(msg), "error", err)
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
			logger.Info("received p2p race archive list request", "peerId", peerID, "requestId", req.RequestID)
			go streamRaceArchiveList(peerID, req.RequestID)
			return nil
		case dto.MessageTypeGetRaceSummary:
			var body struct {
				ID string `json:"id"`
			}
			if len(req.Data) > 0 && json.Unmarshal(req.Data, &body) != nil {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeRaceSummary,
					RequestID: req.RequestID,
					Error:     "invalid race summary request",
				})
			}
			body.ID = strings.TrimSpace(body.ID)
			if body.ID == "" {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeRaceSummary,
					RequestID: req.RequestID,
					Error:     "race id is required",
				})
			}
			logger.Info("received p2p race summary request", "peerId", peerID, "requestId", req.RequestID, "raceId", body.ID)
			return sendRaceSummary(peerID, req.RequestID, body.ID)
		case dto.MessageTypeCancelRaceReplay:
			transport.CancelRequest(req.RequestID)
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
			logger.Info("received p2p race replay request", "peerId", peerID, "requestId", req.RequestID, "raceId", body.ID)
			streamCtx, finish := transport.BeginRequest(req.RequestID)
			go func() {
				defer finish()
				send := func(response dto.WSResponse) error {
					payload := encodeP2PResponse(response)
					if payload == nil {
						return fmt.Errorf("encode replay response")
					}
					return transport.SendBuffered(streamCtx, payload, maxRaceReplaySendWait)
				}
				rs, err := getRaceArchiveStorage()
				if err == nil {
					err = streamRaceReplay(streamCtx, rs, req.RequestID, body.ID, send)
				}
				if err != nil && streamCtx.Err() == nil {
					logger.Warn("failed to stream race replay", "peerId", peerID, "raceId", body.ID, "error", err)
					message := "failed to stream race replay"
					if os.IsNotExist(err) {
						message = "race replay not found"
					}
					_ = send(dto.WSResponse{Type: dto.MessageTypeRaceReplayDone, RequestID: req.RequestID, Error: message})
				}
			}()
			return nil
		case dto.MessageTypeGetStrategyGuide:
			var body struct {
				TrackID    int8   `json:"trackId"`
				TrackName  string `json:"trackName"`
				GameFormat int    `json:"gameFormat"`
			}
			if len(req.Data) > 0 && json.Unmarshal(req.Data, &body) != nil {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeStrategyGuide,
					RequestID: req.RequestID,
					Error:     "invalid strategy guide request",
				})
			}
			if strategyStore == nil {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeStrategyGuide,
					RequestID: req.RequestID,
					Error:     "strategy guide unavailable",
				})
			}
			trackGuide := strategyStore.TrackBySession(body.TrackID, body.TrackName)
			if trackGuide == nil {
				return encodeP2PResponse(dto.WSResponse{
					Type:      dto.MessageTypeStrategyGuide,
					RequestID: req.RequestID,
					Error:     "strategy guide not found",
				})
			}
			// F1 26(2026 Season Pack)은 폐지된 C6 컴파운드를 C5로 강등한다.
			trackGuide = strategydata.ApplyGameFormat(trackGuide, body.GameFormat)
			logger.Info("received p2p strategy guide request",
				"peerId", peerID,
				"requestId", req.RequestID,
				"trackId", body.TrackID,
				"trackName", strings.TrimSpace(body.TrackName),
				"track", trackGuide.Track,
			)
			return encodeP2PResponse(dto.WSResponse{
				Type:      dto.MessageTypeStrategyGuide,
				RequestID: req.RequestID,
				Data: struct {
					Track     *strategydata.NormalizedTrackFile       `json:"track"`
					TyreTemps *strategydata.NormalizedTyreTempDataset `json:"tyreTemps"`
				}{
					Track:     trackGuide,
					TyreTemps: strategyStore.TyreTemps(),
				},
			})
		case dto.MessageTypeClientDebugLog:
			var payload clientDebugPayload
			if len(req.Data) > 0 && json.Unmarshal(req.Data, &payload) != nil {
				logger.Warn("failed to decode client debug log payload", "peerId", peerID, "requestId", req.RequestID)
				return nil
			}
			logClientDebug(logger, peerID, payload)
			return nil
		default:
			logger.Info("unhandled peer request", "peerId", peerID, "requestId", req.RequestID, "type", req.Type)
			return nil
		}
	})

	// Connect to signaling server.
	// 시그널링이 일시적으로 죽어 있어도 sender는 살아서 백오프 재시도해야 한다 —
	// 이전에는 첫 실패에 os.Exit(1)로 앱 전체가 종료됐다.
	// single-flight 가드: 페어링 성공 콜백과 밴 해제 콜백이 동시에 호출해도 재시도 루프가 1개만 돌게 한다.
	var connectLoopActive atomic.Bool
	connectWithRetry := func() {
		if !connectLoopActive.CompareAndSwap(false, true) {
			return
		}
		defer connectLoopActive.Store(false)
		delay := time.Second
		for {
			// 닉네임 밴 상태면 중단 (Close 후 Connect가 세션을 되살리는 것 방지)
			if processor.IsBanned() {
				logger.Warn("nickname banned during connect retry, aborting")
				return
			}
			err := peerManager.Connect()
			if err == nil {
				// TOCTOU 가드: 체크와 Connect 사이에 밴+Close가 끼어들면
				// Connect가 세션을 되살린다 — 재확인 후 되돌린다.
				if processor.IsBanned() {
					peerManager.Close()
					logger.Warn("nickname banned during connect, closing session")
					return
				}
				systray.SetTooltip("FRC Pitwall Sender " + appVersion + " — Running")
				return
			}
			logger.Warn("signaling connect failed, retrying", "error", err, "delay", delay)
			systray.SetTooltip(fmt.Sprintf("FRC Pitwall Sender %s — Signaling 연결 재시도 중 (%s)", appVersion, delay))
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			delay *= 2
			if delay > 30*time.Second {
				delay = 30 * time.Second
			}
		}
	}
	// shouldBeConnected gates (re)connection on the nickname ban + device pairing
	// + the advisory broadcast permission — used here, by the ban-state callback,
	// the permissions refresh, and the config path. 권한 미확인(fail-open)이면 허용.
	shouldBeConnected := func() bool {
		cfgMu.Lock()
		paired := cfgUploadToken != ""
		broadcastAllowed := !cfgPermsFetched || rbac.HasPermission(cfgPermissions, rbac.PermBroadcastCreate)
		cfgMu.Unlock()
		return paired && broadcastAllowed && !processor.IsBanned()
	}

	// When the player's nickname enters/leaves the ban list, hard-stop or resume.
	// Invoked from the processor goroutine, so keep it non-blocking.
	processor.SetBanStateChangeHandler(func(banned bool) {
		if banned {
			// Close asynchronously: this callback runs on the processor goroutine
			// and Close() may block on signaling I/O.
			go peerManager.Close()
			logger.Warn("player nickname banned — transmission stopped, session closed")
			systray.SetTooltip("FRC Pitwall Sender " + appVersion + " — 차단됨 (밴 리스트)")
		} else if shouldBeConnected() {
			logger.Info("nickname ban lifted — reconnecting to signaling")
			go connectWithRetry()
		}
	})

	// applyPermissions stores fetched grants (advisory gates only) and, on an
	// allow↔deny transition of the broadcast permission, hard-stops or resumes
	// the pitwall session — same pattern as the nickname-ban handler above.
	// The fetch is async, so a deny can arrive after the boot connect already
	// succeeded. Stale guard: responses for a superseded upload token (device
	// re-paired to another account mid-flight) are dropped.
	applyPermissions := func(fetchedToken string, perms []string) {
		cfgMu.Lock()
		if cfgUploadToken != fetchedToken {
			cfgMu.Unlock()
			return
		}
		wasAllowed := !cfgPermsFetched || rbac.HasPermission(cfgPermissions, rbac.PermBroadcastCreate)
		cfgPermissions = perms
		cfgPermsFetched = true
		nowAllowed := rbac.HasPermission(perms, rbac.PermBroadcastCreate)
		cfgMu.Unlock()
		logger.Info("platform permissions fetched", "grants", len(perms), "broadcastAllowed", nowAllowed)
		if wasAllowed && !nowAllowed {
			go peerManager.Close()
			logger.Warn("pitwall broadcast denied by platform permissions — session closed")
			systray.SetTooltip("FRC Pitwall Sender " + appVersion + " — 송출 권한 없음")
		} else if !wasAllowed && nowAllowed && shouldBeConnected() {
			logger.Info("pitwall broadcast permission granted — reconnecting")
			go connectWithRetry()
		}
	}

	// refreshPermissions fetches the paired account's grant nodes once ("앱 기동
	// 시 업데이트 확인과 같은 타이밍" — boot and re-pair, no periodic re-check;
	// the platform enforces for real on every request, this is advisory UX).
	// Fail-open: unpaired / network failure / old server 404 / 401·403 all keep
	// the previous state. Only network-class errors retry (10s → 30s); an HTTP
	// response of any status is final for this run.
	refreshPermissions := func() {
		cfgMu.Lock()
		token := cfgUploadToken
		base := cfgPlatformBaseURL
		cfgMu.Unlock()
		if token == "" {
			return
		}
		for _, delay := range []time.Duration{0, 10 * time.Second, 30 * time.Second} {
			if delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
			fctx, fcancel := context.WithTimeout(ctx, uploadHTTPTimeout)
			perms, status, err := fetchPermissions(fctx, base, token)
			fcancel()
			if err == nil {
				applyPermissions(token, perms)
				return
			}
			if status != 0 {
				logger.Warn("permissions fetch rejected — advisory gates stay open (fail-open)",
					"status", status, "error", err)
				return
			}
			logger.Warn("permissions fetch network error, will retry", "error", err)
		}
	}

	if shouldBeConnected() {
		go connectWithRetry()
	} else {
		cfgMu.Lock()
		paired := cfgUploadToken != ""
		cfgMu.Unlock()
		if !paired {
			logger.Warn("pitwall connection skipped (device not paired)")
			systray.SetTooltip("FRC Pitwall Sender " + appVersion + " — 페어링 필요")
		} else {
			logger.Warn("pitwall connection skipped (permission denied or nickname banned)")
		}
	}

	processor.SetRaceSummarySaveCallback(func(sessionUID uint64, counts telemetry.RaceSummaryCounts, timeline []dto.RaceControlNotification, state *dto.PitwallState, detail *dto.RaceDetailInput) error {
		cfgMu.Lock()
		rs := raceStorage
		saveEnabled := cfgSaveFiles
		storageMode := cfgDataStorageMode
		token := cfgUploadToken
		base := cfgPlatformBaseURL
		cfgMu.Unlock()

		// saveFiles는 로컬 파일(요약/리플레이/패킷) 저장 여부만 정한다 — 요약 생성,
		// 디브리프 브로드캐스트, 플랫폼 업로드는 저장 설정과 무관하게 항상 수행한다.
		summary := races.BuildSummary(sessionUID, state, races.NotificationCounts{
			Penalty: counts.Penalty,
			Warning: counts.Warning,
			Info:    counts.Info,
		}, timeline, detail, time.Now())
		summary.DataStorageMode = rtconfig.NormalizeDataStorageMode(storageMode)
		// 사고 클립: DataStorageMode 무관 상시 부착(요약 파이프라인 상시 활성 원칙).
		// 로컬은 원본 그대로, 업로드는 buildUploadRequest에서 예산 트리밍, DataChannel
		// 전송 경로들은 각자 strip한다.
		summary.Incidents = processor.GetIncidentClips(sessionUID)
		if capture := processor.GetIncidentCaptureMetadata(sessionUID); capture != nil {
			if summary.PrivateCapture != nil {
				capture.RunID = summary.PrivateCapture.RunID
				capture.Provenance = mergeCaptureProvenance(summary.PrivateCapture.Provenance, capture.Provenance)
			}
			summary.PrivateCapture = capture
		}
		races.RefreshLocalCompleteness(summary)
		// 리플레이 타임라인은 로컬 저장 전용 대용량 부속 — 저장이 켜져 있을 때만 부착
		// (꺼져 있으면 SetReplayRecording도 꺼져 있어 어차피 프레임이 없다).
		if saveEnabled && (summary.DataStorageMode == rtconfig.DataStorageModeSummary || summary.DataStorageMode == rtconfig.DataStorageModeAdvanced) {
			if replay := processor.GetReplayTimeline(sessionUID); replay != nil {
				frames := make([]races.ReplayFrame, len(replay.Frames))
				for i := range replay.Frames {
					frame := replay.Frames[i]
					frames[i] = races.ReplayFrame{
						Timestamp:   frame.Timestamp,
						Pitwall:     frame.Pitwall,
						RaceControl: append([]dto.RaceControlNotification(nil), frame.RaceControl...),
					}
				}
				summary.Replay = &races.ReplayTimeline{
					FrameIntervalMS: replay.FrameIntervalMS,
					TrackMap:        replay.TrackMap,
					Session:         replay.Session,
					Frames:          frames,
				}
			}
		}
		var savedID string
		var saveErr error
		if saveEnabled && rs != nil {
			// 세션당 단일 ID 재사용(sealed면 새 ID) + 재시작 병합은 upState가 처리한다.
			savedID, saveErr = upState.saveWithStableID(rs, sessionUID, summary)
			if saveErr != nil {
				logger.Error("failed to save race summary", "error", saveErr)
			}
		}
		// Saving may merge prior capture data and assign the stable ID. Publish
		// only after those mutations finish so readers see an immutable summary.
		raceSummaryMu.Lock()
		latestRaceSummary = summary
		raceSummaryMu.Unlock()

		trigger := ""
		if detail != nil {
			trigger = detail.FinalizeTrigger
		}

		// idle-timeout(일시정지 3분)·shutdown 체크포인트는 백그라운드 보존 저장일 뿐,
		// 세션 종료 신호가 아니다 — 진행 중 레이스의 뷰어에 디브리프를 쏘면 오동작.
		// 게임 이벤트 유래 저장(SEND/CHQF/RCWN)만 기존 타이밍대로 방송한다.
		if trigger != "idle-timeout" && trigger != "shutdown" {
			// Strip the (potentially large) replay frames before the DataChannel push —
			// the rich Detail (~50-60KB player-centric) stays within the SCTP budget,
			// but the full replay would not. Mirrors cmd/server's broadcast strip.
			broadcastSummary := stripPrivateCapture(summary)
			broadcastSummary.Replay = nil
			broadcastSummary.Incidents = nil // 미트리밍 클립 블록도 SCTP 예산 밖 — 전송 제외
			broadcaster.BroadcastRaceResult(broadcastSummary)
		}

		// Auto-upload: fire-and-forget so a slow/failed network never blocks the
		// save path. Always on when paired — pairing is the upload consent gate.
		// final-class 저장만 즉시 업로드한다 — 체크포인트(idle/shutdown/CHQF/RCWN)는
		// 세션이 끝났다는 보장이 없어, 종료가 확정되는 경로(sweep/후속 final)에 맡긴다.
		if token != "" && isFinalClassTrigger(trigger) {
			if req, ok := buildUploadRequest(summary, logger); ok {
				uploadID := savedID
				go func() {
					ctx, cancel := context.WithTimeout(context.Background(), uploadHTTPTimeout)
					defer cancel()
					if uploadID != "" {
						if _, status, err := upState.uploadSealed(ctx, base, token, uploadID, loadRaceSummaryWithoutReplay); err != nil {
							logger.Warn("auto-upload failed", "id", uploadID, "status", status, "error", err)
						} else {
							logger.Info("race auto-uploaded", "id", uploadID)
						}
						return
					}
					// 로컬 저장 없음(저장 꺼짐/실패) — 기존 경로 그대로 직접 업로드.
					if _, status, err := uploadRace(ctx, base, token, req); err != nil {
						logger.Warn("auto-upload failed", "id", summary.ID, "status", status, "error", err)
					} else {
						logger.Info("race auto-uploaded", "id", summary.ID)
					}
				}()
			}
		}
		// 저장 실패를 processor에 알린다 — final-class면 finalSavePending으로 idle 재시도.
		return saveErr
	})

	// Start components
	go udpListener.Start(ctx)
	go processor.Start(ctx, udpListener.Packets())

	// Poll the central ban list (signaling server) and refresh the local store.
	// Fail-open: on fetch errors we keep the previous list rather than unbanning.
	go func() {
		banClient := banlist.NewClient(signalingHTTPBase(signalingURL))
		fetchOnce := func() {
			fctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			names, err := banClient.Fetch(fctx)
			if err != nil {
				logger.Warn("failed to fetch ban list, keeping previous (fail-open)", "error", err)
				return
			}
			banStore.Replace(names)
			logger.Info("ban list refreshed", "count", banStore.Count())
		}
		fetchOnce()
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				fetchOnce()
			}
		}
	}()

	// 앱 기동 시 1회, 페어링된 계정의 플랫폼 권한을 가져와 자문 게이트에 적용
	// (미페어링이면 즉시 반환 — 페어링 성공 시점에 다시 호출된다).
	go refreshPermissions()

	// Report the player nickname to signaling (for server-side IP auto-ban).
	// Synced periodically since the nickname is only known after telemetry arrives.
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				peerManager.SetPlayerName(processor.PitwallManager().GetPlayerName())
			}
		}
	}()

	// Settings HTTP server
	mux := http.NewServeMux()
	intercomBridge := rtc.NewIntercomBridge(peerManager, os.Getenv(rtc.IntercomBridgeTokenEnv), logger)
	mux.Handle("GET /api/intercom/ws", intercomBridge)
	buildSenderConfigSnapshot := func() senderConfig {
		forwardTargets := append([]rtconfig.ForwardTarget(nil), cfgForwardTargets...)
		presets := append([]overlayPreset(nil), cfgOverlayPresets...)
		return senderConfig{
			UDPPort:              cfgUDPPort,
			RoomName:             cfgRoomName,
			RoomPassword:         cfgRoomPassword,
			EngineerDashboardURL: cfgEngineerDashboardURL,
			SaveFiles:            cfgSaveFiles,
			DataStorageMode:      cfgDataStorageMode,
			TrackRecording:       cfgTrackRecording,
			ForwardTargets:       forwardTargets,
			OverlayPresets:       presets,
			OverlayHotkeys:       cloneOverlayHotkeys(cfgOverlayHotkeys),
			OverlayWindows:       cloneOverlayWindowSettings(cfgOverlayWindows),
			PlatformBaseURL:      cfgPlatformBaseURL,
			UploadToken:          cfgUploadToken,
			OverlayLanBind:       cfgOverlayLanBind,
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
		mode := cfgDataStorageMode
		tr := cfgTrackRecording
		rn := cfgRoomName
		rp := cfgRoomPassword
		dashboardURL := cfgEngineerDashboardURL
		paired := cfgUploadToken != ""
		// permissions: null=미확인(fail-open — 소비자는 허용으로 판정), 배열=확정
		// 그랜트 노드 원본. setup-manager가 3초 폴링으로 게이트에 쓴다.
		var perms []string
		if cfgPermsFetched {
			perms = cfgPermissions
			if perms == nil {
				perms = []string{}
			}
		}
		cfgMu.Unlock()
		senderState := buildSenderState(sf, tr, mode)

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
			"banned":             processor.IsBanned(),
			"paired":             paired,
			"permissions":        perms,
			"strategyActive":     strategyOv.IsRunning(),
			"invite":             invite,
			"peers":              peers,
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

	mux.HandleFunc("GET /api/races/latest", latestRaceHandler(
		func() *races.RaceSummary {
			raceSummaryMu.RLock()
			defer raceSummaryMu.RUnlock()
			return latestRaceSummary
		},
		func() *races.FileStorage {
			cfgMu.Lock()
			defer cfgMu.Unlock()
			return raceStorage
		}, logger,
	))

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

		summary, err := loadRaceSummaryWithoutReplay(id)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			switch {
			case os.IsNotExist(err):
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
			case errors.Is(err, races.ErrUnsafeID):
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid race id"})
			default:
				logger.Error("failed to load race summary", "id", id, "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "failed to load race summary"})
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stripPrivateCapture(summary))
	})

	// ── Platform upload (device pairing → token → authenticated POST /races) ──
	mux.HandleFunc("POST /api/upload/pair", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Code string `json:"code"`
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil || strings.TrimSpace(body.Code) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "페어링 코드를 입력하세요"})
			return
		}
		cfgMu.Lock()
		base := cfgPlatformBaseURL
		cfgMu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), uploadHTTPTimeout)
		defer cancel()
		token, err := exchangePairing(ctx, base, body.Code)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		cfgMu.Lock()
		wasPaired := cfgUploadToken != ""
		wasAllowed := !cfgPermsFetched || rbac.HasPermission(cfgPermissions, rbac.PermBroadcastCreate)
		cfgUploadToken = token
		// 재페어링은 계정이 바뀌었을 수 있다 — 이전 계정의 권한 캐시를 무효화한다
		// (새 계정은 fetch 성공 전까지 fail-open; 이전 거부가 이월되지 않음).
		cfgPermissions = nil
		cfgPermsFetched = false
		saveErr := saveSenderConfig(buildSenderConfigSnapshot())
		cfgMu.Unlock()
		if saveErr != nil {
			logger.Warn("failed to persist upload token", "error", saveErr)
		}
		// 신규 페어링, 또는 직전 계정이 송출 거부로 세션이 닫혀 있던 재페어링이면
		// 연결을 (재)시작한다. 이미 연결·허용 상태의 재페어링은 건드리지 않는다.
		if (!wasPaired || !wasAllowed) && shouldBeConnected() {
			logger.Info("device paired — starting pitwall connection")
			go connectWithRetry()
		}
		go refreshPermissions()
		// 페어링 직후 미업로드 요약 sweep — 부팅 시 미페어링이었던 경우의 백스톱.
		// (요청 ctx와 무관하게 돌도록 Background; sweep이 요청별 deadline을 관리한다.)
		go upState.sweep(context.Background(), base, token, loadRaceSummaryWithoutReplay)
		json.NewEncoder(w).Encode(map[string]bool{"paired": true})
	})

	mux.HandleFunc("GET /api/upload/status", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.Lock()
		paired := cfgUploadToken != ""
		cfgMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		// platformBaseUrl은 UI(settings.html·Driver Pack)의 웹 허브 안내 링크 전용 —
		// API 베이스(cfgPlatformBaseURL)와 호스트가 다르다
		json.NewEncoder(w).Encode(map[string]any{
			"paired":          paired,
			"platformBaseUrl": defaultHubBaseURL,
		})
	})

	mux.HandleFunc("POST /api/races/{id}/upload", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.PathValue("id"))
		w.Header().Set("Content-Type", "application/json")
		if id == "" || strings.ContainsAny(id, `/\`) || strings.Contains(id, "..") {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid race id"})
			return
		}
		cfgMu.Lock()
		token := cfgUploadToken
		base := cfgPlatformBaseURL
		cfgMu.Unlock()
		if token == "" {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "먼저 페어링하세요"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), uploadHTTPTimeout)
		defer cancel()
		result, status, err := upState.uploadSealed(ctx, base, token, id, loadRaceSummaryWithoutReplay)
		if err != nil {
			code := http.StatusBadGateway
			message := err.Error()
			switch {
			case errors.Is(err, os.ErrNotExist):
				code, message = http.StatusNotFound, "race summary not found"
			case errors.Is(err, errUploadSnapshot):
				logger.Error("failed to load race summary for upload", "id", id, "error", err)
				code, message = http.StatusInternalServerError, "failed to load race summary"
			case errors.Is(err, errNoUploadableLaps):
				code, message = http.StatusUnprocessableEntity, "이 레이스에는 업로드할 랩 데이터가 없습니다"
			case status == http.StatusUnauthorized || status == http.StatusForbidden:
				code = http.StatusUnauthorized
			}
			w.WriteHeader(code)
			json.NewEncoder(w).Encode(map[string]string{"error": message})
			return
		}
		json.NewEncoder(w).Encode(result)
	})

	mux.Handle("/api/sessions/{dir}/trace", analysishttp.TraceHandler(packetLogDir))

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
		mode := cfgDataStorageMode
		tr := cfgTrackRecording
		rn := cfgRoomName
		rp := cfgRoomPassword
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
			"dataStorageMode":      mode,
			"trackRecording":       tr,
			"roomName":             rn,
			"roomPassword":         rp,
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
			DataStorageMode                    rtconfig.DataStorageMode `json:"dataStorageMode"`
			TrackRecording                     bool                     `json:"trackRecording"`
			TrackRecordingOverwriteApprovedFor string                   `json:"trackRecordingOverwriteApprovedFor"`
			RoomName                           string                   `json:"roomName"`
			RoomPassword                       string                   `json:"roomPassword"`
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
			// 텔레메트리 유출 방지: 포워딩 대상은 로컬/사설 범위만 허용한다.
			// 공인 IP 등 외부 호스트로의 포워딩을 거부해 유출 반경을 줄인다.
			if !isForwardHostAllowed(ft.Host) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "forward target host must be a local/private address (loopback, LAN, or .local)"})
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

		nextDataStorageMode := cfgDataStorageMode
		if body.DataStorageMode != "" {
			nextDataStorageMode = rtconfig.NormalizeDataStorageMode(body.DataStorageMode)
		}

		// Toggle save files and storage mode.
		saveFilesChanged := body.SaveFiles != cfgSaveFiles
		storageModeChanged := nextDataStorageMode != cfgDataStorageMode
		if saveFilesChanged || storageModeChanged {
			cfgSaveFiles = body.SaveFiles
			cfgDataStorageMode = nextDataStorageMode

			if cfgSaveFiles {
				if raceStorage == nil {
					rs, err := races.NewFileStorage(resolveSenderStoragePath("data", "races"), logger)
					if err != nil {
						logger.Warn("failed to create race storage", "error", err)
					} else {
						raceStorage = rs
					}
				}
			} else {
				raceStorage = nil
			}

			wantPacketLogging := cfgSaveFiles && cfgDataStorageMode == rtconfig.DataStorageModeAdvanced
			if wantPacketLogging {
				if packetLogger == nil {
					packetLogger = udp.NewPacketLogger(packetLogDir, logger)
				}
				parser.SetPacketLogger(packetLogger)
			} else {
				parser.SetPacketLogger(nil)
				if packetLogger != nil {
					packetLogger.Close()
					packetLogger = nil
				}
				sessionAnalysisCacheMu.Lock()
				sessionAnalysisCache = make(map[string]sessionAnalysisCacheEntry)
				sessionAnalysisCacheMu.Unlock()
			}

			// 요약 파이프라인은 항상 활성(위 SetRaceSummaryRecording(true) 참조) —
			// 저장 설정 변경은 리플레이 녹화/패킷 로깅만 토글한다.
			processor.SetReplayRecording(cfgSaveFiles && (cfgDataStorageMode == rtconfig.DataStorageModeSummary || cfgDataStorageMode == rtconfig.DataStorageModeAdvanced))
			logger.Info("save storage changed", "saveFiles", cfgSaveFiles, "dataStorageMode", cfgDataStorageMode, "packetLogging", wantPacketLogging)
		}

		// Toggle track recording independently
		if body.TrackRecording != cfgTrackRecording {
			cfgTrackRecording = body.TrackRecording
			recorder.SetEnabled(body.TrackRecording)
			logger.Info("track recording changed", "enabled", body.TrackRecording)
		}
		processor.PitwallManager().SetSenderState(buildSenderState(cfgSaveFiles, cfgTrackRecording, cfgDataStorageMode))

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

		// Persist config to disk
		if err := saveSenderConfig(buildSenderConfigSnapshot()); err != nil {
			logger.Warn("failed to save sender config", "error", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"udpPort":              cfgUDPPort,
			"saveFiles":            cfgSaveFiles,
			"dataStorageMode":      cfgDataStorageMode,
			"trackRecording":       cfgTrackRecording,
			"roomName":             cfgRoomName,
			"roomPassword":         cfgRoomPassword,
			"engineerDashboardUrl": cfgEngineerDashboardURL,
			"forwardTargets":       cfgForwardTargets,
			"overlayPresets":       cfgOverlayPresets,
			"overlayHotkeys":       cfgOverlayHotkeys,
		})
	})

	mux.HandleFunc("GET /api/debug", func(w http.ResponseWriter, r *http.Request) {
		// 디버그 덤프는 읽기 전용 — 브로드캐스트 트랙맵 페이싱 상태를 소모하지 않는 변형 사용
		state := processor.PitwallManager().BuildStateReadOnly()
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

	mux.HandleFunc("POST /api/debug/client-log", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()

		var payload clientDebugPayload
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&payload); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid debug log payload"})
			return
		}

		logClientDebug(logger, "", payload)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/debug/logs", func(w http.ResponseWriter, r *http.Request) {
		maxBytes := senderLogTailMaxBytes
		if raw := strings.TrimSpace(r.URL.Query().Get("bytes")); raw != "" {
			if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
				switch {
				case parsed <= 0:
					maxBytes = senderLogTailMaxBytes
				case parsed > 256*1024:
					maxBytes = 256 * 1024
				default:
					maxBytes = parsed
				}
			}
		}

		data, err := readFileTail(logFilePath, maxBytes)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to read sender log"})
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	})

	// Try settingsPort, then auto-increment up to 10 times on conflict.
	// In the embedded driver pack, keep the API contract pinned to the requested port.
	actualSettingsPort := settingsPort
	// ReadHeaderTimeout만 설정한다 — 전역 WriteTimeout은 장수명 SSE 스트림을
	// 끊어버리므로 쓰기 데드라인은 SSE 핸들러의 per-write 데드라인으로 처리한다.
	settingsSrv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
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
		// 루프백 전용 바인드(기본): LAN 공격자가 설정/디버그 API(PUT /api/config 등)로
		// 접근해 forwardTargets를 바꿔 텔레메트리를 탈취하는 것을 차단한다.
		// 로컬 UI는 http://localhost, 오버레이는 same-origin 상대 EventSource라 영향 없음.
		// 듀얼PC/OBS 등 LAN 기기에서 오버레이 페이지가 필요하면 sender-config.json에
		// "overlayLanBind": true 를 설정(opt-in, 재시작 필요) — 설정 API도 함께 노출됨.
		bindHost := "127.0.0.1:"
		if cfgOverlayLanBind {
			bindHost = ":"
			logger.Warn("settings/overlay server binding on ALL interfaces (overlayLanBind=true) — settings API is reachable from the LAN")
		}
		for attempt := range maxAttempts {
			port := basePort + attempt
			actualSettingsPort = fmt.Sprintf("%d", port)
			settingsSrv.Addr = bindHost + actualSettingsPort
			logger.Info("settings server starting", "port", actualSettingsPort, "lanBind", cfgOverlayLanBind)
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
	// Do not tear down stores while the processor is saving its final checkpoint.
	// Driver Pack owns the bounded forced-stop fallback if the process stalls.
	<-processor.Done()
	forwarder.Close()
	peerManager.Close()
	compareMonitor.Close()
	// 핸들러(PUT /api/config)가 packetLogger를 만지므로, 먼저 서버를 드레인한 뒤
	// cfgMu로 감싸 packetLogger를 정리해 종료 레이스를 막는다.
	// 단, radar/weather/strategy SSE 핸들러는 클라 연결 종료 시에만 끝나므로
	// Shutdown에 타임아웃을 둬 무한 대기를 막는다(초과 시 정리로 진행 후 프로세스 종료).
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 3*time.Second)
	settingsSrv.Shutdown(shutdownCtx)
	cancelShutdown()
	cfgMu.Lock()
	if packetLogger != nil {
		packetLogger.Close()
	}
	cfgMu.Unlock()
	logger.Info("sender shutdown complete")
	logFile.Close()
}

// isForwardHostAllowed는 UDP 텔레메트리 포워딩 대상이 로컬/사설 범위인지 검사한다.
// 공인 IP나 임의 외부 호스트로의 포워딩을 막아 LAN 텔레메트리 유출 반경을 줄인다.
// 허용: localhost, *.local(mDNS), 루프백/사설/링크로컬 IP, 그리고 사설 범위로만
// resolve되는 LAN 호스트네임(예: Windows 컴퓨터명 "GAMINGPC", "nas.lan" — 기존 유효
// 설정이 IP 리터럴 강제화로 깨지지 않도록). (preferHTTPDashboardURL과 동일 정책)
func isForwardHostAllowed(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".local") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPrivateForwardIP(ip)
	}
	// 호스트네임: 짧은 타임아웃으로 resolve해(설정 저장 경로에서만 호출됨) 모든 결과가
	// 로컬/사설 범위일 때만 허용 — 하나라도 공인 IP면 유출 가능성이 있으므로 거부.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(addrs) == 0 {
		return false
	}
	for _, ip := range addrs {
		if !isPrivateForwardIP(ip) {
			return false
		}
	}
	return true
}

func isPrivateForwardIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
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
