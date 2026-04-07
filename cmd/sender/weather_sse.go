package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"frc.engineer/internal/telemetry"
)

// WeatherSSEHub serves Server-Sent Events for the local weather forecast overlay.
type WeatherSSEHub struct {
	pm *telemetry.PitwallManager
}

func newWeatherSSEHub(pm *telemetry.PitwallManager) *WeatherSSEHub {
	return &WeatherSSEHub{pm: pm}
}

func (h *WeatherSSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	ticker := time.NewTicker(1 * time.Second) // 1 Hz — weather changes slowly
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			data := h.pm.BuildWeatherData()
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
