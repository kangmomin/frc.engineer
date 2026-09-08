package analysishttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func httpFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "recorded")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data := `{"frame":1,"sessionTime":0,"data":{"Header":{"PlayerCarIndex":0,"OverallFrameIdentifier":1},"LapData":[{"CurrentLapNum":1,"CurrentLapTimeInMS":0,"LapDistance":0}]}}
{"frame":4,"sessionTime":0.05,"data":{"Header":{"PlayerCarIndex":0,"OverallFrameIdentifier":4},"LapData":[{"CurrentLapNum":1,"CurrentLapTimeInMS":50,"LapDistance":5}]}}
{"frame":7,"sessionTime":0.1,"data":{"Header":{"PlayerCarIndex":0,"OverallFrameIdentifier":7},"LapData":[{"CurrentLapNum":2,"CurrentLapTimeInMS":0,"LastLapTimeInMS":100,"LapDistance":0}]}}
`
	if err := os.WriteFile(filepath.Join(dir, "lap_data.jsonl"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	return root
}
func TestTraceHTTPQueryAndMethodContract(t *testing.T) {
	root := httpFixture(t)
	handler := TraceHandler(root)
	for _, tc := range []struct {
		method, path string
		status       int
		code         string
	}{
		{"GET", "/api/sessions/recorded/trace?lap=1", 200, ""},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=0&toM=5", 200, ""},
		{"GET", "/api/sessions/recorded/trace", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=0", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=256", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1.0", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&lap=2", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&extra=1", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=0", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=0&toM=NaN", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=0&toM=Inf", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=5&toM=0", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=1&fromM=0&toM=6", 400, "invalid_query"},
		{"GET", "/api/sessions/recorded/trace?lap=2", 404, "not_found"},
		{"GET", "/api/sessions/missing/trace?lap=1", 404, "not_found"},
		{"GET", "/api/sessions/../trace?lap=1", 400, "invalid_query"},
		{"GET", "/api/sessions/a%2Fb/trace?lap=1", 400, "invalid_query"},
		{"GET", "/api/sessions/a%5Cb/trace?lap=1", 400, "invalid_query"},
		{"GET", "/api/sessions//trace?lap=1", 400, "invalid_query"},
		{"POST", "/api/sessions/recorded/trace?lap=1", 405, "method_not_allowed"},
		{"HEAD", "/api/sessions/recorded/trace?lap=1", 405, "method_not_allowed"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status %d want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if w.Header().Get("Content-Type") != "application/json" {
				t.Fatal("JSON content type required")
			}
			if tc.status == 405 && w.Header().Get("Allow") != "GET" {
				t.Fatal("Allow GET required")
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.code != "" && body["error"].(map[string]any)["code"] != tc.code {
				t.Fatalf("wrong error: %v", body)
			}
			if strings.Contains(w.Body.String(), root) {
				t.Fatal("private path leaked")
			}
			if tc.status == 200 {
				if body["trackId"] != nil || body["window"] != nil && tc.path == "/api/sessions/recorded/trace?lap=1" {
					t.Fatal("unknown metadata/window contract")
				}
				for _, key := range []string{"controls", "motion", "status"} {
					if rows, ok := body[key].([]any); !ok || len(rows) != 0 {
						t.Fatalf("%s must be []", key)
					}
				}
			}
		})
	}
}
func TestTraceHTTPPathReadErrorsAndCancellation(t *testing.T) {
	root := httpFixture(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	handler := TraceHandler(root)
	for _, tc := range []struct {
		dir  string
		want int
	}{{"escape", 400}, {"empty", 404}, {"file", 404}} {
		if tc.dir == "empty" {
			os.Mkdir(filepath.Join(root, tc.dir), 0700)
		}
		if tc.dir == "file" {
			os.WriteFile(filepath.Join(root, tc.dir), []byte("x"), 0600)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/"+tc.dir+"/trace?lap=1", nil))
		if w.Code != tc.want {
			t.Fatalf("%s: %d %s", tc.dir, w.Code, w.Body.String())
		}
	}
	// A directory in place of an input stream is an actual read failure.
	os.Mkdir(filepath.Join(root, "recorded", "telemetry.jsonl"), 0700)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil))
	if w.Code != 500 {
		t.Fatalf("read failure: %d", w.Code)
	}
	os.Remove(filepath.Join(root, "recorded", "telemetry.jsonl"))
	outsideFile := filepath.Join(outside, "status.jsonl")
	os.WriteFile(outsideFile, []byte("{}\n"), 0600)
	os.Symlink(outsideFile, filepath.Join(root, "recorded", "car_status.jsonl"))
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil))
	if w.Code != 400 {
		t.Fatalf("stream symlink escape: %d", w.Code)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil).WithContext(ctx))
	if w.Body.Len() != 0 {
		t.Fatal("canceled request wrote ordinary response")
	}
}
func TestTraceHTTPUnavailableAndTooLarge(t *testing.T) {
	root := httpFixture(t)
	path := filepath.Join(root, "recorded", "lap_data.jsonl")
	data, _ := os.ReadFile(path)
	// A lap clock rewind with repeated frames and no capture timestamps is unsafe.
	legacy := strings.ReplaceAll(string(data), `"OverallFrameIdentifier":1`, `"OverallFrameIdentifier":0`)
	legacy = strings.ReplaceAll(legacy, `"OverallFrameIdentifier":4`, `"OverallFrameIdentifier":0`)
	legacy = strings.ReplaceAll(legacy, `"OverallFrameIdentifier":7`, `"OverallFrameIdentifier":0`)
	parts := strings.Split(legacy, "\n")
	legacy = parts[0] + "\n" + parts[1] + "\n" + parts[0] + "\n" + parts[1] + "\n" + parts[2] + "\n"
	os.WriteFile(path, []byte(legacy), 0600)
	w := httptest.NewRecorder()
	TraceHandler(root).ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil))
	if w.Code != 422 || !strings.Contains(w.Body.String(), "trace_unavailable") {
		t.Fatalf("unsafe legacy: %d %s", w.Code, w.Body.String())
	}
	os.WriteFile(path, []byte(strings.ReplaceAll(string(data), `"OverallFrameIdentifier":7`, `"OverallFrameIdentifier":70000`)), 0600)
	f, err := os.Create(filepath.Join(root, "recorded", "telemetry.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 60001; i++ {
		fmt.Fprintf(f, "{\"frame\":%d,\"sessionTime\":0.02,\"data\":{\"Header\":{\"PlayerCarIndex\":0,\"OverallFrameIdentifier\":%d},\"CarTelemetryData\":[{\"Brake\":1}]}}\n", i+1, i+1)
	}
	f.Close()
	w = httptest.NewRecorder()
	TraceHandler(root).ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil))
	if w.Code != 413 || !strings.Contains(w.Body.String(), `"maxSamples":60000`) {
		t.Fatalf("size cap: %d %s", w.Code, w.Body.String())
	}
}
func TestRegisteredTraceRouteWinsLegacySubtree(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/sessions/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	mux.Handle("/api/sessions/{dir}/trace", TraceHandler(httpFixture(t)))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/sessions/recorded/trace?lap=1", nil))
	if w.Code != 200 {
		t.Fatalf("trace route: %d", w.Code)
	}
}
