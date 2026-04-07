package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"frc.engineer/internal/telemetry"
)

// StrategySSEHub serves Server-Sent Events for the strategy overlay.
type StrategySSEHub struct {
	pm        *telemetry.PitwallManager
	getConfig func(trackID int8) trackStrategyConfig
}

func newStrategySSEHub(pm *telemetry.PitwallManager, getConfig func(int8) trackStrategyConfig) *StrategySSEHub {
	return &StrategySSEHub{pm: pm, getConfig: getConfig}
}

func (h *StrategySSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			trackID := h.pm.CurrentTrackID()
			cfg := h.getConfig(trackID)
			data := h.pm.BuildStrategyOverlayData(cfg.PitTimeLossMs, cfg.UndercutDifficulty)
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
