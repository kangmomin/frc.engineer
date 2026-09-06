package main

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"frc.engineer/internal/races"
)

func latestRaceHandler(current func() *races.RaceSummary, storage func() *races.FileStorage, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if summary := current(); summary != nil {
			json.NewEncoder(w).Encode(races.ProjectResult(summary))
			return
		}
		var result *races.ResultSummary
		if rs := storage(); rs != nil {
			list, err := rs.List()
			if err == nil && len(list) > 0 {
				result, err = rs.LoadResult(list[0].ID)
			}
			if err != nil {
				logger.Error("failed to load latest race result", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]string{"error": "failed to load race summary"})
				return
			}
		}
		if result == nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "race summary not found"})
			return
		}
		json.NewEncoder(w).Encode(result)
	}
}
