package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
	"frc.engineer/internal/strategy"
)

type strategyStore interface {
	LoadStrategyRecords(context.Context, int, string) ([]strategy.Record, bool, error)
}

func (s *server) strategies() strategyStore {
	if s.strategyStore != nil {
		return s.strategyStore
	}
	return s.store
}

func registerStrategyRoutes(mux *http.ServeMux, s *server) {
	mux.HandleFunc("GET /strategies/contexts", s.handleStrategyContexts)
	mux.HandleFunc("POST /strategies/simulate", s.handleStrategySimulate)
}

func strategyJSON(w http.ResponseWriter, r *http.Request, out any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

func (s *server) strategyGate(w http.ResponseWriter, r *http.Request, ctx context.Context) bool {
	w.Header().Set("Cache-Control", "no-store")
	_, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermStrategyRead})
	return ok
}

func (s *server) strategyError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if s.log != nil {
		s.log.Error("strategy request", "error", err)
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
	return true
}

func strategyTrackQuery(r *http.Request, allowAll bool) (int, string, bool) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err == nil && allowAll && len(q) == 1 && len(q["gameFormat"]) == 1 {
		format := q.Get("gameFormat")
		return platformsvc.AllStrategyTracks, format, format == "F1 25" || format == "F1 26"
	}
	if err != nil || len(q) != 2 || len(q["trackId"]) != 1 || len(q["gameFormat"]) != 1 {
		return 0, "", false
	}
	track, err := strconv.Atoi(q.Get("trackId"))
	format := q.Get("gameFormat")
	return track, format, err == nil && track >= 0 && track <= 255 && (format == "F1 25" || format == "F1 26")
}

func (s *server) handleStrategyContexts(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if !s.strategyGate(w, r, ctx) {
		return
	}
	track, format, ok := strategyTrackQuery(r, true)
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	records, truncated, err := s.strategies().LoadStrategyRecords(ctx, track, format)
	if s.strategyError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Contexts    []strategy.Context `json:"contexts"`
		Records     int                `json:"records"`
		Truncated   bool               `json:"truncated"`
		RecordLimit int                `json:"recordLimit"`
		MinUsers    int                `json:"minUsers"`
		MinSessions int                `json:"minSessions"`
	}{strategy.Contexts(records), len(records), truncated, platformsvc.StrategyRecordLimit, strategy.MinUsers, strategy.MinSessions})
}

func (s *server) handleStrategySimulate(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if !s.strategyGate(w, r, ctx) {
		return
	}
	track, format, ok := strategyTrackQuery(r, false)
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var body struct {
		ContextID           string         `json:"contextId"`
		MaxStops            *int           `json:"maxStops"`
		AvailableSets       map[string]int `json:"availableSets"`
		RequireTwoCompounds *bool          `json:"requireTwoCompounds"`
	}
	if strategyJSON(w, r, &body) != nil || body.MaxStops == nil || body.RequireTwoCompounds == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	request := strategy.Request{ContextID: body.ContextID, MaxStops: *body.MaxStops, AvailableSets: body.AvailableSets, RequireTwoCompounds: *body.RequireTwoCompounds}
	if strategy.ValidateRequest(request) != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	records, _, err := s.strategies().LoadStrategyRecords(ctx, track, format)
	if s.strategyError(w, err) {
		return
	}
	out := strategy.Analyze(records, request)
	if out.Status == "context-not-found" {
		http.Error(w, "strategy context not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
