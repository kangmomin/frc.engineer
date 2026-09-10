package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func senderV2Int(value int) *int { return &value }

// senderGoldenV2Summary is deliberately shaped like the backend-owned fixture.
// Keeping the mapper test independent of platformsvc prevents the sender from
// accidentally importing the database package just to satisfy its wire contract.
func senderGoldenV2Summary() *races.RaceSummary {
	return &races.RaceSummary{
		ID:            "golden-race-analysis-v2",
		SchemaVersion: races.RaceSummarySchemaVersion,
		Track:         races.TrackInfo{TrackID: 10, TrackName: "Monza"},
		Session:       races.SessionSummary{SessionType: "Race"},
		GameFormat:    "F1 26",
		Player: races.PlayerSummary{Stints: []races.RaceStint{
			{Compound: "soft", Laps: 1, StartLap: 1, EndLap: 1, TireWearPct: 4},
		}},
		Debrief: &races.RaceDebrief{
			Penalties: races.RacePenaltySummary{},
			Tyres: races.RaceTyreSummary{
				FinalCompound: "Soft", FinalAge: 1, AverageWearPct: 4, PeakWearPct: 5,
			},
			Pit: races.RacePitSummary{Stops: 0},
		},
		Detail: &races.RaceDetail{
			Laps: []dto.LapTimingDTO{{LapNumber: 1, LapMs: 90_000, S1Ms: 30_000, S2Ms: 30_000, S3Ms: 30_000, Tyre: "Soft", Valid: true}},
			Dynamics: []dto.DynamicsLapDTO{{
				LapNum: 1, UndersteerPct: 2.5, OversteerPct: 1.5,
			}},
			Events: []dto.RaceControlNotification{{
				Lap: 1, Timestamp: 1_770_000_000_000, Category: "info", Severity: "info", Message: "Race started", DriverName: "Player",
			}},
			CaptureStartLap: 1,
			FinalizeTrigger: "SEND",
			TrackOutline: &dto.TrackOutlineDTO{
				Points: [][2]float64{{0, 0}, {10, 10}},
				Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 10, MinZ: 0, MaxZ: 10},
			},
		},
		Incidents: []dto.IncidentClip{{
			SessionTimeMS: 1000, WindowStartMS: 0, FrameIntervalMS: 50, Lap: 1,
			Collisions: [][2]int{{0, 1}},
			Participants: []dto.IncidentParticipant{
				{Idx: 0, Name: "Player", TeamID: senderV2Int(0), IsPlayer: true, MinDistM: 0, DamageBefore: make([]int, dto.IncidentDamageValues), DamageAfter: []int{42, 0, 0, 15, 0, 0, 0, 0, 100, 0, 0, 0}},
				{Idx: 1, Name: "No Team", TeamID: senderV2Int(255), MinDistM: 2.1, DamageBefore: []int{0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, DamageAfter: []int{0, 30, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0}},
			},
			Frames: []dto.IncidentFrame{
				{TMS: 0, Cars: [][]float64{{0, 0, 0, 0, 0, 10, 0, 0, 0, 100, 0, 0, 0, 4}, {2, 0, 0, 0, 0, 9, 0, 0, 0, 90, 0, 0, 0, 4}}, TelemetryUnavailable: []int{}},
				{TMS: 50, Cars: [][]float64{{0, 0, 0.5, 0, 0, 10, 0, 0, 0, 100, 0, 0, 0, 4}, {2, 0, 0.45, 0, 0, 9, 0, 0, 0, 90, 0, 0, 0, 4}}, TelemetryUnavailable: []int{}},
			},
			Completeness: dto.IncidentCompleteness{
				Status: dto.AvailabilityComplete, Reasons: []dto.CompletenessReason{},
				CapturedParticipantCount: senderV2Int(2), StoredParticipantCount: 2,
				CapturedFrameCount: senderV2Int(2), StoredFrameCount: 2,
			},
		}},
		PrivateCapture: &dto.RacePrivateCapture{
			EligibleIncidentKeys: []dto.IncidentCaptureKey{{SessionTimeMS: 1000, Collisions: [][2]int{{0, 1}}}},
			Provenance: dto.RaceCaptureProvenance{
				LapDataObserved: true, SessionHistoryObserved: true, CarStatusObserved: true,
				CarDamageObserved: true, EventsCaptureActive: true, EventsSeen: 1,
				IncidentsCaptureActive: true, NormalFinalize: true,
			},
		},
	}
}

