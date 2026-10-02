package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"frc.engineer/internal/engineer/decision"
	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

// The decision relay lets a paired sender use the hosted decision model (Jev)
// without the key ever leaving the platform. The sender posts the same wire
// body it would send to Jev; the relay checks the RBAC grant, rate-limits per
// account, and forwards with the server key and server-chosen model.
const (
	engineerDecisionMaxBytes          = 32 << 10
	engineerDecisionMaxQuestions      = 4
	defaultEngineerDecisionTimeoutMs  = 2500
	defaultEngineerDecisionRatePerMin = 30
)

// engineerDecisionQuestions is the closed set of question ids the sender asks
// (engineer.speakQuestions + the intent question). The relay is not a
// general-purpose proxy for the server key.
var engineerDecisionQuestions = map[string]bool{"speak": true, "urgency": true, "intent": true}

var engineerDecisionGate = gateSpec{scope: platformsvc.ScopeUpload, blockBanned: true, permission: rbac.PermEngineerDecisionCreate}

type engineerDecisionRelay struct {
	client     *decision.Client
	ratePerMin int

	mu     sync.Mutex
	window time.Time
	counts map[string]int
}

// parseEngineerDecisionRelay reads the PLATFORM_ENGINEER_DECISION_* env. URL
// and key both empty means the relay is off (nil, nil); one without the other
// is a configuration error.
func parseEngineerDecisionRelay(getenv func(string) string) (*engineerDecisionRelay, error) {
	rawURL := strings.TrimSpace(getenv("PLATFORM_ENGINEER_DECISION_URL"))
	key := strings.TrimSpace(getenv("PLATFORM_ENGINEER_DECISION_API_KEY"))
	if rawURL == "" && key == "" {
		return nil, nil
	}
	if rawURL == "" || key == "" {
		return nil, errors.New("PLATFORM_ENGINEER_DECISION_URL and PLATFORM_ENGINEER_DECISION_API_KEY must be set together")
	}
	timeoutMs, err := envPositiveInt(getenv, "PLATFORM_ENGINEER_DECISION_TIMEOUT_MS", defaultEngineerDecisionTimeoutMs)
	if err != nil {
		return nil, err
	}
	rate, err := envPositiveInt(getenv, "PLATFORM_ENGINEER_DECISION_RATE_PER_MIN", defaultEngineerDecisionRatePerMin)
	if err != nil {
		return nil, err
	}
	// Mode only has to be "not off" here; the relay never interprets it.
	client, err := decision.NewClient(decision.Config{
		Mode: decision.ModeShadow, Provider: decision.ProviderCustom,
		URL: rawURL, APIKey: key, Model: strings.TrimSpace(getenv("PLATFORM_ENGINEER_DECISION_MODEL")),
		TimeoutMs: timeoutMs, AllowRemote: true,
	})
	if err != nil {
		return nil, fmt.Errorf("PLATFORM_ENGINEER_DECISION_URL: %w", err)
	}
	return &engineerDecisionRelay{client: client, ratePerMin: rate, counts: map[string]int{}}, nil
}

func envPositiveInt(getenv func(string) string, name string, def int) (int, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return n, nil
}

// allow is a fixed one-minute window per account, kept in memory: the relay
// runs on every released call, too hot for the DB-backed AllowRate.
func (r *engineerDecisionRelay) allow(accountID string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if minute := now.Truncate(time.Minute); !minute.Equal(r.window) {
		r.window = minute
		clear(r.counts)
	}
	if r.counts[accountID] >= r.ratePerMin {
		return false
	}
	r.counts[accountID]++
	return true
}

func registerEngineerDecisionRoutes(mux *http.ServeMux, s *server) {
	mux.HandleFunc("GET /engineer/decision/config", s.handleEngineerDecisionConfig)
	mux.HandleFunc("POST /engineer/decision", s.handleEngineerDecision)
}

// handleEngineerDecisionConfig tells a granted sender whether the relay is
// configured, so it does not send requests that can only fail.
func (s *server) handleEngineerDecisionConfig(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	w.Header().Set("Cache-Control", "no-store")
	if _, ok := s.gate(ctx, w, r, engineerDecisionGate); !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"available": s.engineerDecision != nil})
}

type engineerDecisionRequest struct {
	State     json.RawMessage              `json:"state"`
	Questions map[string]decision.Question `json:"questions"`
}

func (req engineerDecisionRequest) valid() bool {
	if !bytes.HasPrefix(bytes.TrimSpace(req.State), []byte("{")) {
		return false
	}
	if len(req.Questions) == 0 || len(req.Questions) > engineerDecisionMaxQuestions {
		return false
	}
	for id, q := range req.Questions {
		switch q.Type {
		case "choice", "score", "noul":
		default:
			return false
		}
		if !engineerDecisionQuestions[id] || q.Instructions == "" {
			return false
		}
	}
	return true
}

// handleEngineerDecision forwards one decision request with the server key.
// The client's model field is ignored; the server picks the model.
func (s *server) handleEngineerDecision(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	w.Header().Set("Cache-Control", "no-store")
	p, ok := s.gate(ctx, w, r, engineerDecisionGate)
	if !ok {
		return
	}
	relay := s.engineerDecision
	if relay == nil {
		http.Error(w, "decision relay not configured", http.StatusServiceUnavailable)
		return
	}
	if !relay.allow(p.AccountID, time.Now()) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	var req engineerDecisionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, engineerDecisionMaxBytes)).Decode(&req); err != nil || !req.valid() {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	resp, err := relay.client.Ask(ctx, req.State, req.Questions)
	if err != nil {
		var netErr net.Error
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
			status = http.StatusGatewayTimeout
		}
		if s.log != nil {
			s.log.Warn("engineer decision upstream", "accountId", p.AccountID, "status", status, "error", err)
		}
		http.Error(w, "decision model unavailable", status)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
