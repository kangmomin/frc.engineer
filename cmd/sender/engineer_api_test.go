package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/engineer"
	"frc.engineer/internal/engineer/decision"
)

func newRadioTestServer(t *testing.T) (*httptest.Server, *engineer.Engine, *[]engineer.Settings, context.CancelFunc) {
	t.Helper()
	eng := engineer.New(engineer.Config{}, engineer.DefaultSettings())
	ctx, cancel := context.WithCancel(context.Background())
	go eng.Run(ctx)
	var saved []engineer.Settings
	api := &engineerAPI{eng: eng, persist: func(s engineer.Settings) error { saved = append(saved, s); return nil }}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/radio/settings", api.getSettings)
	mux.HandleFunc("PUT /api/radio/settings", api.putSettings)
	mux.HandleFunc("POST /api/radio/ask", api.ask)
	mux.HandleFunc("POST /api/radio/test", api.test)
	mux.HandleFunc("GET /api/radio/stream", api.stream)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, eng, &saved, cancel
}

func putRadioSettings(t *testing.T, url, body string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, url+"/api/radio/settings", strings.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestRadioSettingsNeverEchoKeyAndKeepItWhenOmitted(t *testing.T) {
	srv, eng, saved, _ := newRadioTestServer(t)
	code, out := putRadioSettings(t, srv.URL, `{"enabled":true,"language":"en","decision":{"mode":"shadow","url":"http://127.0.0.1:8000","apiKey":"secret-1"}}`)
	if code != http.StatusOK || out["hasApiKey"] != true || strings.Contains(mustJSON(out), "secret-1") {
		t.Fatalf("key echoed or not stored: %d %v", code, out)
	}
	code, _ = putRadioSettings(t, srv.URL, `{"enabled":true,"language":"ko","decision":{"mode":"shadow","url":"http://127.0.0.1:8000"}}`)
	if code != http.StatusOK || eng.Settings().Decision.APIKey != "secret-1" || eng.Settings().Language != "ko" {
		t.Fatalf("omitted key cleared: %+v", eng.Settings().Decision)
	}
	putRadioSettings(t, srv.URL, `{"enabled":true,"clearApiKey":true,"decision":{"mode":"off"}}`)
	if eng.Settings().Decision.APIKey != "" {
		t.Fatal("clearApiKey ignored")
	}
	if len(*saved) != 3 {
		t.Fatalf("settings not persisted: %d", len(*saved))
	}
	code, out = putRadioSettings(t, srv.URL, `{"enabled":true,"decision":{"mode":"enforce","url":"http://api.typesafe.ai"}}`)
	if code != http.StatusBadRequest || out["error"] == nil {
		t.Fatalf("unsafe remote model accepted: %d %v", code, out)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestRadioAskAndStream(t *testing.T) {
	srv, _, _, _ := newRadioTestServer(t)
	resp, err := http.Get(srv.URL + "/api/radio/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	lines := make(chan string, 32)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	waitEvent := func(name string) string {
		deadline := time.After(3 * time.Second)
		event := ""
		for {
			select {
			case l, ok := <-lines:
				if !ok {
					t.Fatalf("stream closed before %s", name)
				}
				if strings.HasPrefix(l, "event: ") {
					event = strings.TrimPrefix(l, "event: ")
				}
				if strings.HasPrefix(l, "data: ") && event == name {
					return strings.TrimPrefix(l, "data: ")
				}
			case <-deadline:
				t.Fatalf("no %s event", name)
			}
		}
	}
	waitEvent("hello")

	ask, err := http.Post(srv.URL+"/api/radio/ask", "application/json", strings.NewReader(`{"question":"연료 어때?"}`))
	if err != nil {
		t.Fatal(err)
	}
	var answer engineer.Answer
	_ = json.NewDecoder(ask.Body).Decode(&answer)
	ask.Body.Close()
	if answer.Intent != engineer.IntentFuel || answer.Text == "" {
		t.Fatalf("answer: %+v", answer)
	}
	if data := waitEvent("call"); !strings.Contains(data, answer.Text) {
		t.Fatalf("answer not streamed: %s", data)
	}
	bad, _ := http.Post(srv.URL+"/api/radio/ask", "application/json", strings.NewReader(`{}`))
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty question status %d", bad.StatusCode)
	}
	bad.Body.Close()
}

func TestFetchDecisionRelayConfig(t *testing.T) {
	available := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/engineer/decision/config" || r.Header.Get("Authorization") != "Bearer device" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"available": available})
	}))
	defer srv.Close()
	if ok, status, err := fetchDecisionRelayConfig(context.Background(), srv.URL, "device"); !ok || status != 200 || err != nil {
		t.Fatalf("available: %v %d %v", ok, status, err)
	}
	available = false
	if ok, _, err := fetchDecisionRelayConfig(context.Background(), srv.URL, "device"); ok || err != nil {
		t.Fatalf("unavailable: %v %v", ok, err)
	}
	if _, status, err := fetchDecisionRelayConfig(context.Background(), srv.URL, "other"); status != http.StatusForbidden || err == nil {
		t.Fatalf("forbidden: %d %v", status, err)
	}
}

func TestRadioSettingsReportPlatformRelayStatus(t *testing.T) {
	srv, eng, _, _ := newRadioTestServer(t)
	eng.SetRelay(decision.Relay{}, decisionRelayChecking)
	resp, err := http.Get(srv.URL + "/api/radio/settings")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var view engineerSettingsView
	if err := json.NewDecoder(resp.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	if view.Settings.Decision.Provider != "platform" || view.Status.DecisionProvider != "platform" ||
		view.Status.DecisionUnavailable != decisionRelayChecking || view.Status.DecisionReady {
		t.Fatalf("view: %+v", view)
	}
}
