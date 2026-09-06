package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func TestLatestRaceServesSmallResultFromMemoryAndDisk(t *testing.T) {
	summary := newTestSummary(42, 1, 2)
	summary.Player.BestLapMS = 90000
	state := &dto.PitwallState{Drivers: make([]dto.DriverInfo, 24)}
	summary.Replay = &races.ReplayTimeline{FrameIntervalMS: 500}
	for i := range 240 {
		summary.Replay.Frames = append(summary.Replay.Frames, races.ReplayFrame{Timestamp: int64(i * 500), Pitwall: state})
	}
	summary.PrivateCapture = &dto.RacePrivateCapture{RunID: "private-run"}
	summary.Incidents = []dto.IncidentClip{{SessionTimeMS: 1000}}
	rs, err := races.NewFileStorage(t.TempDir(), testUploadLogger())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rs.Save(summary); err != nil {
		t.Fatal(err)
	}
	for _, memory := range []bool{true, false} {
		handler := latestRaceHandler(func() *races.RaceSummary {
			if memory {
				return summary
			}
			return nil
		}, func() *races.FileStorage { return rs }, testUploadLogger())
		for range 2 { // The disk result is cached after its first read.
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/races/latest", nil))
			if recorder.Code != http.StatusOK || recorder.Body.Len() > 4096 {
				t.Fatalf("memory=%v: status=%d, bytes=%d", memory, recorder.Code, recorder.Body.Len())
			}
			var wire map[string]json.RawMessage
			if err := json.Unmarshal(recorder.Body.Bytes(), &wire); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"replay", "incidents", "privateCapture", "detail", "drivers", "debrief"} {
				if _, ok := wire[key]; ok {
					t.Fatalf("latest leaked %s", key)
				}
			}
			var result races.ResultSummary
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Player.BestLapMS != 90000 || result.ID != summary.ID {
				t.Fatalf("lost result fields: %+v", result)
			}
		}
	}
	if summary.Replay == nil || summary.PrivateCapture == nil || len(summary.Incidents) != 1 {
		t.Fatal("projection mutated the stored summary")
	}
	// A checkpoint update under the same ID invalidates the cached projection.
	summary.Player.BestLapMS = 89000
	if _, err := rs.Save(summary); err != nil {
		t.Fatal(err)
	}
	result, err := rs.LoadResult(summary.ID)
	if err != nil || result.Player.BestLapMS != 89000 {
		t.Fatalf("stale cached result: %+v / %v", result, err)
	}
}

func TestLatestRaceReturnsNotFoundWithoutResults(t *testing.T) {
	handler := latestRaceHandler(func() *races.RaceSummary { return nil }, func() *races.FileStorage { return nil }, testUploadLogger())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/races/latest", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}
