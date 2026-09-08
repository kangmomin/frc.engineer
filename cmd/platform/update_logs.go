package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

func (s *server) handleUpdateLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, allowViewAs: true})
	if !ok {
		return
	}
	var before int64
	query := r.URL.Query()
	if len(query) != 0 {
		values := query["before"]
		var err error
		if len(query) != 1 || len(values) != 1 {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}
		before, err = strconv.ParseInt(values[0], 10, 64)
		if err != nil || before <= 0 || strconv.FormatInt(before, 10) != values[0] {
			http.Error(w, "invalid cursor", http.StatusBadRequest)
			return
		}
	}
	page, err := s.store.ListUpdateLogs(ctx, p.AccountID, before)
	if err != nil {
		s.updateLogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *server) handleCreateUpdateLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true, permission: rbac.PermUpdateLogCreate}); !ok {
		return
	}
	var req platformsvc.CreateUpdateLogRequest
	// Enough for 10,120 runes even when each is JSON-escaped.
	if !decodeUpdateLogBody(w, r, 128<<10, &req) {
		return
	}
	entry, err := s.store.CreateUpdateLog(ctx, req)
	if err != nil {
		s.updateLogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (s *server) handleUpdateLogsSeen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, ok := s.gate(ctx, w, r, gateSpec{scope: platformsvc.ScopeWeb, blockBanned: true})
	if !ok {
		return
	}
	var req struct {
		Revision string `json:"revision"`
	}
	if !decodeUpdateLogBody(w, r, 1024, &req) {
		return
	}
	if err := s.store.MarkUpdateLogsSeen(ctx, p.AccountID, req.Revision); err != nil {
		s.updateLogError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeUpdateLogBody(w http.ResponseWriter, r *http.Request, limit int64, value any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(value); err != nil {
		http.Error(w, "invalid update log body", http.StatusBadRequest)
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		http.Error(w, "invalid update log body", http.StatusBadRequest)
		return false
	}
	return true
}

func (s *server) updateLogError(w http.ResponseWriter, err error) {
	if errors.Is(err, platformsvc.ErrBadUpload) {
		http.Error(w, "invalid update log input", http.StatusBadRequest)
		return
	}
	if s.log != nil {
		s.log.Error("update logs", "error", err)
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}
