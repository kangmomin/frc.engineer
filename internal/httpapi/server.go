package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"frc.engineer/internal/analysis"
	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
)

// Options contains dependencies for the HTTP API server.
type Options struct {
	Logger *slog.Logger

	RuntimeConfig *rtconfig.RuntimeConfigManager
	Forwarder     *udp.Forwarder
	Recorder      *telemetry.TrackRecorder
	Parser        *udp.Parser
	PacketLogDir  string

	TrackStore      *tracks.TrackStore
	PitwallState func() interface{}
	ClientCount  func() int

	InitialPacketLogging bool
}

// Server owns HTTP handlers.
type Server struct {
	logger *slog.Logger

	runtimeConfig *rtconfig.RuntimeConfigManager
	forwarder     *udp.Forwarder
	recorder      *telemetry.TrackRecorder
	parser        *udp.Parser
	packetLogDir  string

	trackStore    *tracks.TrackStore
	pitwallState  func() interface{}
	clientCounter func() int

	packetLoggerMu sync.Mutex
	packetLogger   *udp.PacketLogger
}

// NewServer creates a new API server and applies initial runtime state.
func NewServer(opts Options) *Server {
	s := &Server{
		logger:        opts.Logger,
		runtimeConfig: opts.RuntimeConfig,
		forwarder:     opts.Forwarder,
		recorder:      opts.Recorder,
		parser:        opts.Parser,
		packetLogDir:  opts.PacketLogDir,
		trackStore:    opts.TrackStore,
		pitwallState:  opts.PitwallState,
		clientCounter: opts.ClientCount,
	}
	if opts.InitialPacketLogging {
		s.enablePacketLogging()
	}
	return s
}

// RegisterRoutes wires all HTTP and WebSocket routes.
func (s *Server) RegisterRoutes(mux *http.ServeMux, wsHandler http.Handler, distFS fs.FS) {
	mux.Handle("/ws", wsHandler)
	mux.HandleFunc("/health", s.handleHealth)

	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/tracks", s.handleTracks)
	mux.HandleFunc("/api/sessions", s.handleSessions)
	mux.HandleFunc("/api/sessions/", s.handleSessionAnalysis)
	mux.HandleFunc("/api/debug/pitwall", s.handleDebugPitwall)

	fileServer := http.FileServer(http.FS(distFS))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trimmed := strings.TrimPrefix(r.URL.Path, "/")
		if trimmed == "" {
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}

		f, err := distFS.Open(trimmed)
		if err != nil {
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
			return
		}
		_ = f.Close()
		fileServer.ServeHTTP(w, r)
	}))
}

// Close releases runtime resources.
func (s *Server) Close() {
	s.disablePacketLogging()
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	clients := 0
	if s.clientCounter != nil {
		clients = s.clientCounter()
	}
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"clients": clients,
	})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		current := s.runtimeConfig.Get()
		_ = json.NewEncoder(w).Encode(current)

	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		var newCfg rtconfig.RuntimeConfig
		if err := json.Unmarshal(body, &newCfg); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := validateRuntimeConfig(newCfg); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.runtimeConfig.Update(newCfg); err != nil {
			http.Error(w, "failed to save config", http.StatusInternalServerError)
			return
		}

		s.forwarder.UpdateTargets(newCfg.ForwardTargets)
		s.recorder.SetEnabled(newCfg.TrackRecording)
		if newCfg.PacketLogging {
			s.enablePacketLogging()
		} else {
			s.disablePacketLogging()
		}

		_ = json.NewEncoder(w).Encode(newCfg)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTracks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.writeJSON(w, http.StatusOK, s.trackStore.ListRecordedFiles())
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessions, err := analysis.ListSessions(s.packetLogDir)
	if err != nil {
		s.writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	s.writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleSessionAnalysis(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	if !strings.HasSuffix(path, "/analysis") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	dir := strings.TrimSuffix(path, "/analysis")
	dir = strings.TrimSuffix(dir, "/")
	if !isSafeSessionDir(dir) {
		http.Error(w, "invalid directory", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(s.packetLogDir, dir)
	result, err := analysis.Analyze(fullPath)
	if err != nil {
		s.logger.Error("analysis failed", "dir", dir, "error", err)
		http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleDebugPitwall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.pitwallState == nil {
		s.writeJSON(w, http.StatusOK, map[string]interface{}{})
		return
	}
	s.writeJSON(w, http.StatusOK, s.pitwallState())
}

func (s *Server) enablePacketLogging() {
	s.packetLoggerMu.Lock()
	defer s.packetLoggerMu.Unlock()

	if s.packetLogger != nil {
		return
	}
	s.packetLogger = udp.NewPacketLogger(s.packetLogDir, s.logger)
	s.parser.SetPacketLogger(s.packetLogger)
	s.logger.Info("packet logging enabled", "dir", s.packetLogDir)
}

func (s *Server) disablePacketLogging() {
	s.packetLoggerMu.Lock()
	defer s.packetLoggerMu.Unlock()

	if s.packetLogger == nil {
		return
	}
	s.parser.SetPacketLogger(nil)
	s.packetLogger.Close()
	s.packetLogger = nil
	s.logger.Info("packet logging disabled")
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func validateRuntimeConfig(cfg rtconfig.RuntimeConfig) error {
	if cfg.UDPPort < 1 || cfg.UDPPort > 65535 {
		return fmt.Errorf("udpPort must be 1-65535")
	}
	if cfg.BackendPort < 1 || cfg.BackendPort > 65535 {
		return fmt.Errorf("backendPort must be 1-65535")
	}
	if len(cfg.ForwardTargets) > 16 {
		return fmt.Errorf("too many forward targets (max 16)")
	}
	for _, ft := range cfg.ForwardTargets {
		if strings.TrimSpace(ft.Host) == "" || ft.Port < 1 || ft.Port > 65535 {
			return fmt.Errorf("invalid forward target: host required, port 1-65535")
		}
	}
	if cfg.DataStorageMode != "" && cfg.DataStorageMode != rtconfig.DataStorageModeResultOnly &&
		cfg.DataStorageMode != rtconfig.DataStorageModeSummary &&
		cfg.DataStorageMode != rtconfig.DataStorageModeAdvanced {
		return fmt.Errorf("dataStorageMode must be one of: resultOnly, summary, advanced")
	}
	return nil
}

func isSafeSessionDir(dir string) bool {
	if dir == "" {
		return false
	}
	if strings.Contains(dir, "..") {
		return false
	}
	if strings.ContainsAny(dir, `/\`) {
		return false
	}
	clean := filepath.Clean(dir)
	return clean == dir
}
