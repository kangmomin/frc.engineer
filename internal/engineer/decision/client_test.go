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
		{Config{Mode: ModeShadow, URL: ""}, false},
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
