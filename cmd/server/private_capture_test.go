package main

import (
	"encoding/json"
	"strings"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func TestStripPrivateCaptureForServerArchivePayloads(t *testing.T) {
	summary := &races.RaceSummary{
		PrivateCapture: &dto.RacePrivateCapture{
			RunID:                "private-run",
			EligibleIncidentKeys: []dto.IncidentCaptureKey{{SessionTimeMS: 123, Collisions: [][2]int{{0, 1}}}},
			Provenance:           dto.RaceCaptureProvenance{SessionHistoryObserved: true, IncidentsCaptureActive: true, TrackOutlineSourcePoints: 336},
		},
	}
	external := stripPrivateCapture(summary)
	if external == summary || external.PrivateCapture != nil || summary.PrivateCapture == nil {
		t.Fatalf("strip result/original = %#v/%#v", external, summary)
	}
	raw, err := json.Marshal(external)
	if err != nil {
		t.Fatalf("marshal external archive response: %v", err)
	}
	for _, privateField := range []string{"privateCapture", "runId", "eligibleIncidentKeys", "sessionHistoryObserved", "trackOutlineSourcePoints"} {
		if strings.Contains(string(raw), privateField) {
			t.Fatalf("server archive payload leaked %q: %s", privateField, raw)
		}
	}
}
