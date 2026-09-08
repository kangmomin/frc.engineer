// Package analysishttp provides the shared HTTP presentation of recorded traces.
package analysishttp

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"frc.engineer/internal/analysis"
)

// TraceHandler serves /api/sessions/{dir}/trace in both local servers.
func TraceHandler(packetRoot string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail := func(status int, e *analysis.TraceError) {
			if r.Context().Err() != nil {
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(struct {
				Error *analysis.TraceError `json:"error"`
			}{e})
		}
		invalid := func() {
			fail(http.StatusBadRequest, &analysis.TraceError{Code: "invalid_query", Message: "Invalid lap, session directory, or distance window."})
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			fail(http.StatusMethodNotAllowed, &analysis.TraceError{Code: "method_not_allowed", Message: "Use GET."})
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
		dir := strings.TrimSuffix(path, "/trace")
		if path == r.URL.Path || dir == path || dir == "" || dir == "." || strings.Contains(dir, "..") || strings.ContainsAny(dir, "/\\") {
			invalid()
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		// ParseQuery reports malformed escapes and semicolon separators.
		if err != nil {
			invalid()
			return
		}
		for key, values := range query {
			if len(values) != 1 || (key != "lap" && key != "fromM" && key != "toM") {
				invalid()
				return
			}
		}
		lap, err := strconv.Atoi(query.Get("lap"))
		if err != nil || lap < 1 || lap > 255 {
			invalid()
			return
		}
		var window *analysis.TraceExtent
		from, hasFrom := query["fromM"]
		to, hasTo := query["toM"]
		if hasFrom != hasTo {
			invalid()
			return
		}
		if hasFrom {
			a, e1 := strconv.ParseFloat(from[0], 64)
			b, e2 := strconv.ParseFloat(to[0], 64)
			if e1 != nil || e2 != nil || math.IsNaN(a) || math.IsNaN(b) || math.IsInf(a, 0) || math.IsInf(b, 0) || a < 0 || b <= a {
				invalid()
				return
			}
			window = &analysis.TraceExtent{FromM: a, ToM: b}
		}
		root, err := filepath.EvalSymlinks(packetRoot)
		if err != nil {
			writeReadError(err, fail)
			return
		}
		full, err := filepath.EvalSymlinks(filepath.Join(root, dir))
		if err != nil {
			writeReadError(err, fail)
			return
		}
		info, err := os.Stat(full)
		if err != nil {
			writeReadError(err, fail)
			return
		}
		if !info.IsDir() {
			writeReadError(os.ErrNotExist, fail)
			return
		}
		rel, err := filepath.Rel(root, full)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			invalid()
			return
		}
		// Reject stream symlinks escaping the same configured root as well.
		for _, name := range []string{"lap_data", "telemetry", "motion", "car_status", "session"} {
			target, e := filepath.EvalSymlinks(filepath.Join(full, name+".jsonl"))
			if errors.Is(e, os.ErrNotExist) {
				continue
			}
			if e != nil {
				writeReadError(e, fail)
				return
			}
			relative, e := filepath.Rel(root, target)
			if e != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
				invalid()
				return
			}
		}
		trace, err := analysis.ReadSelectedLapTrace(r.Context(), full, lap, window)
		if err != nil {
			if r.Context().Err() != nil {
				return
			}
			var typed *analysis.TraceError
			if errors.As(err, &typed) {
				status := map[string]int{"invalid_query": 400, "not_found": 404, "trace_unavailable": 422, "trace_too_large": 413}[typed.Code]
				if status == 0 {
					status = 500
				}
				fail(status, typed)
			} else {
				writeReadError(err, fail)
			}
			return
		}
		if r.Context().Err() != nil {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(trace)
	})
}
func writeReadError(err error, fail func(int, *analysis.TraceError)) {
	if errors.Is(err, os.ErrNotExist) {
		fail(404, &analysis.TraceError{Code: "not_found", Message: "Session or required lap data not found."})
	} else {
		fail(500, &analysis.TraceError{Code: "internal_error", Message: "Unable to read recorded trace."})
	}
}
