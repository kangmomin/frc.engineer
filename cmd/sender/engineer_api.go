package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"frc.engineer/internal/engineer"
)

const engineerSSEHeartbeat = 15 * time.Second

// engineerAPI serves the virtual engineer's local HTTP endpoints. Routes are
// registered in main.go (route patterns must stay string literals there).
type engineerAPI struct {
	eng *engineer.Engine
	// persist stores settings in sender-config.json. It runs after the engine
	// accepted them.
	persist func(engineer.Settings) error
}

// engineerSettingsView never contains the API key, only whether one is set.
type engineerSettingsView struct {
	Settings  engineer.Settings `json:"settings"`
	HasAPIKey bool              `json:"hasApiKey"`
	Status    engineer.Status   `json:"status"`
}

func (a *engineerAPI) view() engineerSettingsView {
	s := a.eng.Settings()
	hasKey := s.Decision.APIKey != ""
	s.Decision.APIKey = ""
	return engineerSettingsView{Settings: s, HasAPIKey: hasKey, Status: a.eng.Status()}
}

func writeEngineerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *engineerAPI) getSettings(w http.ResponseWriter, _ *http.Request) {
	writeEngineerJSON(w, http.StatusOK, a.view())
}

// putSettings replaces the settings. An empty decision.apiKey keeps the
// stored key; clearApiKey removes it.
func (a *engineerAPI) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		engineer.Settings
		ClearAPIKey bool `json:"clearApiKey"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEngineerJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	next := body.Settings
	current := a.eng.Settings()
	switch {
	case body.ClearAPIKey:
		next.Decision.APIKey = ""
	case next.Decision.APIKey == "":
		next.Decision.APIKey = current.Decision.APIKey
	}
	if err := a.eng.SetSettings(next); err != nil {
		writeEngineerJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if a.persist != nil {
		if err := a.persist(a.eng.Settings()); err != nil {
			writeEngineerJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save settings"})
			return
		}
	}
	writeEngineerJSON(w, http.StatusOK, a.view())
}

func (a *engineerAPI) recent(w http.ResponseWriter, _ *http.Request) {
	writeEngineerJSON(w, http.StatusOK, map[string]any{"calls": a.eng.Recent(), "active": a.eng.Active()})
}

func (a *engineerAPI) decisions(w http.ResponseWriter, _ *http.Request) {
	writeEngineerJSON(w, http.StatusOK, map[string]any{"decisions": a.eng.Decisions(), "status": a.eng.Status()})
}

func (a *engineerAPI) briefing(w http.ResponseWriter, _ *http.Request) {
	writeEngineerJSON(w, http.StatusOK, a.eng.Briefing("api"))
}

func (a *engineerAPI) repeat(w http.ResponseWriter, _ *http.Request) {
	call, ok := a.eng.Repeat()
	if !ok {
		writeEngineerJSON(w, http.StatusNotFound, map[string]string{"error": "nothing to repeat"})
		return
	}
	writeEngineerJSON(w, http.StatusOK, call)
}

func (a *engineerAPI) test(w http.ResponseWriter, _ *http.Request) {
	writeEngineerJSON(w, http.StatusOK, a.eng.Test())
}

func (a *engineerAPI) ask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Question string `json:"question"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Question == "" {
		writeEngineerJSON(w, http.StatusBadRequest, map[string]string{"error": "question is required"})
		return
	}
	writeEngineerJSON(w, http.StatusOK, a.eng.Ask(r.Context(), body.Question))
}

// stream is an SSE feed of released calls. The engine closes subscriptions
// when the sender stops, so this handler never delays shutdown.
func (a *engineerAPI) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	rc := http.NewResponseController(w)
	calls, cancel := a.eng.Subscribe()
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	send := func(event string, v any) bool {
		payload, err := json.Marshal(v)
		if err != nil {
			return true
		}
		if err := rc.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	s := a.eng.Settings()
	if !send("hello", map[string]any{"language": s.Language, "enabled": s.Enabled, "active": a.eng.Active()}) {
		return
	}
	heartbeat := time.NewTicker(engineerSSEHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case c, ok := <-calls:
			if !ok || !send("call", c) {
				return
			}
		case <-heartbeat.C:
			if err := rc.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
				return
			}
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
