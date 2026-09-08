package main

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"frc.engineer/internal/platformsvc"
)

func (s *server) handleLeaderboardRecords(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Vary", "Authorization")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	viewer, err := s.optionalViewer(ctx, r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	track, format, ok := leaderboardParams(r)
	if !ok {
		http.Error(w, "track and format required", http.StatusBadRequest)
		return
	}
	params := r.URL.Query()
	q := platformsvc.LeaderboardQuery{TrackID: track, Format: format, Board: "pb", Limit: 50, Cursor: params.Get("cursor"), Around: params.Get("around")}
	if params.Has("board") {
		q.Board = params.Get("board")
	}
	if params.Has("limit") {
		q.Limit, err = strconv.Atoi(params.Get("limit"))
		if err != nil {
			http.Error(w, "invalid limit", http.StatusBadRequest)
			return
		}
	}
	if q.Around == "me" {
		if viewer == "" {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		q.Around = viewer
	}
	result, err := s.store.LeaderboardRecords(ctx, q, viewer)
	if errors.Is(err, platformsvc.ErrLeaderboardQuery) {
		http.Error(w, "invalid leaderboard query", http.StatusBadRequest)
		return
	}
	if err != nil {
		s.log.Error("records leaderboard", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", marketCacheControl)
	writeJSON(w, http.StatusOK, result)
}
