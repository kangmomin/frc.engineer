package main

import (
	"encoding/json"
	"strings"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/strategy"
)

func TestStripPrivateCaptureForSenderExternalPayloads(t *testing.T) {
	summary := &races.RaceSummary{
		PrivateCapture: &dto.RacePrivateCapture{
			Strategy:             &strategy.Evidence{SessionUID: "private-strategy-session"},
			RunID:                "private-run",
			EligibleIncidentKeys: []dto.IncidentCaptureKey{{SessionTimeMS: 123, Collisions: [][2]int{{0, 1}}}},
			Provenance:           dto.RaceCaptureProvenance{LapDataObserved: true, IncidentsCaptureActive: true, TrackOutlineSourcePoints: 336},
		},
	}
	external := stripPrivateCapture(summary)
	if external == summary || external.PrivateCapture != nil || summary.PrivateCapture == nil {
		t.Fatalf("strip result/original = %#v/%#v", external, summary)
	}
	raw, err := json.Marshal(dto.WSResponse{Type: dto.MessageTypeRaceResult, Data: external})
	if err != nil {
		t.Fatalf("marshal external response: %v", err)
	}
	for _, privateField := range []string{"privateCapture", "runId", "eligibleIncidentKeys", "lapDataObserved", "trackOutlineSourcePoints", "strategy", "private-strategy-session"} {
		if strings.Contains(string(raw), privateField) {
			t.Fatalf("sender external payload leaked %q: %s", privateField, raw)
		}
	}
}
