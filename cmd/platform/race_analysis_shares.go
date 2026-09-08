package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

type raceAnalysisShareStore interface {
	GetMyRaceAnalysisShare(context.Context, string, string) (*platformsvc.RaceAnalysisShare, error)
	SetMyRaceAnalysisShare(context.Context, string, string, bool) (*platformsvc.RaceAnalysisShare, error)
	DeleteMyRaceAnalysisShare(context.Context, string, string) error
	GetSharedRaceAnalysis(context.Context, string) (*platformsvc.SharedRaceAnalysis, error)
	GetSharedRaceAnalysisIncident(context.Context, string, int) (*platformsvc.RaceAnalysisIncidentReplay, error)
}

func (s *server) analysisShares() raceAnalysisShareStore {
	if s.raceAnalysisShares != nil {
		return s.raceAnalysisShares
	}
	return s.store
}

func registerRaceAnalysisShareRoutes(mux *http.ServeMux, s *server) {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		mux.HandleFunc(method+" /me/race-analyses/{id}/share", s.handleMyRaceAnalysisShare)
	}
	mux.HandleFunc("GET /shared/race-analyses/{token}", s.handleSharedRaceAnalysis)
	mux.HandleFunc("GET /shared/race-analyses/{token}/incidents/{index}", s.handleSharedRaceAnalysisIncident)
}

func (s *server) handleMyRaceAnalysisShare(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	permission := rbac.PermRaceRead
	if r.Method == http.MethodPost || r.Method == http.MethodDelete {
		permission = rbac.PermRaceUpdate
	}
	// Even GET reveals a durable anonymous capability; View As cannot read it.
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: permission})
	if !ok {
		return
	}
	raceID, ok := pathUUID(r)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	share, err := s.analysisShares().GetMyRaceAnalysisShare(ctx, p.AccountID, raceID)
	if s.raceShareError(w, err) {
		return
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		writeJSON(w, http.StatusOK, share)
	case http.MethodPost:
		includeSetup, err := decodeRaceAnalysisShare(w, r)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		share, err := s.analysisShares().SetMyRaceAnalysisShare(ctx, p.AccountID, raceID, includeSetup)
		if !s.raceShareError(w, err) {
			writeJSON(w, http.StatusOK, share)
		}
	case http.MethodDelete:
		if !s.raceShareError(w, s.analysisShares().DeleteMyRaceAnalysisShare(ctx, p.AccountID, raceID)) {
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func decodeRaceAnalysisShare(w http.ResponseWriter, r *http.Request) (bool, error) {
	var body struct {
		IncludeSetup *bool `json:"includeSetup"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return false, err
	}
	if body.IncludeSetup == nil {
		return false, errors.New("includeSetup is required")
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return false, errors.New("trailing share JSON")
	}
	return *body.IncludeSetup, nil
}

func (s *server) handleSharedRaceAnalysis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token, err := uuid.Parse(r.PathValue("token"))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	detail, err := s.analysisShares().GetSharedRaceAnalysis(ctx, token.String())
	if !s.raceShareError(w, err) {
		writeJSON(w, http.StatusOK, detail)
	}
}

func (s *server) handleSharedRaceAnalysisIncident(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token, err := uuid.Parse(r.PathValue("token"))
	index, ok := raceAnalysisIncidentIndex(r.PathValue("index"))
	if err != nil || !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	incident, err := s.analysisShares().GetSharedRaceAnalysisIncident(ctx, token.String(), index)
	if !s.raceShareError(w, err) {
		writeJSON(w, http.StatusOK, incident)
	}
}

func (s *server) raceShareError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, platformsvc.ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
	} else {
		if s.log != nil {
			s.log.Error("race analysis share", "error", err)
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
	return true
}

func raceAnalysisFilters(r *http.Request) (platformsvc.RaceAnalysisFilters, bool) {
	query := r.URL.Query()
	filter := platformsvc.RaceAnalysisFilters{
		Search: strings.TrimSpace(query.Get("search")), GameFormat: strings.TrimSpace(query.Get("gameFormat")),
		SessionType: strings.TrimSpace(query.Get("sessionType")),
	}
	if utf8.RuneCountInString(filter.Search) > 64 || utf8.RuneCountInString(filter.GameFormat) > 32 || utf8.RuneCountInString(filter.SessionType) > 48 {
		return filter, false
	}
	for key, target := range map[string]**time.Time{"from": &filter.From, "before": &filter.Before} {
		if raw, present := query[key]; present {
			value, err := time.Parse(time.RFC3339, raw[0])
			if err != nil {
				return filter, false
			}
			*target = &value
		}
	}
	return filter, filter.From == nil || filter.Before == nil || filter.From.Before(*filter.Before)
}
