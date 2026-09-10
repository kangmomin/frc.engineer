package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/dto"
)

func goldenAnalysisRecord(t *testing.T) (UploadRequest, raceAnalysisRecord) {
	t.Helper()
	_, request := readRaceAnalysisV2Fixture(t)
	payload, err := json.Marshal(request.Detail)
	if err != nil {
		t.Fatalf("marshal golden detail payload: %v", err)
	}
	version := 2
	payloadText := string(payload)
	recordedAt := time.Date(2026, time.September, 4, 10, 0, 0, 0, time.UTC)
	uploadedAt := recordedAt.Add(time.Minute)
	return request, raceAnalysisRecord{
		ID: "00000000-0000-4000-8000-000000000001", TrackID: request.TrackID, TrackName: request.TrackName,
		SessionType: request.SessionType, GameFormat: request.GameFormat, RecordedAt: &recordedAt, UploadedAt: uploadedAt,
		CompletedLaps: analysisInt(1), BestLapMs: analysisInt(90_000), SchemaVersion: &version, Payload: &payloadText, LapCount: 1,
	}
}

func analysisInt(value int) *int { return &value }

func TestBuildRaceAnalysisDetailProjectsGoldenV2WithoutRawJSON(t *testing.T) {
	_, record := goldenAnalysisRecord(t)
	laps := []RaceAnalysisLap{{LapNumber: 1, LapMs: 90_000, S1Ms: analysisInt(30_000), S2Ms: analysisInt(30_000), S3Ms: analysisInt(30_000), Tyre: stringPtr("Soft"), Valid: true}}
	detail := buildRaceAnalysisDetail(record, laps, nil)
	if detail.SchemaVersion == nil || *detail.SchemaVersion != 2 || len(detail.Laps) != 1 || len(detail.Incidents) != 1 {
		t.Fatalf("v2 analysis detail = %+v", detail)
	}
	if detail.TrackOutline == nil || len(detail.TrackOutline.Points) != 2 || detail.PitMeasurement == nil || detail.PitMeasurement.Stops != 0 {
		t.Fatalf("v2 outline/pit = %+v/%+v", detail.TrackOutline, detail.PitMeasurement)
	}
	if detail.Penalties == nil || detail.Tyres == nil || detail.Penalties.TimePenaltySeconds != 0 {
		t.Fatalf("confirmed v2 zero facts must remain explicit: penalties=%+v tyres=%+v", detail.Penalties, detail.Tyres)
	}
	incident := detail.Incidents[0]
	if incident.FrameCount != 2 || len(incident.Participants) != 2 || incident.Participants[0].TeamID == nil || *incident.Participants[0].TeamID != 0 ||
		incident.Participants[1].TeamID == nil || *incident.Participants[1].TeamID != 255 {
		t.Fatalf("v2 incident summary = %+v", incident)
	}
	if got := incident.Participants[0].DamageAfter; len(got) != dto.IncidentDamageValues || got[0] != 42 || got[8] != 100 {
		t.Fatalf("v2 incident damage = %v, want front-left wing 42 and tyre RL 100", got)
	}
	if incident.Completeness.StoredFrameCount != 2 || incident.Completeness.CapturedFrameCount == nil || *incident.Completeness.CapturedFrameCount != 2 {
		t.Fatalf("v2 incident completeness = %+v", incident.Completeness)
	}
	if detail.SectionCompleteness.Events.StoredCount == nil || *detail.SectionCompleteness.Events.StoredCount != len(detail.Events) {
		t.Fatalf("event section does not match projected facts: %+v / events=%d", detail.SectionCompleteness.Events, len(detail.Events))
	}

	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal public detail: %v", err)
	}
	if strings.Contains(string(encoded), `"payload"`) || strings.Contains(string(encoded), `"frames"`) {
		t.Fatalf("detail leaked raw JSONB or eager incident frames: %s", encoded)
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("decode public detail: %v", err)
	}
	for _, key := range []string{"laps", "stints", "dynamics", "events", "incidents"} {
		if string(wire[key]) == "null" {
			t.Fatalf("%s serialized as null, want []", key)
		}
	}

	analysis, incidents, incidentCount := listCompleteness(record)
	if analysis.Status != string(dto.AvailabilityComplete) || incidents.StoredCount == nil || *incidents.StoredCount != 1 || incidentCount == nil || *incidentCount != 1 {
		t.Fatalf("list completeness = %+v/%+v/%v", analysis, incidents, incidentCount)
	}
}

