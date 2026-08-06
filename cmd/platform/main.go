// Command platform is the hosted Pitwall Cloud backend: Steam accounts and
// sessions, telemetry ingestion, cross-user leaderboards, a setup/strategy
// marketplace, a closed-loop virtual credit economy, and reviews. It reuses the
// cmd/signaling operational shape (PORT-driven, Postgres via DATABASE_URL,
// ALLOWED_ORIGINS CORS, signal-based graceful shutdown) but, unlike signaling's
// optional ban DB, Postgres is mandatory here — the platform is nothing without
// it, so a missing/failing DATABASE_URL is a hard boot failure.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"

	"frc.engineer/internal/platformsvc"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

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

	srv := &server{store: store, steam: steam, log: logger, frontendURL: frontendURL, secureCookies: secureCookies,
		adminIDs: parseAdminAccountIDs(os.Getenv("PLATFORM_ADMIN_ACCOUNT_IDS"), logger)}

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
	mux.HandleFunc("/me", srv.handleMe)
	mux.HandleFunc("/device/pair", srv.handlePair)
	mux.HandleFunc("/device/exchange", srv.handleExchange)
	mux.HandleFunc("/races", srv.handleUpload)
	mux.HandleFunc("/leaderboards/tt", srv.handleLeaderboardTT)
	mux.HandleFunc("/leaderboards/pace", srv.handleLeaderboardPace)
	mux.HandleFunc("GET /tracks/{id}/pit-loss", srv.handlePitLoss)
	mux.HandleFunc("GET /me/races", srv.handleMyRaces)
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
	mux.HandleFunc("POST /analysis", srv.handleCreateAnalysis)
	mux.HandleFunc("GET /analysis", srv.handleListAnalyses)
	mux.HandleFunc("GET /analysis/{id}", srv.handleGetAnalysis)
	mux.HandleFunc("POST /analysis/{id}/delete", srv.handleDeleteAnalysis)

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
	store         *platformsvc.Store
	steam         *platformsvc.SteamAuth
	log           *slog.Logger
	frontendURL   string
	secureCookies bool
	// adminIDs gates the analysis-report endpoints (PLATFORM_ADMIN_ACCOUNT_IDS).
	// env 기반인 이유: accounts.kind는 경제 시스템 계정 모델(싱글턴 강제)이라 확장
	// 불가하고, 단일 운영자 전제에선 ALLOWED_ORIGINS와 같은 운영 모델이 맞다.
	// 추후 공개/참가자 공유로 완화할 때는 이 게이트만 제거하면 된다.
	adminIDs map[string]struct{}
}

// isAdmin reports whether the account is an operator. Unknown/empty env means
// nobody is — fail-closed.
func (s *server) isAdmin(accountID string) bool {
	_, ok := s.adminIDs[strings.ToLower(accountID)]
	return ok
}

// parseAdminAccountIDs parses the comma-separated operator UUID allowlist.
// 오타 항목은 warn+skip — 운영자 env 실수로 플랫폼 전체가 죽으면 안 된다.
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
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	account, err := s.store.GetAccount(ctx, p.AccountID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// admin은 순수 additive 필드 — 기존 클라이언트는 미지 키로 무시한다.
	writeJSON(w, http.StatusOK, struct {
		*platformsvc.Account
		Admin bool `json:"admin"`
	}{account, s.isAdmin(p.AccountID)})
}

// handlePair mints a device pairing code for the logged-in (web) account.
func (s *server) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeUpload {
		http.Error(w, "upload token required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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

// handleLeaderboardTT serves the Time Trial leaderboard (public; optional Bearer
// for you-highlight).
func (s *server) handleLeaderboardTT(w http.ResponseWriter, r *http.Request) {
	trackID, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rows, err := s.store.TimeTrialLeaderboard(ctx, trackID, format, s.optionalViewer(ctx, r))
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
	trackID, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rows, err := s.store.PaceLeaderboard(ctx, trackID, format, s.optionalViewer(ctx, r))
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
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

// handleMyListings lists the caller's own listings (active + delisted) for the
// manage strip. Web scope only; own private data → uncacheable.
func (s *server) handleMyListings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	id, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	err = s.store.Delist(ctx, p.AccountID, id)
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
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
		return
	}
	balance, err := s.store.GetWallet(ctx, p.AccountID)
	if err != nil {
		s.log.Error("wallet", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]int64{"balance": balance})
}

// handleLedger returns the caller's own ledger entries. Web scope; uncacheable.
func (s *server) handleLedger(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
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
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
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

// adminGate runs the shared auth prologue for the analysis endpoints:
// authenticate → web scope → ban → operator allowlist. The admin check comes
// before any path parsing or DB access so non-admins get a uniform 403 with no
// existence oracle.
func (s *server) adminGate(ctx context.Context, w http.ResponseWriter, r *http.Request) (platformsvc.Principal, bool) {
	p, err := s.authenticate(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return platformsvc.Principal{}, false
	}
	if p.Scope != platformsvc.ScopeWeb {
		http.Error(w, "web session required", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	if p.Banned {
		http.Error(w, "account banned", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	if !s.isAdmin(p.AccountID) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return platformsvc.Principal{}, false
	}
	return p, true
}

// handleCreateAnalysis stores one operator-authored race analysis report.
func (s *server) handleCreateAnalysis(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	p, ok := s.adminGate(ctx, w, r)
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
	if _, ok := s.adminGate(ctx, w, r); !ok {
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
	if _, ok := s.adminGate(ctx, w, r); !ok {
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
	if _, ok := s.adminGate(ctx, w, r); !ok {
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

// viewerStrict resolves an OPTIONAL Bearer for listing detail. No Authorization
// header → anonymous (""). A present-but-invalid/expired token is a client error
// (401), never a silent downgrade to anonymous. A banned viewer keeps their id so
// they can still self-view their own listings.
func (s *server) viewerStrict(ctx context.Context, r *http.Request) (string, error) {
	if bearerToken(r) == "" {
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

// optionalViewer resolves a Bearer token to an account id for you-highlighting.
// Absent/invalid/expired → "" (anonymous). Banned viewers get no highlight.
func (s *server) optionalViewer(ctx context.Context, r *http.Request) string {
	p, err := s.authenticate(ctx, r)
	if err != nil || p.Banned {
		return ""
	}
	return p.AccountID
}

// authenticate resolves the Bearer token to a Principal.
func (s *server) authenticate(ctx context.Context, r *http.Request) (platformsvc.Principal, error) {
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