func TestBuildUploadRequestMatchesRaceAnalysisV2Golden(t *testing.T) {
	summary := senderGoldenV2Summary()
	request, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || request == nil || request.Detail == nil {
		t.Fatal("buildUploadRequest did not produce a v2 detail request")
	}
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal sender request: %v", err)
	}
	fixture, err := os.ReadFile(filepath.Join("..", "..", "internal", "platformsvc", "testdata", "race_analysis_v2.json"))
	if err != nil {
		t.Fatalf("read backend-owned v2 fixture: %v", err)
	}
	var got, want map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode sender request: %v", err)
	}
	if err := json.Unmarshal(fixture, &want); err != nil {
		t.Fatalf("decode v2 fixture: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		wantJSON, _ := json.MarshalIndent(want, "", "  ")
		t.Fatalf("sender v2 payload diverged from frozen fixture\ngot:  %s\nwant: %s", gotJSON, wantJSON)
	}
	if _, exposed := got["privateCapture"]; exposed {
		t.Fatal("private eligible ledger/provenance leaked into upload")
	}
}

func senderLargeV2Incident(tMS int64) dto.IncidentClip {
	participantCount, frameCount := 24, 101
	clip := dto.IncidentClip{
		SessionTimeMS: tMS, WindowStartMS: tMS - 1000, FrameIntervalMS: 50, Lap: 3,
		Collisions: [][2]int{{0, 1}},
		Completeness: dto.IncidentCompleteness{
			Status: dto.AvailabilityComplete, Reasons: []dto.CompletenessReason{},
			CapturedParticipantCount: &participantCount, StoredParticipantCount: participantCount,
			CapturedFrameCount: &frameCount, StoredFrameCount: frameCount,
		},
	}
	for index := 0; index < participantCount; index++ {
		clip.Participants = append(clip.Participants, dto.IncidentParticipant{Idx: index, TeamID: senderV2Int(index), IsPlayer: index == 0, MinDistM: float64(index)})
	}
	for frame := 0; frame < frameCount; frame++ {
		cars := make([][]float64, participantCount)
		for index := range cars {
			cars[index] = []float64{float64(index), 0, float64(frame), 0, 0, 10, 0, 0, 0, 100, 0, 0, 0, 4}
		}
		clip.Frames = append(clip.Frames, dto.IncidentFrame{TMS: tMS - 1000 + int64(frame*50), Cars: cars, TelemetryUnavailable: []int{}})
	}
	return clip
}

func TestBuildUploadRequestRequestBudgetDropKeepsV2Metadata(t *testing.T) {
	summary := senderGoldenV2Summary()
	for lap := 2; lap <= 500; lap++ {
		summary.Detail.Laps = append(summary.Detail.Laps, dto.LapTimingDTO{LapNumber: lap, LapMs: 90_000, S1Ms: 30_000, S2Ms: 30_000, S3Ms: 30_000, Tyre: "Soft", Valid: true})
	}
	// 200 bounded rich events plus the post-300KiB incident block intentionally
	// cross the 480KiB sender safety guard while remaining under the platform's
	// 512KiB cap after incidents are dropped.
	summary.Detail.Events = nil
	for i := 0; i < uploadMaxDetailEvents; i++ {
		summary.Detail.Events = append(summary.Detail.Events, dto.RaceControlNotification{
			Timestamp: int64(i), Category: "info", Severity: "info", Message: strings.Repeat("event-", 160),
		})
	}
	summary.PrivateCapture.Provenance.EventsSeen = len(summary.Detail.Events)
	summary.Incidents = nil
	for i := 0; i < 20; i++ {
		summary.Incidents = append(summary.Incidents, senderLargeV2Incident(int64(10_000+i*10_000)))
	}

	request, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || request == nil || request.Detail == nil {
		t.Fatal("buildUploadRequest did not produce a v2 request")
	}
	if request.Detail.Incidents != nil || request.Detail.Completeness == nil {
		encoded, _ := json.Marshal(request)
		t.Fatalf("budget guard incidents=%d completeness=%v requestBytes=%d, want dropped/preserved", len(request.Detail.Incidents), request.Detail.Completeness != nil, len(encoded))
	}
	section := request.Detail.Completeness.Sections.Incidents
	if section.Status != string(dto.AvailabilityUnavailable) || section.StoredCount == nil || *section.StoredCount != 0 ||
		!hasUploadReason(section.Reasons, string(dto.ReasonRequestBudgetDropped)) {
		t.Fatalf("request-budget completeness = %+v, want unavailable zero with reason", section)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal post-budget request: %v", err)
	}
	if len(encoded) > 512<<10 {
		t.Fatalf("post-budget request = %d bytes, exceeds platform cap", len(encoded))
	}
}