func TestRaceAnalysisV2UnavailableDebriefPlaceholdersProjectNullFacts(t *testing.T) {
	request, record := goldenAnalysisRecord(t)
	for _, section := range []*UploadSectionCompleteness{
		&request.Detail.Completeness.Sections.Penalties,
		&request.Detail.Completeness.Sections.Tyres,
		&request.Detail.Completeness.Sections.Pit,
	} {
		section.Status = string(dto.AvailabilityUnavailable)
		section.Reasons = []string{string(dto.ReasonSourceMissing)}
	}
	request.Detail.Completeness.Analysis.Status = string(dto.AvailabilityPartial)
	payload, err := json.Marshal(request.Detail)
	if err != nil {
		t.Fatalf("marshal unavailable placeholders: %v", err)
	}
	payloadText := string(payload)
	record.Payload = &payloadText
	// A relational value cannot convert an unavailable v2 placeholder into a
	// public fact; validated v2 uploads cannot actually contain this mismatch,
	// but the read normalizer must stay honest for historical JSONB.
	detail := buildRaceAnalysisDetail(record, nil, &RaceAnalysisPitMeasurement{Stops: 1, PitLaneTimeMs: analysisInt(12_000), StationaryMs: analysisInt(2_000)})
	if detail.Penalties != nil || detail.Tyres != nil || detail.PitMeasurement != nil {
		t.Fatalf("unavailable placeholder facts = penalties:%+v tyres:%+v pit:%+v, want all null", detail.Penalties, detail.Tyres, detail.PitMeasurement)
	}
	for name, section := range map[string]RaceAnalysisSectionCompleteness{
		"penalties": detail.SectionCompleteness.Penalties,
		"tyres":     detail.SectionCompleteness.Tyres,
		"pit":       detail.SectionCompleteness.Pit,
	} {
		if section.StoredCount == nil || section.CapturedCount == nil || *section.StoredCount != 0 || *section.CapturedCount != 0 {
			t.Fatalf("%s public normalized count = %+v, want 0 recognized objects", name, section)
		}
	}
}

func TestRaceAnalysisV2BudgetDropAndFutureSchemaNormalization(t *testing.T) {
	request, record := goldenAnalysisRecord(t)
	request.Detail.Incidents = nil
	request.Detail.Completeness.Sections.Incidents.Status = string(dto.AvailabilityUnavailable)
	request.Detail.Completeness.Sections.Incidents.Reasons = []string{string(dto.ReasonRequestBudgetDropped)}
	*request.Detail.Completeness.Sections.Incidents.StoredCount = 0
	payload, err := json.Marshal(request.Detail)
	if err != nil {
		t.Fatalf("marshal dropped detail: %v", err)
	}
	payloadText := string(payload)
	record.Payload = &payloadText
	_, incidentSection, count := listCompleteness(record)
	if count == nil || *count != 0 || incidentSection.Status != string(dto.AvailabilityUnavailable) ||
		len(incidentSection.Reasons) != 1 || incidentSection.Reasons[0] != string(dto.ReasonRequestBudgetDropped) {
		t.Fatalf("budget-drop list facts = %+v/%v", incidentSection, count)
	}
	dropped := buildRaceAnalysisDetail(record, []RaceAnalysisLap{}, nil)
	if dropped.Incidents == nil || len(dropped.Incidents) != 0 || dropped.SectionCompleteness.Incidents.StoredCount == nil || *dropped.SectionCompleteness.Incidents.StoredCount != 0 {
		t.Fatalf("budget-drop detail = %+v", dropped)
	}

	futureVersion := 3
	futurePayload := `{"incidents":[{"secret":"must not be interpreted"}],"debrief":{"pit":{"stops":99}}}`
	future := record
	future.SchemaVersion = &futureVersion
	future.Payload = &futurePayload
	futureDetail := buildRaceAnalysisDetail(future, []RaceAnalysisLap{{LapNumber: 1, LapMs: 90_000}}, &RaceAnalysisPitMeasurement{Stops: 1, PitLaneTimeMs: analysisInt(12_000), StationaryMs: analysisInt(2_000)})
	if len(futureDetail.Incidents) != 0 || len(futureDetail.Events) != 0 || futureDetail.TrackOutline != nil ||
		futureDetail.SectionCompleteness.Dynamics.Status != string(dto.AvailabilityUnknown) ||
		len(futureDetail.SectionCompleteness.Dynamics.Reasons) != 1 || futureDetail.SectionCompleteness.Dynamics.Reasons[0] != string(dto.ReasonSchemaUnsupported) ||
		futureDetail.PitMeasurement == nil || futureDetail.PitMeasurement.Stops != 1 {
		t.Fatalf("future schema projection = %+v", futureDetail)
	}
}

func TestRaceAnalysisLegacyReplayStableSortAndUnknownFreshness(t *testing.T) {
	version := 1
	incident := UploadIncident{
		SessionTimeMs: 500, WindowStartMs: 0, FrameIntervalMs: 50, Collisions: [][2]int{{0, 1}},
		Participants: []UploadIncidentParticipant{{Idx: 0, TeamID: analysisInt(0), IsPlayer: true}, {Idx: 1, TeamID: analysisInt(255)}},
		Frames: []UploadIncidentFrame{
			{TMs: 100, Cars: [][]float64{{1}}},
			{TMs: 0, Cars: [][]float64{{2}, nil}},
			{TMs: 100, Cars: [][]float64{{3}}},
		},
	}
	replay := mapIncidentReplay("race", 0, &version, incident, true)
	if len(replay.Frames) != 3 || replay.Frames[0].TMs != 0 || replay.Frames[1].TMs != 100 || replay.Frames[2].TMs != 100 ||
		replay.Frames[1].Cars[0][0] != 1 || replay.Frames[2].Cars[0][0] != 3 {
		t.Fatalf("legacy stable frame sort = %+v", replay.Frames)
	}
	if replay.Frames[0].TelemetryUnavailable != nil {
		t.Fatalf("legacy freshness = %v, want null", replay.Frames[0].TelemetryUnavailable)
	}
	if replay.Participants[0].TeamID != nil || replay.Participants[1].TeamID != nil || replay.Completeness.Status != string(dto.AvailabilityUnknown) {
		t.Fatalf("legacy normalization = %+v / %+v", replay.Participants, replay.Completeness)
	}
}

