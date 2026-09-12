package main

import (
	"encoding/json"
	"strings"
	"testing"

	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func senderStrategySummary() *races.RaceSummary {
	s := senderGoldenV2Summary()
	e := strategytest.Records()[0].Evidence
	s.PrivateCapture.Strategy = &e
	s.Detail.Laps = nil
	for _, l := range e.Laps {
		s.Detail.Laps = append(s.Detail.Laps, dto.LapTimingDTO{LapNumber: l.Number, LapMs: uint32(l.TimeMs), Tyre: l.Tyre, Valid: true})
	}
	return s
}

func TestUploadStrategyUsesConfirmedTimingsOnly(t *testing.T) {
	s := senderStrategySummary()
	s.Detail.Laps[1].LapMs++
	req, ok := buildUploadRequest(s, testUploadLogger())
	if !ok || req.Strategy == nil || len(req.Strategy.Laps) != len(s.PrivateCapture.Strategy.Laps)-1 {
		t.Fatal("inconsistent completed lap was uploaded")
	}
	for _, l := range req.Strategy.Laps {
		if l.Number == 2 {
			t.Fatal("unconfirmed lap included")
		}
	}
	if len(s.PrivateCapture.Strategy.Laps) != 30 {
		t.Fatal("upload mutated local capture")
	}
	raw, _ := json.Marshal(req)
	if strings.Contains(string(raw), "privateCapture") || !strings.Contains(string(raw), `"strategy"`) {
		t.Fatal("wrong upload evidence boundary")
	}
}

func TestUploadStrategyKeepsLapsWhenOptionalStopIsInvalid(t *testing.T) {
	s := senderStrategySummary()
	s.PrivateCapture.Strategy.Stops[0].StationaryMs = 600001
	req, ok := buildUploadRequest(s, testUploadLogger())
	if !ok || req.Strategy == nil || len(req.Strategy.Laps) != 30 || len(req.Strategy.Stops) != 0 || strategy.ValidateEvidence(req.Strategy) != nil {
		t.Fatal("bad optional pit timer discarded every confirmed lap")
	}
	if len(s.PrivateCapture.Strategy.Stops) != 1 {
		t.Fatal("upload mutated stored evidence")
	}
}

func TestStrategyUploadIncludedInEveryStorageMode(t *testing.T) {
	for _, mode := range []rtconfig.DataStorageMode{"", rtconfig.DataStorageModeResultOnly, rtconfig.DataStorageModeSummary, rtconfig.DataStorageModeAdvanced} {
		t.Run(string(mode), func(t *testing.T) {
			s := senderStrategySummary()
			s.DataStorageMode = mode
			req, ok := buildUploadRequest(s, testUploadLogger())
			if !ok || req.Strategy == nil || len(req.Strategy.Laps) != 30 {
				t.Fatal("local storage mode suppressed automatic strategy upload")
			}
		})
	}
}

func TestOptionalStrategyPreservesExistingUploadBudget(t *testing.T) {
	s := senderStrategySummary()
	e := s.PrivateCapture.Strategy
	e.Conditions.TotalLaps = strategy.MaxLaps
	base := e.Laps[1]
	e.Laps = nil
	s.Detail.Laps = nil
	for n := 1; n <= strategy.MaxLaps; n++ {
		l := base
		l.Number = n
		e.Laps = append(e.Laps, l)
		s.Detail.Laps = append(s.Detail.Laps, dto.LapTimingDTO{LapNumber: n, LapMs: uint32(l.TimeMs), Tyre: l.Tyre, Valid: true})
	}
	s.Detail.Events = nil
	for i := 0; i < 120; i++ {
		s.Detail.Events = append(s.Detail.Events, dto.RaceControlNotification{Timestamp: int64(i), Category: "info", Severity: "info", Message: strings.Repeat("event-", 118)})
	}
	s.PrivateCapture.Provenance.EventsSeen = len(s.Detail.Events)
	s.Incidents = nil
	for i := 0; i < 20; i++ {
		s.Incidents = append(s.Incidents, senderLargeV2Incident(int64(10000+i*10000)))
	}
	s.PrivateCapture.Strategy = nil
	baseline, _ := buildUploadRequest(s, testUploadLogger())
	before, _ := json.Marshal(baseline)
	s.PrivateCapture.Strategy = e
	request, ok := buildUploadRequest(s, testUploadLogger())
	raw, err := json.Marshal(request)
	evidence, _ := json.Marshal(e)
	if len(before)+len(evidence) <= uploadRequestSafetyBytes || len(baseline.Detail.Incidents) == 0 {
		t.Fatalf("fixture did not exercise optional evidence overflow: %d + %d, clips=%d", len(before), len(evidence), len(baseline.Detail.Incidents))
	}
	if !ok || err != nil || request.Strategy != nil || len(raw) > uploadRequestSafetyBytes || len(request.Detail.Incidents) != len(baseline.Detail.Incidents) {
		t.Fatalf("optional evidence harmed base upload: %d bytes, %v", len(raw), err)
	}
}
