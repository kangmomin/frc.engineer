package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"frc.engineer/internal/analysis"
	"frc.engineer/internal/auth"
	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
	"frc.engineer/internal/udp"
)

type contextKey string

const sessionContextKey contextKey = "session"

// Options contains dependencies for the HTTP API server.
type Options struct {
	Logger *slog.Logger

	AuthService *auth.Service
	Sessions    auth.SessionStore

	SessionTTL          time.Duration
	SessionCookieName   string
	SessionCookieSecure bool

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

// Server owns HTTP handlers and auth middleware.
type Server struct {
	logger *slog.Logger

	authService *auth.Service
	sessions    auth.SessionStore

	sessionTTL          time.Duration
	sessionCookieName   string
	sessionCookieSecure bool

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
		logger:              opts.Logger,
		authService:         opts.AuthService,
		sessions:            opts.Sessions,
		sessionTTL:          opts.SessionTTL,
		sessionCookieName:   opts.SessionCookieName,
		sessionCookieSecure: opts.SessionCookieSecure,
		runtimeConfig:       opts.RuntimeConfig,
		forwarder:           opts.Forwarder,
		recorder:            opts.Recorder,
		parser:              opts.Parser,
		packetLogDir:        opts.PacketLogDir,
		trackStore:          opts.TrackStore,
		pitwallState:        opts.PitwallState,
		clientCounter:       opts.ClientCount,
	}
	if opts.InitialPacketLogging {
		s.enablePacketLogging()
	}
	return s
}

// RegisterRoutes wires all HTTP and WebSocket routes.
func (s *Server) RegisterRoutes(mux *http.ServeMux, wsHandler http.Handler, distFS fs.FS) {
	mux.Handle("/ws", s.RequireSession(wsHandler))
	mux.HandleFunc("/health", s.handleHealth)

	mux.HandleFunc("/api/auth/login", s.handleAuthLogin)
	mux.HandleFunc("/api/auth/me", s.handleAuthMe)
	mux.HandleFunc("/api/auth/logout", s.handleAuthLogout)

	mux.Handle("/api/config", s.RequireSession(http.HandlerFunc(s.handleConfig)))
	mux.Handle("/api/tracks", s.RequireSession(http.HandlerFunc(s.handleTracks)))
	mux.Handle("/api/sessions", s.RequireSession(http.HandlerFunc(s.handleSessions)))
	mux.Handle("/api/sessions/", s.RequireSession(http.HandlerFunc(s.handleSessionAnalysis)))
	mux.Handle("/api/debug/pitwall", s.RequireSession(http.HandlerFunc(s.handleDebugPitwall)))

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

// StartSessionCleanup periodically deletes expired sessions.
func (s *Server) StartSessionCleanup(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				removed := s.sessions.CleanupExpired(time.Now().UTC())
				if removed > 0 {
					s.logger.Info("expired sessions cleaned", "removed", removed)
				}
			}
		}
	}()
}

// Close releases runtime resources.
func (s *Server) Close() {
	s.disablePacketLogging()
}

// RequireSession enforces session auth and adds session info to request context.
func (s *Server) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := s.sessionFromRequest(r)
		if !ok {
			s.writeUnauthorized(w)
			return
		}
		ctx := context.WithValue(r.Context(), sessionContextKey, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
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

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var creds struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&creds); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	result, err := s.authService.Login(creds.Email, creds.Password)
	if err != nil {
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}

	session, err := s.sessions.Create(result.User, result.AccessToken, s.sessionTTL)
	if err != nil {
		s.logger.Error("failed to create session", "error", err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	s.setSessionCookie(w, r, session.ID, session.ExpiresAt)
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": result.User,
	})
}

func (s *Server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	session, ok := s.sessionFromRequest(r)
	if !ok {
		s.writeUnauthorized(w)
		return
	}

	if hasAccess, err := s.authService.VerifyProductAccess(session.AccessToken); err == nil && !hasAccess {
		s.sessions.Delete(session.ID)
		s.clearSessionCookie(w, r)
		s.writeUnauthorized(w)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":     session.User,
		"loggedIn": true,
	})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if c, err := r.Cookie(s.sessionCookieName); err == nil {
		s.sessions.Delete(c.Value)
	}
	s.clearSessionCookie(w, r)
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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

func (s *Server) sessionFromRequest(r *http.Request) (*auth.Session, bool) {
	cookie, err := r.Cookie(s.sessionCookieName)
	if err != nil {
		return nil, false
	}
	return s.sessions.Get(cookie.Value)
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, sessionID string, expiresAt time.Time) {
	secure := s.sessionCookieSecure && r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     s.sessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	secure := s.sessionCookieSecure && r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     s.sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

func (s *Server) writeUnauthorized(w http.ResponseWriter) {
	s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
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