func TestRaceAnalysisReadNormalizesEmptyArrays(t *testing.T) {
	version := 1
	legacy := mapIncidentReplay("race", 0, &version, UploadIncident{
		Frames: []UploadIncidentFrame{{TMs: 1, Cars: [][]float64{{}}}},
	}, true)
	encodedReplay, err := json.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal replay: %v", err)
	}
	if strings.Contains(string(encodedReplay), `"collisions":null`) || strings.Contains(string(encodedReplay), `"cars":[null]`) {
		t.Fatalf("legacy replay serialized a collection as null: %s", encodedReplay)
	}

	legacyRecord := raceAnalysisRecord{ID: "legacy", UploadedAt: time.Now(), SchemaVersion: &version}
	encodedDetail, err := json.Marshal(buildRaceAnalysisDetail(legacyRecord, nil, nil))
	if err != nil {
		t.Fatalf("marshal legacy detail: %v", err)
	}
	if strings.Contains(string(encodedDetail), `"laps":null`) {
		t.Fatalf("legacy detail serialized laps as null: %s", encodedDetail)
	}
}

func TestRaceAnalysisChildQueriesAreOwnerScoped(t *testing.T) {
	for _, test := range []struct {
		name       string
		query      string
		childTable string
		join       string
		ownerWhere string
	}{
		{
			name:       "laps",
			query:      raceAnalysisLapsQuery,
			childTable: "platform.laps l",
			join:       "JOIN platform.races r ON r.id = l.race_id",
			ownerWhere: "WHERE l.race_id = $1 AND r.account_id = $2",
		},
		{
			name:       "pit",
			query:      raceAnalysisPitQuery,
			childTable: "platform.race_pit_loss p",
			join:       "JOIN platform.races r ON r.id = p.race_id",
			ownerWhere: "WHERE p.race_id = $1 AND r.account_id = $2",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, wanted := range []string{test.childTable, test.join, test.ownerWhere} {
				if !strings.Contains(test.query, wanted) {
					t.Fatalf("owner-scoped query missing %q:\n%s", wanted, test.query)
				}
			}
		})
	}
}

func TestRaceAnalysisOwnerScopedStoreReadIntegration(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner, err := store.UpsertSteamAccount(ctx, steamA, "Race Analysis Owner", "")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	other, err := store.UpsertSteamAccount(ctx, steamB, "Race Analysis Other", "")
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	_, request := readRaceAnalysisV2Fixture(t)
	result, err := store.IngestRace(ctx, owner, request)
	if err != nil {
		t.Fatalf("ingest golden v2 race: %v", err)
	}

	list, err := store.ListMyRaceAnalyses(ctx, owner, 50, 0)
	if err != nil || len(list.Items) != 1 || list.Items[0].ID != result.RaceID || list.Items[0].IncidentCount == nil || *list.Items[0].IncidentCount != 1 {
		t.Fatalf("owner analysis list = %+v / %v", list, err)
	}
	detail, err := store.GetMyRaceAnalysis(ctx, owner, result.RaceID)
	if err != nil || len(detail.Laps) != 1 || len(detail.Incidents) != 1 || detail.Incidents[0].FrameCount != 2 {
		t.Fatalf("owner analysis detail = %+v / %v", detail, err)
	}
	incident, err := store.GetMyRaceAnalysisIncident(ctx, owner, result.RaceID, 0)
	if err != nil || len(incident.Frames) != 2 || incident.Frames[0].TelemetryUnavailable == nil {
		t.Fatalf("owner incident replay = %+v / %v", incident, err)
	}
	if _, err := store.GetMyRaceAnalysis(ctx, other, result.RaceID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign owner detail err = %v, want ErrNotFound", err)
	}
	if _, err := store.GetMyRaceAnalysisIncident(ctx, other, result.RaceID, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign owner incident err = %v, want ErrNotFound", err)
	}
}

func stringPtr(value string) *string { return &value }

func TestIncidentParticipantDamageAlwaysSerializesKeys(t *testing.T) {
	encoded, err := json.Marshal(mapIncidentParticipants([]UploadIncidentParticipant{{Idx: 3, DamageAfter: []int{}}}, false))
	if err != nil {
		t.Fatalf("marshal participants: %v", err)
	}
	if got := string(encoded); !strings.Contains(got, `"damageBefore":null`) || !strings.Contains(got, `"damageAfter":null`) {
		t.Fatalf("missing damage snapshots must serialize as null: %s", got)
	}
}
