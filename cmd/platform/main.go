// Command platform is the hosted Pitwall Cloud backend: Steam accounts and
// sessions, telemetry ingestion, cross-user leaderboards, a setup/strategy
// marketplace, a closed-loop virtual credit economy, and reviews. It reuses the
// cmd/signaling operational shape (PORT-driven, Postgres via DATABASE_URL,
// ALLOWED_ORIGINS CORS, signal-based graceful shutdown) but, unlike signaling's
// optional ban DB, Postgres is mandatory here — the platform is nothing without
// it, so a missing/failing DATABASE_URL is a hard boot failure.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	automation, err := parseUpdateLogAutomationConfig(os.Getenv("PLATFORM_UPDATE_LOG_API_KEY_SHA256"), os.Getenv("PLATFORM_UPDATE_LOG_TRUSTED_PROXY_CIDRS"))
	if err != nil {
		logger.Error("invalid automation configuration", "error", err)
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		logger.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()

	openCtx, openCancel := context.WithTimeout(context.Background(), 15*time.Second)
	store, err := platformsvc.Open(openCtx, dsn)
	openCancel()
	if err != nil {
		logger.Error("database connect failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	migCtx, migCancel := context.WithTimeout(context.Background(), 60*time.Second)
	err = store.Migrate(migCtx)
	migCancel()
	if err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations applied")

	// PLATFORM_ADMIN_ACCOUNT_IDS is the admin-ROLE bootstrap: each listed
	// account is idempotently granted the 'admin' role at boot. Removing an id
	// from the env does NOT revoke the role — permanent removal = remove here
	// AND revoke via the /rbac API (or SQL). Failures warn and boot continues
	// (an env typo must not kill the platform); the assignment persists across
	// restarts, so a transient failure only matters on the very first boot
	// with a given id. Restarting with the env set is also the recovery path
	// for an admin who revoked their own role.
	bootCtx, bootCancel := context.WithTimeout(context.Background(), 10*time.Second)
	for id := range parseAdminAccountIDs(os.Getenv("PLATFORM_ADMIN_ACCOUNT_IDS"), logger) {
		granted, err := store.AssignRole(bootCtx, id, rbac.RoleAdmin)
		switch {
		case errors.Is(err, platformsvc.ErrNotFound):
			logger.Warn("admin bootstrap: unknown account id", "accountId", id)
		case err != nil:
			logger.Warn("admin bootstrap failed", "accountId", id, "error", err)
		case granted:
			logger.Info("admin role granted from env", "accountId", id)
		}
	}
	bootCancel()

	// OpenID realm / return URL derive from PUBLIC_BASE_URL (the platform's own
	// public origin). FRONTEND_URL is where the Hub SPA lives; the callback
	// hands the session token back there.
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/")
	frontendURL := strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/")
	steam := platformsvc.NewSteamAuth(
		store,
		strings.TrimSpace(os.Getenv("STEAM_API_KEY")),
		baseURL+"/",
		baseURL+"/auth/steam/callback",
		logger,
	)
	secureCookies := strings.HasPrefix(baseURL, "https://")

	srv := &server{store: store, steam: steam, log: logger, frontendURL: frontendURL, secureCookies: secureCookies, updateLogAutomation: automation}

	allowedOrigins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))

	// Periodic sweep of expired sessions/pairings/nonces.
	go func() {
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-appCtx.Done():
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				if err := store.SweepExpired(ctx); err != nil {
					logger.Warn("sweep failed", "error", err)
				}
				cancel()
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/auth/steam/login", srv.handleLogin)
	mux.HandleFunc("/auth/steam/callback", srv.handleCallback)
	mux.HandleFunc("/auth/logout", srv.handleLogout)
	mux.HandleFunc("POST /view-as", srv.handleViewAs)
	mux.HandleFunc("POST /view-as/exit", srv.handleViewAsExit)
	mux.HandleFunc("/me", srv.handleMe)
	mux.HandleFunc("/device/pair", srv.handlePair)
	mux.HandleFunc("/device/exchange", srv.handleExchange)
	mux.HandleFunc("/races", srv.handleUpload)
	mux.HandleFunc("/leaderboards/records", srv.handleLeaderboardRecords)
	mux.HandleFunc("/leaderboards/tt", srv.handleLeaderboardTT)
	mux.HandleFunc("/leaderboards/pace", srv.handleLeaderboardPace)
	mux.HandleFunc("/search", srv.handleSearch)
	mux.HandleFunc("GET /profiles/{id}", srv.handleProfile)
	mux.HandleFunc("GET /tracks/{id}/pit-loss", srv.handlePitLoss)
	mux.HandleFunc("GET /me/races", srv.handleMyRaces)
	mux.HandleFunc("GET /me/race-analyses", srv.handleMyRaceAnalyses)
	mux.HandleFunc("GET /me/race-analyses/{id}", srv.handleMyRaceAnalysis)
	mux.HandleFunc("GET /me/race-analyses/{id}/incidents/{index}", srv.handleMyRaceAnalysisIncident)
	registerRaceAnalysisShareRoutes(mux, srv)
	mux.HandleFunc("GET /me/setups", srv.handleMySetups)
	mux.HandleFunc("GET /me/setups/{id}", srv.handleMySetup)
	mux.HandleFunc("POST /me/setups/{id}", srv.handleUpdateMySetup)
	mux.HandleFunc("GET /me/listings", srv.handleMyListings)
	mux.HandleFunc("GET /market/setups", srv.handleMarketSetups)
	mux.HandleFunc("GET /market/strategies", srv.handleMarketStrategies)
	mux.HandleFunc("POST /listings", srv.handleCreateListing)
	mux.HandleFunc("GET /listings/{id}", srv.handleGetListing)
	mux.HandleFunc("GET /listings/{id}/similar", srv.handleSimilar)
	mux.HandleFunc("POST /listings/{id}/delist", srv.handleDelist)
	mux.HandleFunc("GET /wallet", srv.handleWallet)
	mux.HandleFunc("GET /ledger", srv.handleLedger)
	mux.HandleFunc("POST /listings/{id}/purchase", srv.handlePurchase)
	mux.HandleFunc("GET /listings/{id}/reviews", srv.handleListReviews)
	mux.HandleFunc("POST /listings/{id}/reviews", srv.handleCreateReview)
	mux.HandleFunc("POST /feedback", srv.handleCreateFeedback)
	mux.HandleFunc("GET /me/feedback", srv.handleMyFeedback)
	mux.HandleFunc("GET /feedback-inbox", srv.handleFeedbackInbox)
	mux.HandleFunc("GET /update-logs", srv.handleUpdateLogs)
	mux.HandleFunc("POST /update-logs", srv.handleCreateUpdateLog)
	mux.HandleFunc("POST /me/update-logs/seen", srv.handleUpdateLogsSeen)
	mux.HandleFunc("POST /automation/update-logs", srv.handleAutomationUpdateLog)
	mux.HandleFunc("POST /analysis", srv.handleCreateAnalysis)
	mux.HandleFunc("GET /analysis", srv.handleListAnalyses)
	mux.HandleFunc("GET /analysis/{id}", srv.handleGetAnalysis)
	mux.HandleFunc("POST /analysis/{id}/delete", srv.handleDeleteAnalysis)
	mux.HandleFunc("GET /permissions", srv.handlePermissions)
	mux.HandleFunc("GET /rbac/permissions", srv.handleRBACPermissions)
	mux.HandleFunc("GET /rbac/roles", srv.handleRBACListRoles)
	mux.HandleFunc("POST /rbac/roles", srv.handleRBACCreateRole)
	mux.HandleFunc("POST /rbac/roles/{name}/delete", srv.handleRBACDeleteRole)
	mux.HandleFunc("POST /rbac/roles/{name}/permissions", srv.handleRBACSetRolePermissions)
	mux.HandleFunc("GET /rbac/accounts", srv.handleRBACSearchAccounts)
	mux.HandleFunc("GET /rbac/accounts/{id}/roles", srv.handleRBACGetAccountRoles)
	mux.HandleFunc("POST /rbac/accounts/{id}/roles", srv.handleRBACSetAccountRoles)

	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           withCORS(allowedOrigins, mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("platform server started", "addr", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	logger.Info("shutting down platform server")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

// server holds shared handler dependencies.
type server struct {
	store               *platformsvc.Store
	steam               *platformsvc.SteamAuth
	log                 *slog.Logger
	frontendURL         string
	secureCookies       bool
	updateLogAutomation *updateLogAutomationConfig
	// These narrow seams keep owner-analysis auth/404 behavior testable without
	// a disposable database. Production leaves these nil and uses store directly.
	raceAnalysisReader  raceAnalysisReader
	raceAnalysisShares  raceAnalysisShareStore
	authenticateForTest func(context.Context, *http.Request) (platformsvc.Principal, error)
}

type raceAnalysisReader interface {
	ListMyRaceAnalyses(context.Context, string, int, int, ...platformsvc.RaceAnalysisFilters) (*platformsvc.RaceAnalysisListResponse, error)
	GetMyRaceAnalysis(context.Context, string, string) (*platformsvc.RaceAnalysisDetail, error)
	GetMyRaceAnalysisIncident(context.Context, string, string, int) (*platformsvc.RaceAnalysisIncidentReplay, error)
}

func (s *server) analysisReader() raceAnalysisReader {
	if s.raceAnalysisReader != nil {
		return s.raceAnalysisReader
	}
	return s.store
}

// parseAdminAccountIDs parses the comma-separated UUID list that seeds the
// admin-role bootstrap in main(). 오타 항목은 warn+skip — 운영자 env 실수로
// 플랫폼 전체가 죽으면 안 된다.
func parseAdminAccountIDs(raw string, logger *slog.Logger) map[string]struct{} {
	ids := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		p := strings.ToLower(strings.TrimSpace(part))
		if p == "" {
			continue
		}
		if _, err := uuid.Parse(p); err != nil {
			logger.Warn("ignoring malformed admin account id", "value", p)
			continue
		}
		ids[p] = struct{}{}
	}
	return ids
}

const oidcStateCookie = "platform_oidc_state"

// Ingestion limits.
const (
	uploadMaxBytes   = 512 << 10 // 512 KiB; laps dominate (≤500 × ~90B)
	uploadRatePerMin = 20
)

// handleSearch returns public setup cards and verified driver contexts. It is
// deliberately anonymous: the response carries only public listing metadata
// and the compact, latest leaderboard context for matching drivers.
func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	queries, ok := values["q"]
	if !ok || len(queries) != 1 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	query, ok := parseSearchQuery(queries[0])
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	result, err := s.store.Search(ctx, query)
	if err != nil {
		s.log.Error("search", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, result)
}

// handleProfile serves an authenticated, privacy-safe driver profile.
func (s *server) handleProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, allowViewAs: true}); !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	profile, err := s.store.DriverProfile(ctx, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		if s.log != nil {
			s.log.Error("driver profile", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func parseSearchQuery(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	query := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(query); n < 2 || n > 64 {
		return "", false
	}
	return query, true
}

// handleLogin starts Steam OpenID login: it mints an anti-CSRF state, binds it
// to the browser via an httpOnly cookie, and redirects to Steam.
func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	state, err := randomState()
	if err != nil {
		s.log.Error("login: random state", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookie,
		Value:    state,
		Path:     "/auth/steam/callback",
		MaxAge:   int(platformsvc.PairingTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secureCookies,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, s.steam.LoginURL(state), http.StatusFound)
}

// handleCallback verifies the browser's CSRF state, then the OpenID assertion,
// mints a fresh web session (no session fixation), and hands the token to the
// frontend (or returns JSON when FRONTEND_URL is unset).
func (s *server) handleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Login-CSRF: the state echoed on the return_to query must equal the cookie
	// set when this browser began login.
	cookie, err := r.Cookie(oidcStateCookie)
	if err != nil || cookie.Value == "" || cookie.Value != r.URL.Query().Get("state") {
		http.Error(w, "invalid state", http.StatusBadRequest)
		return
	}
	// One-shot: clear the state cookie.
	http.SetCookie(w, &http.Cookie{Name: oidcStateCookie, Value: "", Path: "/auth/steam/callback", MaxAge: -1, HttpOnly: true, Secure: s.secureCookies, SameSite: http.SameSiteLaxMode})

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	account, err := s.steam.Authenticate(ctx, r.URL.Query())
	if err != nil {
		s.log.Warn("steam authenticate failed", "error", err)
		http.Error(w, "authentication failed", http.StatusUnauthorized)
		return
	}
	if account.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
		return
	}

	token, err := s.store.CreateSession(ctx, account.ID, platformsvc.ScopeWeb, platformsvc.WebSessionTTL)
	if err != nil {
		s.log.Error("callback: create session", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if s.frontendURL == "" {
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "account": account})
		return
	}
	// Deliver the token via the URL fragment (never sent to a server); the SPA
	// reads it, stores it, and strips it from the history entry.
	http.Redirect(w, r, s.frontendURL+"/#token="+url.QueryEscape(token), http.StatusFound)
}

// handleLogout revokes the presented session token.
func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := bearerToken(r)
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.store.DeleteSession(ctx, token); err != nil {
		s.log.Error("logout", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleMe returns the authenticated account.
func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	// 게이트는 authenticate만: /me에 permission을 걸면 Role 0개 계정이 401/403을
	// 받고, 웹 fetchMe가 그 응답에 토큰을 지워 락아웃 루프가 된다. ban 시에도
	// 응답하는 것 역시 현행 유지(자기 조회 semantics).
	p, ok := s.gate(ctx, w, r, gateSpec{allowViewAs: true})
	if !ok {
		return
	}
	account, err := s.store.GetAccount(ctx, p.AccountID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// permissions는 그랜트 노드 원본(전개 아님 — hasPermission으로 매칭할 것).
	// admin은 deprecated: 유일한 실소비자였던 구버전 웹의 ANALYSIS 게이트
	// semantics(분석 열람 가능 여부)를 보존하는 호환 필드다. 신규 소비자 금지 —
	// permissions를 쓸 것.
	var viewAs *viewAsMe
	if p.ViewAs {
		viewAs = &viewAsMe{
			SessionID: p.ViewAsSessionID,
			Actor: viewAsActor{
				ID:      p.ActorAccountID,
				Persona: p.ActorPersona,
			},
			ExpiresAt: p.ViewAsExpiresAt.UTC().Format(time.RFC3339),
		}
	}
	writeJSON(w, http.StatusOK, struct {
		*platformsvc.Account
		Admin       bool      `json:"admin"`
		Permissions []string  `json:"permissions"`
		ViewAs      *viewAsMe `json:"viewAs,omitempty"`
	}{account, rbac.HasPermission(p.Permissions, rbac.PermAnalyzeRead), p.Permissions, viewAs})
}

type viewAsActor struct {
	ID      string `json:"id"`
	Persona string `json:"persona"`
}

type viewAsMe struct {
	SessionID string      `json:"sessionId"`
	Actor     viewAsActor `json:"actor"`
	ExpiresAt string      `json:"expiresAt"`
}

type viewAsSubject struct {
	ID        string `json:"id"`
	Persona   string `json:"persona"`
	AvatarURL string `json:"avatarUrl"`
	Kind      string `json:"kind"`
	Verified  bool   `json:"verified"`
	Banned    bool   `json:"banned"`
}

const viewAsMaxBytes = 4 << 10

// handleViewAs creates a short-lived read-only child from a current parent web
// session. Authorization is complete before the body is inspected.
func (s *server) handleViewAs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{
		scope:            platformsvc.ScopeWeb,
		blockBanned:      true,
		permission:       rbac.PermViewAsCreate,
		deniedAuditEvent: "view_as.denied_start",
	})
	if !ok {
		return
	}
	accountID, err := decodeViewAsAccountID(w, r)
	if err != nil {
		s.auditViewAsDenied("view_as.denied_start", p, r)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	created, err := s.store.CreateViewAsSession(ctx, bearerToken(r), accountID)
	switch {
	case errors.Is(err, platformsvc.ErrInvalidSession):
		s.auditViewAsDenied("view_as.denied_start", p, r, accountID)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	case errors.Is(err, platformsvc.ErrNotFound):
		s.auditViewAsDenied("view_as.denied_start", p, r, accountID)
		http.Error(w, "not found", http.StatusNotFound)
		return
	case errors.Is(err, platformsvc.ErrForbidden), errors.Is(err, platformsvc.ErrBanned):
		s.auditViewAsDenied("view_as.denied_start", p, r, accountID)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	case err != nil:
		s.log.Error("create view-as", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	event := "view_as.start"
	if created.Replaced {
		event = "view_as.replaced"
	}
	if s.log != nil {
		s.log.Info(event,
			"actor_account_id", p.AccountID,
			"subject_account_id", created.Subject.ID,
			"view_as_session_id", created.ID,
			"expires_at", created.ExpiresAt.UTC().Format(time.RFC3339),
			"replaced", created.Replaced,
			"method", r.Method,
			"path", r.URL.Path,
		)
	}
	writeJSON(w, http.StatusCreated, struct {
		Token     string        `json:"token"`
		SessionID string        `json:"sessionId"`
		ExpiresAt string        `json:"expiresAt"`
		Subject   viewAsSubject `json:"subject"`
	}{
		created.Token,
		created.ID,
		created.ExpiresAt.UTC().Format(time.RFC3339),
		viewAsSubject{
			ID:        created.Subject.ID,
			Persona:   created.Subject.Persona,
			AvatarURL: created.Subject.AvatarURL,
			Kind:      created.Subject.Kind,
			Verified:  created.Subject.Verified,
			Banned:    created.Subject.Banned,
		},
	})
}

func decodeViewAsAccountID(w http.ResponseWriter, r *http.Request) (string, error) {
	var body struct {
		AccountID string `json:"accountId"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, viewAsMaxBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return "", err
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return "", errors.New("trailing view-as JSON")
	}
	if _, err := uuid.Parse(body.AccountID); err != nil {
		return "", err
	}
	return body.AccountID, nil
}

// handleViewAsExit deletes only the presented child token. Parent and unknown
// tokens are deliberately indistinguishable successful no-ops.
func (s *server) handleViewAsExit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	token := bearerToken(r)
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	deleted, err := s.store.DeleteViewAsSession(ctx, token)
	if err != nil {
		s.log.Error("exit view-as", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if s.log != nil {
		args := []any{"method", r.Method, "path", r.URL.Path}
		if deleted != nil {
			args = append(args,
				"actor_account_id", deleted.ActorAccountID,
				"subject_account_id", deleted.SubjectID,
				"view_as_session_id", deleted.ID,
				"expires_at", deleted.ExpiresAt.UTC().Format(time.RFC3339),
			)
		}
		s.log.Info("view_as.exit", args...)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePair mints a device pairing code for the logged-in (web) account.
func (s *server) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermDeviceCreate})
	if !ok {
		return
	}
	code, err := s.store.CreatePairing(ctx, p.AccountID)
	if err != nil {
		s.log.Error("pair", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": code})
}

// handleExchange swaps a pairing code for an upload-scope device token. The code
// itself is the credential — no session required.
func (s *server) handleExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body); err != nil || body.Code == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token, err := s.store.ExchangePairing(ctx, body.Code)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "invalid or expired code", http.StatusUnauthorized)
		return
	}
	if errors.Is(err, platformsvc.ErrBanned) {
		http.Error(w, "account banned", http.StatusForbidden)
		return
	}
	if err != nil {
		s.log.Error("exchange", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "scope": platformsvc.ScopeUpload})
}

// handleUpload ingests a race from an upload-scope device token. The rate limit
// runs (autocommit) before the ingest transaction, so a failed or duplicate
// upload still consumes budget — no free retries against validation work.
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeUpload, blockBanned: true, permission: rbac.PermRaceCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":upload", uploadRatePerMin)
	if err != nil {
		s.log.Error("upload rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	var req platformsvc.UploadRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, uploadMaxBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	res, err := s.store.IngestRace(ctx, p.AccountID, req)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad upload", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrDuplicate):
		http.Error(w, "duplicate upload in progress", http.StatusConflict)
		return
	case err != nil:
		s.log.Error("ingest", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// handleLeaderboardTT serves the legacy all-session PB leaderboard (public; optional Bearer
// for you-highlight).
func (s *server) handleLeaderboardTT(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	viewer, err := s.optionalViewer(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	trackID, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	rows, err := s.store.TimeTrialLeaderboard(ctx, trackID, format, viewer)
	if err != nil {
		s.log.Error("tt leaderboard", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// Rows carry an Authorization-dependent `you` flag; key any shared cache on it.
	w.Header().Add("Vary", "Authorization")
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, rows)
}

// handleLeaderboardPace serves the Race Pace leaderboard.
func (s *server) handleLeaderboardPace(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	viewer, err := s.optionalViewer(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	trackID, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	rows, err := s.store.PaceLeaderboard(ctx, trackID, format, viewer)
	if err != nil {
		s.log.Error("pace leaderboard", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// Rows carry an Authorization-dependent `you` flag; key any shared cache on it.
	w.Header().Add("Vary", "Authorization")
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, rows)
}

// handlePitLoss serves measured pit-loss averages for a track, split by stop type.
// Public (no viewer-dependent fields), so it is share-cacheable without Vary.
func (s *server) handlePitLoss(w http.ResponseWriter, r *http.Request) {
	trackID, err := strconv.Atoi(r.PathValue("id"))
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if err != nil || format == "" {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rows, err := s.store.PitLossByTrack(ctx, trackID, format)
	if err != nil {
		s.log.Error("pit loss", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, rows)
}

// Marketplace limits.
const (
	listingMaxBytes    = 4 << 10 // 4 KiB: create body is tiny (no params — server-derived)
	listingRatePerMin  = 30
	marketCacheControl = "public, max-age=15"
)

// handleMarketSetups / handleMarketStrategies browse active listings of a kind
// by track+format. Public, cacheable; never expose payload/hash.
func (s *server) handleMarketSetups(w http.ResponseWriter, r *http.Request) {
	s.browseMarket(w, r, platformsvc.KindSetup)
}

func (s *server) handleMarketStrategies(w http.ResponseWriter, r *http.Request) {
	s.browseMarket(w, r, platformsvc.KindStrategy)
}

func (s *server) browseMarket(w http.ResponseWriter, r *http.Request, kind string) {
	trackID, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rows, err := s.store.BrowseListings(ctx, kind, trackID, format)
	if err != nil {
		s.log.Error("browse market", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, rows)
}

// handleMyRaces lists the caller's own plausible races for the sell picker. Web
// scope only; own private data → uncacheable.
func (s *server) handleMyRaces(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermRaceRead, allowViewAs: true})
	if !ok {
		return
	}
	races, err := s.store.ListMyRaces(ctx, p.AccountID)
	if err != nil {
		s.log.Error("my races", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, races)
}

// handleMyRaceAnalyses is the owner-only structured analysis list. It is
// intentionally separate from /me/races: marketplace eligibility/plausibility
// must never hide a caller's own uploaded history here.
func (s *server) handleMyRaceAnalyses(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermRaceRead, allowViewAs: r.Method == http.MethodGet})
	if !ok {
		return
	}
	limit, offset, ok := raceAnalysisPagination(r)
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	filters, ok := raceAnalysisFilters(r)
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	response, err := s.analysisReader().ListMyRaceAnalyses(ctx, p.AccountID, limit, offset, filters)
	if err != nil {
		if s.log != nil {
			s.log.Error("list race analyses", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *server) handleMyRaceAnalysis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermRaceRead, allowViewAs: r.Method == http.MethodGet})
	if !ok {
		return
	}
	raceID, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	detail, err := s.analysisReader().GetMyRaceAnalysis(ctx, p.AccountID, raceID)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		if s.log != nil {
			s.log.Error("get race analysis", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *server) handleMyRaceAnalysisIncident(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermRaceRead, allowViewAs: r.Method == http.MethodGet})
	if !ok {
		return
	}
	raceID, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	index, ok := raceAnalysisIncidentIndex(r.PathValue("index"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	incident, err := s.analysisReader().GetMyRaceAnalysisIncident(ctx, p.AccountID, raceID, index)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		if s.log != nil {
			s.log.Error("get race analysis incident", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, incident)
}

func raceAnalysisPagination(r *http.Request) (limit, offset int, ok bool) {
	query := r.URL.Query()
	for key, values := range query {
		if key != "limit" && key != "offset" && key != "search" && key != "gameFormat" && key != "sessionType" && key != "from" && key != "before" {
			return 0, 0, false
		}
		if len(values) != 1 {
			return 0, 0, false
		}
	}
	limit = 50
	offset = 0
	if values, exists := query["limit"]; exists {
		parsed, err := strconv.Atoi(values[0])
		if err != nil || parsed < 1 || parsed > 100 {
			return 0, 0, false
		}
		limit = parsed
	}
	if values, exists := query["offset"]; exists {
		parsed, err := strconv.Atoi(values[0])
		if err != nil || parsed < 0 {
			return 0, 0, false
		}
		offset = parsed
	}
	return limit, offset, true
}

func raceAnalysisIncidentIndex(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	for _, char := range raw {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 19 {
		return 0, false
	}
	return value, true
}

const mySetupMetadataMaxBytes = 4 << 10

// handleMySetups lists the caller's private canonical setup groups. Set
// no-store before auth so a denial can never be cached as an owner response.
func (s *server) handleMySetups(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermRaceRead, allowViewAs: true})
	if !ok {
		return
	}
	setups, err := s.store.ListMySetups(ctx, p.AccountID)
	if err != nil {
		if s.log != nil {
			s.log.Error("list my setups", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, setups)
}

// handleMySetup returns one private group and its own latest setup uses.
// Authentication/permission checks intentionally precede UUID parsing so an
// under-privileged caller cannot turn malformed ids into an existence oracle.
func (s *server) handleMySetup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermRaceRead, allowViewAs: true})
	if !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	detail, err := s.store.GetMySetup(ctx, p.AccountID, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		if s.log != nil {
			s.log.Error("get my setup", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// handleUpdateMySetup fully replaces private setup metadata. Its gate includes
// the write permission and ban check; only after that gate does it parse the
// opaque UUID or inspect the request body.
func (s *server) handleUpdateMySetup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{
		scope:       platformsvc.ScopeWeb,
		blockBanned: true,
		permission:  rbac.PermRaceUpdate,
	})
	if !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	visible, err := s.store.HasMySetup(ctx, p.AccountID, id)
	if err != nil {
		if s.log != nil {
			s.log.Error("check my setup visibility", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !visible {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	body, err := decodeMySetupUpdateBody(w, r)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	result, err := s.store.UpdateMySetup(ctx, p.AccountID, id, body)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case err != nil:
		if s.log != nil {
			s.log.Error("update my setup", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, result)
	}
}

// decodeMySetupUpdateBody is intentionally stricter than the legacy upload
// decoder: metadata is a full replacement, so all three keys must be present,
// name/memo cannot be null, unknown keys and trailing JSON are rejected, and
// only rating has an explicit null clearing representation.
func decodeMySetupUpdateBody(w http.ResponseWriter, r *http.Request) (platformsvc.UpdateMySetupRequest, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, mySetupMetadataMaxBytes))
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil || len(raw) != 3 {
		return platformsvc.UpdateMySetupRequest{}, errors.New("invalid my setup metadata body")
	}
	nameRaw, nameOK := raw["name"]
	ratingRaw, ratingOK := raw["rating"]
	memoRaw, memoOK := raw["memo"]
	if !nameOK || !ratingOK || !memoOK || isJSONNull(nameRaw) || isJSONNull(memoRaw) {
		return platformsvc.UpdateMySetupRequest{}, errors.New("invalid my setup metadata fields")
	}
	var result platformsvc.UpdateMySetupRequest
	if err := json.Unmarshal(nameRaw, &result.Name); err != nil {
		return platformsvc.UpdateMySetupRequest{}, err
	}
	if err := json.Unmarshal(memoRaw, &result.Memo); err != nil {
		return platformsvc.UpdateMySetupRequest{}, err
	}
	if !isJSONNull(ratingRaw) {
		var rating int
		if err := json.Unmarshal(ratingRaw, &rating); err != nil {
			return platformsvc.UpdateMySetupRequest{}, err
		}
		result.Rating = &rating
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return platformsvc.UpdateMySetupRequest{}, errors.New("trailing my setup metadata JSON")
	}
	return result, nil
}

func isJSONNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

// handleMyListings lists the caller's own listings (active + delisted) for the
// manage strip. Web scope only; own private data → uncacheable.
func (s *server) handleMyListings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermMarketRead, allowViewAs: true})
	if !ok {
		return
	}
	listings, err := s.store.ListMyListings(ctx, p.AccountID)
	if err != nil {
		s.log.Error("my listings", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, listings)
}

// handleCreateListing creates a listing from the caller's own plausible race.
// Web scope only — an upload/device token may ingest but not sell. Touches no
// credits (economy is 3D1). The server derives the snapshot; the body carries no
// params.
func (s *server) handleCreateListing(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermMarketCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":listing", listingRatePerMin)
	if err != nil {
		s.log.Error("listing rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	var req platformsvc.CreateListingRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, listingMaxBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	id, err := s.store.CreateListing(ctx, p.AccountID, req)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "race not found", http.StatusNotFound)
		return
	case errors.Is(err, platformsvc.ErrForbidden):
		http.Error(w, "race not sellable", http.StatusUnprocessableEntity)
		return
	case errors.Is(err, platformsvc.ErrConflict):
		http.Error(w, "already listed", http.StatusConflict)
		return
	case err != nil:
		s.log.Error("create listing", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"listingId": id})
}

// handleGetListing returns a listing card, or — only to its owner — the revealed
// payload. Delisted / banned-seller / missing all collapse to 404 for non-owners
// (no listing-id probing oracle). An invalid Bearer is a 401, never a silent
// downgrade to anonymous.
func (s *server) handleGetListing(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	viewer, err := s.viewerStrict(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	card, payload, err := s.store.GetListing(ctx, id, viewer)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("get listing", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if payload != nil {
		w.Header().Set("Cache-Control", "no-store") // owner-only revealed product
		writeJSON(w, http.StatusOK, platformsvc.OwnerListing{ListingCard: *card, Owned: true, Payload: payload})
		return
	}
	// This URL is owner-dependent (owner → no-store payload above), so a shared
	// cache must key the public card on Authorization, never serve it to an owner.
	// Add (not Set) so withCORS's Vary: Origin is preserved, not overwritten.
	w.Header().Add("Vary", "Authorization")
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, card)
}

// handleSimilar returns like-kind/track/format listings for a target. Public,
// cacheable; never uses the target's content_hash.
func (s *server) handleSimilar(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	rows, err := s.store.SimilarListings(ctx, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("similar listings", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, rows)
}

// handleDelist delists the caller's own active listing. Web scope only.
func (s *server) handleDelist(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	// 현행 보존: delist는 ban 차단이 없었다 — RBAC 전환에서도 유지(기록된 후속 과제).
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermMarketUpdate})
	if !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	err := s.store.Delist(ctx, p.AccountID, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("delist", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Economy limits.
const (
	purchaseRatePerMin = 30
	reviewRatePerMin   = 15
	reviewMaxBytes     = 4 << 10
)

// handleWallet returns the caller's credit balance (provisioning the one-time
// signup grant on first read). Web scope; own private data → uncacheable.
func (s *server) handleWallet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermWalletRead, allowViewAs: true})
	if !ok {
		return
	}
	var balance int64
	initialized := true
	var err error
	if p.ViewAs {
		balance, initialized, err = s.store.PeekWallet(ctx, p.AccountID)
	} else {
		balance, err = s.store.GetWallet(ctx, p.AccountID)
	}
	if err != nil {
		s.log.Error("wallet", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Balance     int64 `json:"balance"`
		Initialized bool  `json:"initialized"`
	}{balance, initialized})
}

// handleLedger returns the caller's own ledger entries. Web scope; uncacheable.
func (s *server) handleLedger(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermWalletRead, allowViewAs: true})
	if !ok {
		return
	}
	entries, err := s.store.GetLedger(ctx, p.AccountID)
	if err != nil {
		s.log.Error("ledger", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, entries)
}

// handlePurchase settles a listing purchase (web scope, banned-checked, rate
// limited) and unlocks the payload. Idempotent: re-purchase returns the owned
// product with no second charge.
func (s *server) handlePurchase(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermPurchaseCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":purchase", purchaseRatePerMin)
	if err != nil {
		s.log.Error("purchase rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	res, err := s.store.Purchase(ctx, p.AccountID, id)
	switch {
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
		return
	case errors.Is(err, platformsvc.ErrForbidden):
		http.Error(w, "cannot buy your own listing", http.StatusUnprocessableEntity)
		return
	case errors.Is(err, platformsvc.ErrInsufficient):
		http.Error(w, "insufficient balance", http.StatusPaymentRequired)
		return
	case errors.Is(err, platformsvc.ErrConflict):
		http.Error(w, "purchase in progress", http.StatusConflict)
		return
	case err != nil:
		s.log.Error("purchase", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, res)
}

// handleListReviews returns a listing's reviews (public, cacheable).
func (s *server) handleListReviews(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	reviews, err := s.store.ListReviews(ctx, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("list reviews", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, reviews)
}

// handleCreateReview records a review, gated server-side to a settled buyer.
func (s *server) handleCreateReview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermReviewCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":review", reviewRatePerMin)
	if err != nil {
		s.log.Error("review rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var req platformsvc.CreateReviewRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, reviewMaxBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	err = s.store.CreateReview(ctx, p.AccountID, id, req)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrForbidden):
		http.Error(w, "purchase required to review", http.StatusForbidden)
		return
	case errors.Is(err, platformsvc.ErrConflict):
		http.Error(w, "already reviewed", http.StatusConflict)
		return
	case err != nil:
		s.log.Error("create review", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// Feedback limits.
const (
	feedbackRatePerMin = 5
	feedbackMaxBytes   = 16 << 10 // 2000 runes × 4B worst-case UTF-8 + JSON overhead
)

// handleCreateFeedback records a piece of free-text user feedback (bug/suggestion/other).
func (s *server) handleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermFeedbackCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":feedback", feedbackRatePerMin)
	if err != nil {
		s.log.Error("feedback rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	var req platformsvc.CreateFeedbackRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, feedbackMaxBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	id, err := s.store.SubmitFeedback(ctx, p.AccountID, req)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case err != nil:
		s.log.Error("submit feedback", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"feedbackId": id})
}

// handleMyFeedback lists the caller's own submitted feedback. Web scope only;
// own private data → uncacheable.
func (s *server) handleMyFeedback(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, permission: rbac.PermFeedbackRead, allowViewAs: true})
	if !ok {
		return
	}
	entries, err := s.store.ListMyFeedback(ctx, p.AccountID)
	if err != nil {
		s.log.Error("my feedback", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, entries)
}

// handleFeedbackInbox lists the newest feedback globally for authorized
// operators. The response is uncacheable even when auth or storage fails.
func (s *server) handleFeedbackInbox(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{
		scope:       platformsvc.ScopeWeb,
		blockBanned: true,
		permission:  rbac.PermFeedbackInboxRead,
	}); !ok {
		return
	}
	entries, err := s.store.ListFeedback(ctx)
	if err != nil {
		if s.log != nil {
			s.log.Error("feedback inbox", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// Analysis-report limits. The body cap is deliberately larger than the stored
// html cap (256 KiB, platformsvc.maxAnalysisHTMLBytes mirror): a legitimate
// document's JSON escaping (quotes/backslashes/\n/\t) can roughly double it, so
// 1 MiB keeps every valid report decodable while control-char-stuffed
// pathological payloads still die at the cap — acceptable on an admin-only
// endpoint.
const (
	analysisMaxBytes   = 1 << 20
	analysisRatePerMin = 10
)

// gateSpec declares a route's auth prologue. The zero value means
// "authenticate only" (/me, /permissions). Fields are opt-in so every route
// preserves its exact pre-RBAC scope/ban behavior — the known inconsistencies
// (e.g. delist not ban-blocked) are deliberately preserved as recorded
// follow-ups; do not "fix" them here.
type gateSpec struct {
	scope            string // platformsvc.ScopeWeb / ScopeUpload; "" = no scope check
	blockBanned      bool
	permission       string // rbac node; "" = no permission check
	allowViewAs      bool   // default deny; opt in only exact privacy-safe reads
	deniedAuditEvent string // optional route-specific denial event (start)
}

// gate runs authenticate → View As allowlist → scope → ban → permission. The
// View As decision is deliberately first after authentication, before route
// parsing, rate limits, body decoding, or domain storage. The permission check
// likewise precedes path parsing and DB access, preserving the existing uniform
// 403 behavior for under-privileged callers.
func (s *server) gate(ctx context.Context, w http.ResponseWriter, r *http.Request, spec gateSpec) (platformsvc.Principal, bool) {
	p, err := s.authenticate(ctx, r)
	if err != nil {
		if spec.deniedAuditEvent != "" && s.log != nil {
			s.log.Info(spec.deniedAuditEvent, "method", r.Method, "path", r.URL.Path)
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return platformsvc.Principal{}, false
	}
	if p.ViewAs && !spec.allowViewAs {
		w.Header().Set("Cache-Control", "no-store")
		event := spec.deniedAuditEvent
		if event == "" {
			event = "view_as.denied_read_or_mutation"
		}
		s.auditViewAsDenied(event, p, r)
		http.Error(w, "view-as is read-only", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	if p.ViewAs {
		w.Header().Set("Cache-Control", "no-store")
	}
	if spec.scope != "" && p.Scope != spec.scope {
		if spec.deniedAuditEvent != "" {
			s.auditViewAsDenied(spec.deniedAuditEvent, p, r)
		}
		msg := "web session required"
		if spec.scope == platformsvc.ScopeUpload {
			msg = "upload token required"
		}
		http.Error(w, msg, http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	if spec.blockBanned && p.Banned {
		if spec.deniedAuditEvent != "" {
			s.auditViewAsDenied(spec.deniedAuditEvent, p, r)
		}
		http.Error(w, "account banned", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	if spec.permission != "" && !rbac.HasPermission(p.Permissions, spec.permission) {
		if spec.deniedAuditEvent != "" {
			s.auditViewAsDenied(spec.deniedAuditEvent, p, r)
		}
		http.Error(w, "forbidden", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	return p, true
}

func (s *server) auditViewAsDenied(event string, p platformsvc.Principal, r *http.Request, requestedSubjectID ...string) {
	if s.log == nil {
		return
	}
	args := []any{"method", r.Method, "path", r.URL.Path}
	if p.ViewAs {
		args = append(args,
			"actor_account_id", p.ActorAccountID,
			"subject_account_id", p.AccountID,
			"view_as_session_id", p.ViewAsSessionID,
			"expires_at", p.ViewAsExpiresAt.UTC().Format(time.RFC3339),
		)
	} else if p.AccountID != "" {
		args = append(args, "actor_account_id", p.AccountID)
		if len(requestedSubjectID) > 0 {
			args = append(args, "subject_account_id", requestedSubjectID[0])
		}
	}
	s.log.Info(event, args...)
}

// handleCreateAnalysis stores one operator-authored race analysis report.
func (s *server) handleCreateAnalysis(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermAnalyzeCreate})
	if !ok {
		return
	}
	allowed, err := s.store.AllowRate(ctx, p.AccountID+":analysis", analysisRatePerMin)
	if err != nil {
		s.log.Error("analysis rate limit", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !allowed {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	var req platformsvc.CreateAnalysisRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, analysisMaxBytes)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	id, err := s.store.CreateAnalysis(ctx, p.AccountID, req)
	if errors.Is(err, platformsvc.ErrBadUpload) {
		http.Error(w, "bad upload", http.StatusBadRequest)
		return
	}
	if err != nil {
		s.log.Error("create analysis", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"analysisId": id})
}

// handleListAnalyses returns report metadata (bodies excluded), newest first.
func (s *server) handleListAnalyses(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermAnalyzeRead}); !ok {
		return
	}
	metas, err := s.store.ListAnalyses(ctx)
	if err != nil {
		s.log.Error("list analyses", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, metas)
}

// handleGetAnalysis returns one full report as JSON. The html rides inside the
// JSON body on purpose — the API never serves it as text/html, so the untrusted
// document has no execution path on this origin; rendering isolation is the
// SPA's sandboxed iframe.
func (s *server) handleGetAnalysis(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermAnalyzeRead}); !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	doc, err := s.store.GetAnalysis(ctx, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("get analysis", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, doc)
}

// handleDeleteAnalysis removes one report (POST — CORS allows GET/POST only,
// same as delist).
func (s *server) handleDeleteAnalysis(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermAnalyzeDelete}); !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	err := s.store.DeleteAnalysis(ctx, id)
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("delete analysis", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePermissions returns the caller's own effective grant nodes — raw, not
// leaf-expanded (clients must match with the shared hasPermission rule, never
// slice contains). Scope-agnostic on purpose: the sender's upload token is the
// primary consumer (advisory local gates fetched at app boot). Answers while
// banned, like /me — self-inspection is not an action route. No permission
// gate: asking "what may I do" must work for zero-role accounts.
func (s *server) handlePermissions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{allowViewAs: true})
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string][]string{"permissions": p.Permissions})
}

// RBAC management limits. One shared mutation budget across the /rbac POST
// endpoints — operator tooling, not a hot path; the limit is an abuse backstop.
const (
	rbacRatePerMin = 30
	rbacMaxBytes   = 4 << 10
)

// rbacGate is the shared prologue for management endpoints; mutating handlers
// additionally pass rate=true to draw from the shared budget.
func (s *server) rbacGate(ctx context.Context, w http.ResponseWriter, r *http.Request, permission string, rate bool) (platformsvc.Principal, bool) {
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: permission})
	if !ok {
		return platformsvc.Principal{}, false
	}
	if rate {
		allowed, err := s.store.AllowRate(ctx, p.AccountID+":rbac", rbacRatePerMin)
		if err != nil {
			s.log.Error("rbac rate limit", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return platformsvc.Principal{}, false
		}
		if !allowed {
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return platformsvc.Principal{}, false
		}
	}
	return p, true
}

// handleRBACPermissions lists the grantable permission catalog (every node,
// any depth — the admin UI/tooling picks grants from this).
func (s *server) handleRBACPermissions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACRead, false); !ok {
		return
	}
	names, err := s.store.ListPermissionNames(ctx)
	if err != nil {
		s.log.Error("rbac list permissions", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, names)
}

// handleRBACListRoles returns all roles with their grants.
func (s *server) handleRBACListRoles(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACRead, false); !ok {
		return
	}
	roles, err := s.store.ListRoles(ctx)
	if err != nil {
		s.log.Error("rbac list roles", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, roles)
}

// handleRBACCreateRole creates an empty role (grants come via the permissions
// replace endpoint).
func (s *server) handleRBACCreateRole(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACCreate, true); !ok {
		return
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, rbacMaxBytes)).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	id, err := s.store.CreateRole(ctx, body.Name, body.Description)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrDuplicate):
		http.Error(w, "role exists", http.StatusConflict)
		return
	case err != nil:
		s.log.Error("rbac create role", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"roleId": id})
}

// handleRBACDeleteRole deletes a custom role (POST — CORS allows GET/POST
// only, delist precedent). The seed roles are refused in the store.
func (s *server) handleRBACDeleteRole(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACDelete, true); !ok {
		return
	}
	name, ok := pathRoleName(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	err := s.store.DeleteRole(ctx, name)
	switch {
	case errors.Is(err, platformsvc.ErrForbidden):
		http.Error(w, "seed role protected", http.StatusForbidden)
		return
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		s.log.Error("rbac delete role", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRBACSetRolePermissions replaces a role's grants wholesale (idempotent
// set semantics — no add/remove pairs).
func (s *server) handleRBACSetRolePermissions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACUpdate, true); !ok {
		return
	}
	name, ok := pathRoleName(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var body struct {
		Permissions []string `json:"permissions"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, rbacMaxBytes)).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	err := s.store.SetRolePermissions(ctx, name, body.Permissions)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		s.log.Error("rbac set role permissions", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRBACSearchAccounts backs the management UI's account picker: accounts
// matching ?q= (persona substring, empty = first page) with their roles. Read
// path, so it takes no mutation budget. The per-account GET below stays as the
// by-id lookup for tooling that already knows the UUID.
func (s *server) handleRBACSearchAccounts(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACRead, false); !ok {
		return
	}
	accounts, err := s.store.SearchAccounts(ctx, r.URL.Query().Get("q"))
	if err != nil {
		s.log.Error("rbac search accounts", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, accounts)
}

// handleRBACGetAccountRoles returns one account's role assignments.
func (s *server) handleRBACGetAccountRoles(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACRead, false); !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	roles, err := s.store.GetAccountRoles(ctx, id)
	switch {
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		s.log.Error("rbac get account roles", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string][]string{"roles": roles})
}

// handleRBACSetAccountRoles replaces one account's role assignments wholesale.
// No last-admin self-revoke protection by design: recovery is an env-bootstrap
// restart or SQL, and a count-based guard would add a race for no real safety.
func (s *server) handleRBACSetAccountRoles(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.rbacGate(ctx, w, r, rbac.PermRBACUpdate, true); !ok {
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var body struct {
		Roles []string `json:"roles"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, rbacMaxBytes)).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	err := s.store.SetAccountRoles(ctx, id, body.Roles)
	switch {
	case errors.Is(err, platformsvc.ErrBadUpload):
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	case errors.Is(err, platformsvc.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		s.log.Error("rbac set account roles", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pathRoleName returns the {name} path value only if it is a well-formed role
// name — anything else collapses to a uniform 404 (pathUUID convention).
func pathRoleName(r *http.Request) (string, bool) {
	name := r.PathValue("name")
	if !rbac.ValidRoleName(name) {
		return "", false
	}
	return name, true
}

// viewerStrict resolves an OPTIONAL Bearer for listing detail. No Authorization
// header → anonymous (""). A present-but-invalid/expired token is a client error
// (401), never a silent downgrade to anonymous. A banned viewer keeps their id so
// they can still self-view their own listings.
func (s *server) viewerStrict(ctx context.Context, r *http.Request) (string, error) {
	if !authorizationHeaderPresent(r) {
		return "", nil
	}
	p, err := s.authenticate(ctx, r)
	if err != nil {
		return "", err
	}
	return p.AccountID, nil
}

// pathUUID returns the {id} path value only if it is a syntactically valid UUID.
// A malformed id must collapse to a uniform 404 rather than reach a UUID-typed
// query, where Postgres raises SQLSTATE 22P02 → 500 + error-log spam on the
// public (unauthenticated) listing endpoints.
func pathUUID(r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		return "", false
	}
	return id, true
}

// leaderboardParams parses the required track (int) and format (non-empty) query
// params, GET-only. track is bounded to int32 so an out-of-range value is a 400
// (via ok=false) rather than an int4 encode failure → 500 downstream.
func leaderboardParams(r *http.Request) (int, string, bool) {
	if r.Method != http.MethodGet {
		return 0, "", false
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	trackStr := strings.TrimSpace(r.URL.Query().Get("track"))
	if format == "" || trackStr == "" {
		return 0, "", false
	}
	trackID, err := strconv.ParseInt(trackStr, 10, 32)
	if err != nil {
		return 0, "", false
	}
	return int(trackID), format, true
}

// optionalViewer is anonymous only when Authorization is absent. A present
// credential is strict: invalid, expired, or revoked View As linkage is a 401,
// never a silent downgrade that could leave stale subject state in the client.
func (s *server) optionalViewer(ctx context.Context, r *http.Request) (string, error) {
	if !authorizationHeaderPresent(r) {
		return "", nil
	}
	p, err := s.authenticate(ctx, r)
	if err != nil {
		return "", err
	}
	if p.Banned {
		return "", nil
	}
	return p.AccountID, nil
}

// authenticate resolves the Bearer token to a Principal.
func (s *server) authenticate(ctx context.Context, r *http.Request) (platformsvc.Principal, error) {
	if s.authenticateForTest != nil {
		return s.authenticateForTest(ctx, r)
	}
	token := bearerToken(r)
	if token == "" {
		return platformsvc.Principal{}, platformsvc.ErrNotFound
	}
	return s.store.LookupSession(ctx, token)
}

// --- helpers ---

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}

// authorizationHeaderPresent distinguishes a truly anonymous request from a
// caller that supplied an empty or malformed credential. Optional strict
// viewers use this signal to reject the latter instead of downgrading to public
// data. Required-auth routes continue to rely on bearerToken unchanged.
func authorizationHeaderPresent(r *http.Request) bool {
	for name := range r.Header {
		if strings.EqualFold(name, "Authorization") {
			return true
		}
	}
	return false
}

func randomState() (string, error) {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func parseAllowedOrigins(raw string) map[string]struct{} {
	origins := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		if o := strings.ToLower(strings.TrimSpace(part)); o != "" {
			origins[o] = struct{}{}
		}
	}
	return origins
}

// withCORS reflects allowed origins and answers preflight. Auth is via Bearer
// (not cookies), so credentialed CORS is unnecessary; when no origins are
// configured it falls back to "*".
func withCORS(allowed map[string]struct{}, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if len(allowed) == 0 {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if _, ok := allowed[strings.ToLower(origin)]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
