package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/engineer/decision"
	"frc.engineer/internal/platformsvc"
)

const engineerDecisionBody = `{"state":{"message":{"text":"box this lap"}},"questions":{"speak":{"type":"noul","instructions":"speak?"}},"model":"user-model"}`

func engineerDecisionHTTP(s *server) func(string, string, string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	registerEngineerDecisionRoutes(mux, s)
	return func(method, target, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
}

func engineerDecisionPrincipal(scope string, perms ...string) func(context.Context, *http.Request) (platformsvc.Principal, error) {
	return func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return platformsvc.Principal{AccountID: "driver", Scope: scope, Permissions: perms}, nil
	}
}

func testEngineerDecisionRelay(t *testing.T, upstream string, rate string) *engineerDecisionRelay {
	t.Helper()
	env := map[string]string{
		"PLATFORM_ENGINEER_DECISION_URL":          upstream,
		"PLATFORM_ENGINEER_DECISION_API_KEY":      "server-key",
		"PLATFORM_ENGINEER_DECISION_MODEL":        "jev-1",
		"PLATFORM_ENGINEER_DECISION_RATE_PER_MIN": rate,
	}
	relay, err := parseEngineerDecisionRelay(func(k string) string { return env[k] })
	if err != nil || relay == nil {
		t.Fatalf("relay: %v %v", relay, err)
	}
	return relay
}

func TestEngineerDecisionRelayForwardsWithServerKey(t *testing.T) {
	var got decision.Request
	var auth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"model":"jev-1","answers":{"speak":{"type":"noul","noul":0.7}}}`))
	}))
	defer upstream.Close()
	s := &server{engineerDecision: testEngineerDecisionRelay(t, upstream.URL, ""),
		authenticateForTest: engineerDecisionPrincipal(platformsvc.ScopeUpload, "sender.engineer-decision")}
	w := engineerDecisionHTTP(s)("POST", "/engineer/decision", engineerDecisionBody)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	var resp decision.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Answers["speak"].Noul == nil {
		t.Fatalf("response: %s %v", w.Body.String(), err)
	}
	if auth != "Bearer server-key" || got.Model != "jev-1" || got.Questions["speak"].Type != "noul" {
		t.Fatalf("upstream request: auth=%q body=%+v", auth, got)
	}
	if state, _ := json.Marshal(got.State); string(state) != `{"message":{"text":"box this lap"}}` {
		t.Fatalf("state not forwarded verbatim: %s", state)
	}
	if strings.Contains(w.Body.String(), "server-key") {
		t.Fatal("server key leaked into the response")
	}
}

func TestEngineerDecisionRelayGate(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("gated request reached the model")
	}))
	defer upstream.Close()
	relay := testEngineerDecisionRelay(t, upstream.URL, "")
	for name, auth := range map[string]func(context.Context, *http.Request) (platformsvc.Principal, error){
		"no grant":      engineerDecisionPrincipal(platformsvc.ScopeUpload, "sender.setup.read"),
		"web session":   engineerDecisionPrincipal(platformsvc.ScopeWeb, "sender"),
		"sibling scope": engineerDecisionPrincipal(platformsvc.ScopeUpload, "sender.engineer"),
	} {
		s := &server{engineerDecision: relay, authenticateForTest: auth}
		for _, target := range []string{"/engineer/decision", "/engineer/decision/config"} {
			method := "POST"
			if strings.HasSuffix(target, "config") {
				method = "GET"
			}
			if w := engineerDecisionHTTP(s)(method, target, engineerDecisionBody); w.Code != http.StatusForbidden {
				t.Errorf("%s %s: status %d", name, target, w.Code)
			}
		}
	}
	banned := &server{engineerDecision: relay, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return platformsvc.Principal{AccountID: "driver", Scope: platformsvc.ScopeUpload, Banned: true, Permissions: []string{"sender"}}, nil
	}}
	if w := engineerDecisionHTTP(banned)("POST", "/engineer/decision", engineerDecisionBody); w.Code != http.StatusForbidden {
		t.Errorf("banned: status %d", w.Code)
	}
}

func TestEngineerDecisionRelayAvailabilityAndValidation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"answers":{"speak":{"type":"noul","noul":0.7}}}`))
	}))
	defer upstream.Close()
	granted := engineerDecisionPrincipal(platformsvc.ScopeUpload, "sender")

	off := &server{authenticateForTest: granted}
	if w := engineerDecisionHTTP(off)("GET", "/engineer/decision/config", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"available":false`) {
		t.Fatalf("config off: %d %s", w.Code, w.Body.String())
	}
	if w := engineerDecisionHTTP(off)("POST", "/engineer/decision", engineerDecisionBody); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured relay: %d", w.Code)
	}

	on := &server{engineerDecision: testEngineerDecisionRelay(t, upstream.URL, "100"), authenticateForTest: granted}
	if w := engineerDecisionHTTP(on)("GET", "/engineer/decision/config", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"available":true`) {
		t.Fatalf("config on: %d %s", w.Code, w.Body.String())
	}
	for name, body := range map[string]string{
		"unknown question": `{"state":{},"questions":{"anything":{"type":"noul","instructions":"?"}}}`,
		"bad type":         `{"state":{},"questions":{"speak":{"type":"essay","instructions":"?"}}}`,
		"no questions":     `{"state":{},"questions":{}}`,
		"non-object state": `{"state":"hi","questions":{"speak":{"type":"noul","instructions":"?"}}}`,
		"empty prompt":     `{"state":{},"questions":{"speak":{"type":"noul","instructions":""}}}`,
		"too large":        `{"state":{"x":"` + strings.Repeat("a", engineerDecisionMaxBytes) + `"},"questions":{"speak":{"type":"noul","instructions":"?"}}}`,
	} {
		if w := engineerDecisionHTTP(on)("POST", "/engineer/decision", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d", name, w.Code)
		}
	}
}