func TestBuildUploadRequestPreservesZeroMeasuredStationaryTime(t *testing.T) {
	summary := senderGoldenV2Summary()
	summary.Debrief.Pit = races.RacePitSummary{Stops: 1, PitLaneTimeMS: 12_000, StationaryTimeMS: 0}
	summary.PrivateCapture.Provenance.PitMeasurementObserved = true
	request, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || request == nil || request.Pit == nil {
		t.Fatalf("measured pit request = %+v/%v, want top-level measurement", request, ok)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	pit := wire["pit"].(map[string]any)
	if _, exists := pit["stationaryMs"]; !exists || pit["stationaryMs"] != float64(0) {
		t.Fatalf("top-level pit = %#v, want explicit zero stationaryMs", pit)
	}
}

func TestBuildUploadRequestCarriesRestartMergedPitMeasurement(t *testing.T) {
	previous := senderGoldenV2Summary()
	previous.PrivateCapture.RunID = "previous-process"
	previous.Debrief.Pit = races.RacePitSummary{Stops: 1, PitLaneTimeMS: 18_000, StationaryTimeMS: 2_500}
	previous.PrivateCapture.Provenance.PitMeasurementObserved = true

	next := senderGoldenV2Summary()
	next.PrivateCapture.RunID = "next-process"
	next.Debrief.Pit = races.RacePitSummary{Stops: 1}
	next.PrivateCapture.Provenance.PitMeasurementObserved = false
	races.MergeAdoptedSummary(previous, next)

	request, ok := buildUploadRequest(next, testUploadLogger())
	if !ok || request == nil || request.Detail == nil || request.Pit == nil {
		t.Fatalf("merged pit request = %+v/%v, want exact v2 measurement pair", request, ok)
	}
	if request.Pit.Stops != 1 || request.Pit.PitLaneTimeMs != 18_000 || request.Pit.StationaryMs != 2_500 ||
		request.Detail.Debrief.Pit.PitLaneTimeMs == nil || request.Detail.Debrief.Pit.StationaryTimeMs == nil ||
		*request.Detail.Debrief.Pit.PitLaneTimeMs != 18_000 || *request.Detail.Debrief.Pit.StationaryTimeMs != 2_500 {
		t.Fatalf("merged upload pit facts = %+v / %+v, want matching atomic pair", request.Pit, request.Detail.Debrief.Pit)
	}
}

func TestRestartDebriefPreservesEachObservationGroupAndObservedZeros(t *testing.T) {
	previous := senderGoldenV2Summary()
	previous.PrivateCapture.Provenance.TyreSetsObserved = true
	previous.Debrief.Tyres = races.RaceTyreSummary{
		FinalCompound: "Medium", FinalAge: 12, AverageWearPct: 31, PeakWearPct: 35,
		FinalSetWearPct: 32, LifeSpan: 30, UsableLife: 25, LifeRemainingPct: 60,
	}
	previous.Debrief.Penalties = races.RacePenaltySummary{TimePenaltySeconds: 5, Warnings: 3}
	for _, observed := range []bool{false, true} {
		next := senderGoldenV2Summary()
		next.Debrief.Tyres = races.RaceTyreSummary{}
		next.Debrief.Penalties = races.RacePenaltySummary{}
		next.PrivateCapture.Provenance = dto.RaceCaptureProvenance{
			CarStatusObserved: observed, CarDamageObserved: observed, TyreSetsObserved: observed, LapDataObserved: observed,
		}
		races.MergeAdoptedSummary(previous, next)
		wire := mapUploadDebrief(next)
		wantAge, wantWear, wantSet, wantWarnings := 12, 31, 32, 3
		if observed {
			wantAge, wantWear, wantSet, wantWarnings = 0, 0, 0, 0
		}
		if wire.Tyres.FinalAge == nil || *wire.Tyres.FinalAge != wantAge ||
			wire.Tyres.AverageWearPct == nil || *wire.Tyres.AverageWearPct != wantWear ||
			wire.Tyres.FinalSetWearPct == nil || *wire.Tyres.FinalSetWearPct != wantSet ||
			wire.Penalties.Warnings != wantWarnings {
			t.Fatalf("observed=%v: upload debrief %+v / %+v", observed, wire.Tyres, wire.Penalties)
		}
		if !observed && next.Debrief.Tyres != previous.Debrief.Tyres {
			t.Fatalf("lost tyre facts: %+v", next.Debrief.Tyres)
		}
	}
	// A new CarStatus packet says nothing about damage or fitted-set wear.
	next := senderGoldenV2Summary()
	next.Debrief.Tyres = races.RaceTyreSummary{FinalCompound: "Soft"}
	next.PrivateCapture.Provenance = dto.RaceCaptureProvenance{CarStatusObserved: true}
	races.MergeAdoptedSummary(previous, next)
	if next.Debrief.Tyres.FinalCompound != "Soft" || next.Debrief.Tyres.FinalAge != 0 ||
		next.Debrief.Tyres.PeakWearPct != 35 || next.Debrief.Tyres.LifeRemainingPct != 60 {
		t.Fatalf("mixed observation groups: %+v", next.Debrief.Tyres)
	}
}

func TestBuildUploadRequestCarriesRestartMergedZeroStationaryMeasurement(t *testing.T) {
	previous := senderGoldenV2Summary()
	previous.PrivateCapture.RunID = "previous-process"
	previous.Debrief.Pit = races.RacePitSummary{Stops: 1, PitLaneTimeMS: 18_000, StationaryTimeMS: 0}
	previous.PrivateCapture.Provenance.PitMeasurementObserved = true
	next := senderGoldenV2Summary()
	next.PrivateCapture.RunID = "next-process"
	next.Debrief.Pit = races.RacePitSummary{Stops: 1}
	races.MergeAdoptedSummary(previous, next)

	request, ok := buildUploadRequest(next, testUploadLogger())
	if !ok || request == nil || request.Detail == nil || request.Pit == nil || request.Pit.StationaryMs != 0 ||
		request.Detail.Debrief.Pit.StationaryTimeMs == nil || *request.Detail.Debrief.Pit.StationaryTimeMs != 0 {
		t.Fatalf("zero-stationary merged request = %+v/%+v, want explicit matching zero", request.Pit, request.Detail)
	}
}

func hasUploadReason(reasons []string, wanted string) bool {
	for _, reason := range reasons {
		if reason == wanted {
			return true
		}
	}
	return false
}

func TestBuildUploadRequestKeeps24Participants(t *testing.T) {
	summary := senderGoldenV2Summary()
	summary.Incidents = []dto.IncidentClip{senderLargeV2Incident(10_000)}
	summary.Incidents[0].Collisions = [][2]int{{0, 23}}
	request, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || request.Detail == nil || len(request.Detail.Incidents) != 1 {
		t.Fatal("24-car incident missing")
	}
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var decoded uploadRequest
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	clip := decoded.Detail.Incidents[0]
	if len(clip.Participants) != 24 || clip.Completeness.StoredParticipantCount != 24 || clip.Collisions[0] != [2]int{0, 23} {
		t.Fatalf("24-car identities lost: %+v", clip.Completeness)
	}
	for _, f := range clip.Frames {
		for j, p := range clip.Participants {
			if len(f.Cars) != 24 || f.Cars[j][0] != float64(p.Idx) {
				t.Fatal("frame columns changed")
			}
		}
	}
	if hasUploadReason(decoded.Detail.Completeness.Sections.Incidents.Reasons, string(dto.ReasonUploadParticipantsTrimmed)) {
		t.Fatal("new upload trimmed participants")
	}
	t.Logf("serialized 24-car upload: %d bytes", len(raw))
}
