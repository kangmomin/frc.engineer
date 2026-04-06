package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"frc.engineer/internal/telemetry"
)

// RadarSSEHub serves Server-Sent Events for the local radar overlay.
// Each connection runs its own ticker — no shared broadcast goroutine needed.
type RadarSSEHub struct {
	pm *telemetry.PitwallManager
}

func newRadarSSEHub(pm *telemetry.PitwallManager) *RadarSSEHub {
	return &RadarSSEHub{pm: pm}
}

func (h *RadarSSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	ticker := time.NewTicker(33 * time.Millisecond) // ~30 Hz
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			data := h.pm.BuildRadarData()
			if data == nil {
				continue
			}
			payload, err := json.Marshal(data)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