func TestEngineerDecisionRelayRateLimitAndUpstreamErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusInternalServerError)
	}))
	defer upstream.Close()
	s := &server{engineerDecision: testEngineerDecisionRelay(t, upstream.URL, "2"),
		authenticateForTest: engineerDecisionPrincipal(platformsvc.ScopeUpload, "sender.engineer-decision.create")}
	call := engineerDecisionHTTP(s)
	for i := 0; i < 2; i++ {
		if w := call("POST", "/engineer/decision", engineerDecisionBody); w.Code != http.StatusBadGateway {
			t.Fatalf("upstream failure %d: status %d", i, w.Code)
		}
	}
	if w := call("POST", "/engineer/decision", engineerDecisionBody); w.Code != http.StatusTooManyRequests {
		t.Fatalf("rate limit: status %d", w.Code)
	}
	relay := s.engineerDecision
	if !relay.allow("other-driver", time.Now()) {
		t.Fatal("rate limit is not per account")
	}
	if !relay.allow("driver", time.Now().Add(time.Minute)) {
		t.Fatal("rate window never resets")
	}
}

func TestParseEngineerDecisionRelay(t *testing.T) {
	for name, tc := range map[string]struct {
		env map[string]string
		on  bool
		err bool
	}{
		"unset":       {env: map[string]string{}},
		"url only":    {env: map[string]string{"PLATFORM_ENGINEER_DECISION_URL": "https://api.example.com"}, err: true},
		"key only":    {env: map[string]string{"PLATFORM_ENGINEER_DECISION_API_KEY": "k"}, err: true},
		"remote http": {env: map[string]string{"PLATFORM_ENGINEER_DECISION_URL": "http://api.example.com", "PLATFORM_ENGINEER_DECISION_API_KEY": "k"}, err: true},
		"bad rate": {env: map[string]string{"PLATFORM_ENGINEER_DECISION_URL": "https://api.example.com", "PLATFORM_ENGINEER_DECISION_API_KEY": "k",
			"PLATFORM_ENGINEER_DECISION_RATE_PER_MIN": "0"}, err: true},
		"https": {env: map[string]string{"PLATFORM_ENGINEER_DECISION_URL": "https://api.example.com", "PLATFORM_ENGINEER_DECISION_API_KEY": "k"}, on: true},
	} {
		relay, err := parseEngineerDecisionRelay(func(k string) string { return tc.env[k] })
		if (err != nil) != tc.err || (relay != nil) != tc.on {
			t.Errorf("%s: relay=%v err=%v", name, relay != nil, err)
		}
	}
}
