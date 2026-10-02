package decision

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidatePrivacyPolicy(t *testing.T) {
	for _, tc := range []struct {
		cfg Config
		ok  bool
	}{
		{Config{Mode: ModeShadow, URL: "http://127.0.0.1:8000"}, true},
		{Config{Mode: ModeShadow, URL: "http://localhost:8000"}, true},
		{Config{Mode: ModeShadow, URL: "http://192.168.0.5:8000"}, true},
		{Config{Mode: ModeShadow, URL: "https://api.typesafe.ai"}, false},
		{Config{Mode: ModeShadow, URL: "https://api.typesafe.ai", AllowRemote: true}, true},
		{Config{Mode: ModeShadow, URL: "http://api.typesafe.ai", AllowRemote: true}, false},
		{Config{Mode: ModeShadow, URL: "https://user:pw@api.typesafe.ai", AllowRemote: true}, false},
		{Config{Mode: ModeShadow, URL: "ftp://127.0.0.1"}, false},
		{Config{Mode: ModeShadow, Provider: ProviderCustom, URL: ""}, false},
		{Config{Mode: ModeShadow, Provider: ProviderPlatform}, true},
		{Config{Mode: ModeOff, URL: "garbage"}, true},
	} {
		if err := tc.cfg.Normalize().Validate(); (err == nil) != tc.ok {
			t.Errorf("%+v: err=%v want ok=%v", tc.cfg, err, tc.ok)
		}
	}
}

func TestNormalizeDefaults(t *testing.T) {
	c := Config{Mode: "bogus", TimeoutMs: 5, SpeakThreshold: 3}.Normalize()
	if c.Mode != ModeOff || c.TimeoutMs != minTimeoutMs || c.SpeakThreshold != defaultThreshold {
		t.Fatalf("normalize: %+v", c)
	}
	if c := (Config{}).Normalize(); c.TimeoutMs != defaultTimeoutMs {
		t.Fatalf("default timeout: %+v", c)
	}
}

func TestAskWireProtocol(t *testing.T) {
	var got Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer k1" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"model":"laya","answers":{"speak":{"type":"noul","noul":0.8},"why":{"type":"choice","choice":"b","probabilities":{"a":0.2,"b":0.8}}}}`))
	}))
	defer srv.Close()
	c, err := NewClient(Config{Mode: ModeShadow, URL: srv.URL, APIKey: "k1", Model: "m"})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := c.Ask(context.Background(), map[string]any{"x": 1}, map[string]Question{
		"speak": {Type: "noul", Instructions: "speak?"},
		"why":   {Type: "choice", Instructions: "why?", Criteria: map[string]string{"a": "A", "b": "B"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Model != "m" || got.Questions["speak"].Type != "noul" {
		t.Fatalf("request body: %+v", got)
	}
	if n := resp.Answers["speak"].Noul; n == nil || *n != 0.8 {
		t.Fatalf("noul: %+v", resp.Answers)
	}
	if label, p := resp.Answers["why"].TopLabel(); label != "b" || p != 0.8 {
		t.Fatalf("top label %s %v", label, p)
	}
	// Missing answers are an error, so callers fail open.
	if _, err := c.Ask(context.Background(), "s", map[string]Question{"other": {Type: "noul", Instructions: "?"}}); err == nil {
		t.Fatal("missing answer accepted")
	}
}

func TestAskDoesNotFollowRedirects(t *testing.T) {
	hit := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer target.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/v1/systemone", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	c, err := NewClient(Config{Mode: ModeShadow, URL: srv.URL, APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Ask(context.Background(), "s", map[string]Question{"q": {Type: "noul", Instructions: "?"}}); err == nil || hit {
		t.Fatalf("redirect followed: err=%v hit=%v", err, hit)
	}
}

func TestNewClientDisabled(t *testing.T) {
	if _, err := NewClient(Config{Mode: ModeOff, URL: "http://127.0.0.1"}); err != ErrDisabled {
		t.Fatalf("want ErrDisabled, got %v", err)
	}
}

func TestNormalizeInfersProviderFromLegacySettings(t *testing.T) {
	if c := (Config{Mode: ModeShadow, URL: "http://127.0.0.1:8000"}).Normalize(); c.Provider != ProviderCustom {
		t.Fatalf("legacy endpoint must stay custom: %+v", c)
	}
	if c := (Config{Mode: ModeOff}).Normalize(); c.Provider != ProviderPlatform || c.Mode != ModeOff {
		t.Fatalf("legacy empty config: %+v", c)
	}
}

func TestPlatformClientUsesRelayAndDeviceToken(t *testing.T) {
	var got Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api"+RelayPath || r.Header.Get("Authorization") != "Bearer device-token" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"model":"jev","answers":{"speak":{"type":"noul","noul":0.4}}}`))
	}))
	defer srv.Close()
	cfg := Config{Mode: ModeShadow, Provider: ProviderPlatform, URL: "http://ignored", APIKey: "user-key", Model: "user-model"}
	c, err := NewPlatformClient(cfg, Relay{BaseURL: srv.URL + "/api/", Token: "device-token"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Ask(context.Background(), "s", map[string]Question{"speak": {Type: "noul", Instructions: "?"}}); err != nil {
		t.Fatal(err)
	}
	if got.Model != "" {
		t.Fatalf("platform client must let the server pick the model: %+v", got)
	}
}

func TestPlatformClientRequirements(t *testing.T) {
	cfg := Config{Mode: ModeShadow, Provider: ProviderPlatform}
	for _, tc := range []struct {
		relay Relay
		ok    bool
	}{
		{Relay{BaseURL: "https://api.frc.engineer", Token: "t"}, true},
		{Relay{BaseURL: "http://127.0.0.1:8090", Token: "t"}, true},
		{Relay{BaseURL: "http://api.frc.engineer", Token: "t"}, false},
		{Relay{BaseURL: "https://api.frc.engineer"}, false},
		{Relay{BaseURL: "https://u:p@api.frc.engineer", Token: "t"}, false},
	} {
		if _, err := NewPlatformClient(cfg, tc.relay); (err == nil) != tc.ok {
			t.Errorf("%+v: err=%v want ok=%v", tc.relay, err, tc.ok)
		}
	}
	if _, err := NewPlatformClient(Config{Mode: ModeOff, Provider: ProviderPlatform}, Relay{BaseURL: "https://a.b", Token: "t"}); err != ErrDisabled {
		t.Fatalf("off mode: %v", err)
	}
	if _, err := NewClient(cfg); err != ErrDisabled {
		t.Fatalf("custom constructor must ignore the platform provider: %v", err)
	}
}
