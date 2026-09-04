package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"frc.engineer/internal/dto"
)

// RaceAnalysisSectionCompleteness is the public read model for a single
// analysis section. It deliberately contains no raw JSONB and normalizes every
// reasons slice to [] for stable clients.
type RaceAnalysisSectionCompleteness struct {
	Status        string   `json:"status"`
	Reasons       []string `json:"reasons"`
	CapturedCount *int     `json:"capturedCount"`
	StoredCount   *int     `json:"storedCount"`
}

type RaceAnalysisTrack struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type RaceAnalysisListItem struct {
	ID             string                       `json:"id"`
	Track          RaceAnalysisTrack            `json:"track"`
	SessionType    string                       `json:"sessionType"`
	GameFormat     string                       `json:"gameFormat"`
	RecordedAt     *string                      `json:"recordedAt"`
	UploadedAt     string                       `json:"uploadedAt"`
	FinishPosition *int                         `json:"finishPosition"`
	CompletedLaps  *int                         `json:"completedLaps"`
	BestLapMs      *int                         `json:"bestLapMs"`
	SchemaVersion  *int                         `json:"schemaVersion"`
	IncidentCount  *int                         `json:"incidentCount"`
	Completeness   RaceAnalysisListCompleteness `json:"completeness"`
}

type RaceAnalysisListCompleteness struct {
	Analysis  RaceAnalysisSectionCompleteness `json:"analysis"`
	Incidents RaceAnalysisSectionCompleteness `json:"incidents"`
}

type RaceAnalysisListResponse struct {
	Items      []RaceAnalysisListItem `json:"items"`
	NextOffset *int                   `json:"nextOffset"`
}

type RaceAnalysisLap struct {
	LapNumber int     `json:"lapNumber"`
	LapMs     int     `json:"lapMs"`
	S1Ms      *int    `json:"s1Ms"`
	S2Ms      *int    `json:"s2Ms"`
	S3Ms      *int    `json:"s3Ms"`
	Tyre      *string `json:"tyre"`
	Valid     bool    `json:"valid"`
}

type RaceAnalysisStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    *int   `json:"startLap"`
	EndLap      *int   `json:"endLap"`
	TireWearPct *int   `json:"tireWearPct"`
}

type RaceAnalysisDynamic struct {
	LapNumber     int     `json:"lapNumber"`
	UndersteerPct float64 `json:"understeerPct"`
	OversteerPct  float64 `json:"oversteerPct"`
	LockupCount   int     `json:"lockupCount"`
	SpinCount     int     `json:"spinCount"`
}

type RaceAnalysisPenalties struct {
	TimePenaltySeconds   int `json:"timePenaltySeconds"`
	Warnings             int `json:"warnings"`
	CornerCutWarnings    int `json:"cornerCutWarnings"`
	UnservedDriveThrough int `json:"unservedDriveThrough"`
	UnservedStopGo       int `json:"unservedStopGo"`
}

type RaceAnalysisTyres struct {
	FinalCompound    *string `json:"finalCompound"`
	FinalAge         *int    `json:"finalAge"`
	AverageWearPct   *int    `json:"averageWearPct"`
	PeakWearPct      *int    `json:"peakWearPct"`
	FinalSetWearPct  *int    `json:"finalSetWearPct"`
	LifeSpan         *int    `json:"lifeSpan"`
	UsableLife       *int    `json:"usableLife"`
	LifeRemainingPct *int    `json:"lifeRemainingPct"`
}

type RaceAnalysisEvent struct {
	Lap        *int    `json:"lap"`
	Timestamp  *int64  `json:"timestamp"`
	Category   string  `json:"category"`
	Severity   string  `json:"severity"`
	Message    string  `json:"message"`
	DriverName *string `json:"driverName"`
}

type RaceAnalysisPitMeasurement struct {
	Stops         int  `json:"stops"`
	PitLaneTimeMs *int `json:"pitLaneTimeMs"`
	StationaryMs  *int `json:"stationaryMs"`
}

type RaceAnalysisTrackOutline struct {
	Points [][2]float64                   `json:"points"`
	Bounds RaceAnalysisTrackOutlineBounds `json:"bounds"`
}

type RaceAnalysisTrackOutlineBounds struct {
	MinX float64 `json:"minX"`
	MaxX float64 `json:"maxX"`
	MinZ float64 `json:"minZ"`
	MaxZ float64 `json:"maxZ"`
}

type RaceAnalysisIncidentParticipant struct {
	Idx      int     `json:"idx"`
	Name     string  `json:"name"`
	TeamID   *int    `json:"teamId"`
	IsPlayer bool    `json:"isPlayer"`
	MinDistM float64 `json:"minDistM"`
}

type RaceAnalysisIncidentCompleteness struct {
	Status                   string   `json:"status"`
	Reasons                  []string `json:"reasons"`
	CapturedParticipantCount *int     `json:"capturedParticipantCount"`
	StoredParticipantCount   int      `json:"storedParticipantCount"`
	CapturedFrameCount       *int     `json:"capturedFrameCount"`
	StoredFrameCount         int      `json:"storedFrameCount"`
}

type RaceAnalysisIncidentSummary struct {
	Index           int                               `json:"index"`
	SessionTimeMs   int64                             `json:"sessionTimeMs"`
	WindowStartMs   int64                             `json:"windowStartMs"`
	FrameIntervalMs int                               `json:"frameIntervalMs"`
	Lap             *int                              `json:"lap"`
	Collisions      [][2]int                          `json:"collisions"`
	Participants    []RaceAnalysisIncidentParticipant `json:"participants"`
	FrameCount      int                               `json:"frameCount"`
	Completeness    RaceAnalysisIncidentCompleteness  `json:"completeness"`
}

type RaceAnalysisDetailSections struct {
	Laps         RaceAnalysisSectionCompleteness `json:"laps"`
	Sectors      RaceAnalysisSectionCompleteness `json:"sectors"`
	Stints       RaceAnalysisSectionCompleteness `json:"stints"`
	Tyres        RaceAnalysisSectionCompleteness `json:"tyres"`
	Dynamics     RaceAnalysisSectionCompleteness `json:"dynamics"`
	Penalties    RaceAnalysisSectionCompleteness `json:"penalties"`
	Events       RaceAnalysisSectionCompleteness `json:"events"`
	Pit          RaceAnalysisSectionCompleteness `json:"pit"`
	TrackOutline RaceAnalysisSectionCompleteness `json:"trackOutline"`
	Incidents    RaceAnalysisSectionCompleteness `json:"incidents"`
}

type RaceAnalysisDetail struct {
	ID                  string                        `json:"id"`
	Track               RaceAnalysisTrack             `json:"track"`
	SessionType         string                        `json:"sessionType"`
	GameFormat          string                        `json:"gameFormat"`
	RecordedAt          *string                       `json:"recordedAt"`
	UploadedAt          string                        `json:"uploadedAt"`
	FinishPosition      *int                          `json:"finishPosition"`
	CompletedLaps       *int                          `json:"completedLaps"`
	BestLapMs           *int                          `json:"bestLapMs"`
	SchemaVersion       *int                          `json:"schemaVersion"`
	Laps                []RaceAnalysisLap             `json:"laps"`
	Stints              []RaceAnalysisStint           `json:"stints"`
	Dynamics            []RaceAnalysisDynamic         `json:"dynamics"`
	Penalties           *RaceAnalysisPenalties        `json:"penalties"`
	Tyres               *RaceAnalysisTyres            `json:"tyres"`
	Events              []RaceAnalysisEvent           `json:"events"`
	PitMeasurement      *RaceAnalysisPitMeasurement   `json:"pitMeasurement"`
	TrackOutline        *RaceAnalysisTrackOutline     `json:"trackOutline"`
	Incidents           []RaceAnalysisIncidentSummary `json:"incidents"`
	SectionCompleteness RaceAnalysisDetailSections    `json:"sectionCompleteness"`
}

type RaceAnalysisIncidentFrame struct {
	TMs                  int64       `json:"tMs"`
	Cars                 [][]float64 `json:"cars"`
	TelemetryUnavailable []int       `json:"telemetryUnavailable"`
}

type RaceAnalysisIncidentReplay struct {
	RaceID          string                            `json:"raceId"`
	Index           int                               `json:"index"`
	SchemaVersion   *int                              `json:"schemaVersion"`
	SessionTimeMs   int64                             `json:"sessionTimeMs"`
	WindowStartMs   int64                             `json:"windowStartMs"`
	FrameIntervalMs int                               `json:"frameIntervalMs"`
	Lap             *int                              `json:"lap"`
	Collisions      [][2]int                          `json:"collisions"`
	Participants    []RaceAnalysisIncidentParticipant `json:"participants"`
	Frames          []RaceAnalysisIncidentFrame       `json:"frames"`
	Completeness    RaceAnalysisIncidentCompleteness  `json:"completeness"`
}

type raceAnalysisRecord struct {
	ID             string
	TrackID        int
	TrackName      string
	SessionType    string
	GameFormat     string
	RecordedAt     *time.Time
	UploadedAt     time.Time
	FinishPosition *int
	CompletedLaps  *int
	BestLapMs      *int
	SchemaVersion  *int
	Payload        *string
	LapCount       int
}

// ListMyRaceAnalyses lists every owner race, not just plausible marketplace
// races. It uses the fixed product ordering and limit+1 pagination contract.
func (s *Store) ListMyRaceAnalyses(ctx context.Context, accountID string, limit, offset int) (*RaceAnalysisListResponse, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id::text, r.track_id, r.track_name, r.session_type, r.game_format,
		       r.recorded_at, r.uploaded_at, r.finish_position, r.completed_laps, r.best_lap_ms,
		       rd.schema_version, rd.payload::text,
		       (SELECT count(*) FROM platform.laps l WHERE l.race_id = r.id) AS lap_count
		FROM platform.races r
		LEFT JOIN platform.race_detail rd ON rd.race_id = r.id
		WHERE r.account_id = $1
		ORDER BY r.recorded_at DESC NULLS LAST, r.uploaded_at DESC, r.id DESC
		LIMIT $2 OFFSET $3`, accountID, limit+1, offset)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list race analyses: %w", err)
	}
	defer rows.Close()
	items := make([]RaceAnalysisListItem, 0, limit)
	for rows.Next() {
		record, err := scanRaceAnalysisRecord(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, listAnalysisItem(record))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: iterate race analyses: %w", err)
	}
	var nextOffset *int
	if len(items) > limit {
		items = items[:limit]
		next := offset + limit
		nextOffset = &next
	}
	return &RaceAnalysisListResponse{Items: items, NextOffset: nextOffset}, nil
}

func (s *Store) GetMyRaceAnalysis(ctx context.Context, accountID, raceID string) (*RaceAnalysisDetail, error) {
	record, err := s.raceAnalysisRecord(ctx, accountID, raceID)
	if err != nil {
		return nil, err
	}
	laps, err := s.raceAnalysisLaps(ctx, accountID, raceID)
	if err != nil {
		return nil, err
	}
	pit, err := s.raceAnalysisPit(ctx, accountID, raceID)
	if err != nil {
		return nil, err
	}
	return buildRaceAnalysisDetail(record, laps, pit), nil
}

// GetMyRaceAnalysisIncident returns a single lazy-loaded replay. It repeats the
// owner predicate in raceAnalysisRecord so absent/malformed/foreign ids remain
// indistinguishable at the HTTP boundary.
func (s *Store) GetMyRaceAnalysisIncident(ctx context.Context, accountID, raceID string, index int) (*RaceAnalysisIncidentReplay, error) {
	record, err := s.raceAnalysisRecord(ctx, accountID, raceID)
	if err != nil {
		return nil, err
	}
	if index < 0 || index >= 20 || record.SchemaVersion == nil || record.Payload == nil || *record.SchemaVersion > 2 {
		return nil, ErrNotFound
	}
	detail, ok := decodeAnalysisDetail(record)
	if !ok || index >= len(detail.Incidents) {
		return nil, ErrNotFound
	}
	incident := detail.Incidents[index]
	legacy := *record.SchemaVersion < 2
	return mapIncidentReplay(record.ID, index, record.SchemaVersion, incident, legacy), nil
}

func (s *Store) raceAnalysisRecord(ctx context.Context, accountID, raceID string) (raceAnalysisRecord, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT r.id::text, r.track_id, r.track_name, r.session_type, r.game_format,
		       r.recorded_at, r.uploaded_at, r.finish_position, r.completed_laps, r.best_lap_ms,
		       rd.schema_version, rd.payload::text,
		       (SELECT count(*) FROM platform.laps l WHERE l.race_id = r.id) AS lap_count
		FROM platform.races r
		LEFT JOIN platform.race_detail rd ON rd.race_id = r.id
		WHERE r.id = $1 AND r.account_id = $2`, raceID, accountID)
	record, err := scanRaceAnalysisRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return raceAnalysisRecord{}, ErrNotFound
	}
	if err != nil {
		return raceAnalysisRecord{}, err
	}
	return record, nil
}

type raceAnalysisScanner interface {
	Scan(...any) error
}

func scanRaceAnalysisRecord(scanner raceAnalysisScanner) (raceAnalysisRecord, error) {
	var record raceAnalysisRecord
	if err := scanner.Scan(
		&record.ID, &record.TrackID, &record.TrackName, &record.SessionType, &record.GameFormat,
		&record.RecordedAt, &record.UploadedAt, &record.FinishPosition, &record.CompletedLaps, &record.BestLapMs,
		&record.SchemaVersion, &record.Payload, &record.LapCount,
	); err != nil {
		return raceAnalysisRecord{}, fmt.Errorf("platformsvc: scan race analysis: %w", err)
	}
	return record, nil
}

const raceAnalysisLapsQuery = `
	SELECT lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid
	FROM platform.laps l
	JOIN platform.races r ON r.id = l.race_id
	WHERE l.race_id = $1 AND r.account_id = $2
	ORDER BY l.lap_number`

const raceAnalysisPitQuery = `
	SELECT stops, pit_lane_time_ms, stationary_ms
	FROM platform.race_pit_loss p
	JOIN platform.races r ON r.id = p.race_id
	WHERE p.race_id = $1 AND r.account_id = $2`

func (s *Store) raceAnalysisLaps(ctx context.Context, accountID, raceID string) ([]RaceAnalysisLap, error) {
	rows, err := s.pool.Query(ctx, raceAnalysisLapsQuery, raceID, accountID)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list analysis laps: %w", err)
	}
	defer rows.Close()
	laps := []RaceAnalysisLap{}
	for rows.Next() {
		var lap RaceAnalysisLap
		var s1, s2, s3 int
		var tyre string
		if err := rows.Scan(&lap.LapNumber, &lap.LapMs, &s1, &s2, &s3, &tyre, &lap.Valid); err != nil {
			return nil, fmt.Errorf("platformsvc: scan analysis lap: %w", err)
		}
		lap.S1Ms = nullablePositiveInt(s1)
		lap.S2Ms = nullablePositiveInt(s2)
		lap.S3Ms = nullablePositiveInt(s3)
		lap.Tyre = nullableString(tyre)
		laps = append(laps, lap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: iterate analysis laps: %w", err)
	}
	return laps, nil
}

func (s *Store) raceAnalysisPit(ctx context.Context, accountID, raceID string) (*RaceAnalysisPitMeasurement, error) {
	var pit RaceAnalysisPitMeasurement
	var pitLaneTimeMS, stationaryMS int
	err := s.pool.QueryRow(ctx, raceAnalysisPitQuery, raceID, accountID).Scan(&pit.Stops, &pitLaneTimeMS, &stationaryMS)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: analysis pit: %w", err)
	}
	pit.PitLaneTimeMs = &pitLaneTimeMS
	pit.StationaryMs = &stationaryMS
	return &pit, nil
}

func listAnalysisItem(record raceAnalysisRecord) RaceAnalysisListItem {
	analysis, incidents, incidentCount := listCompleteness(record)
	return RaceAnalysisListItem{
		ID: record.ID, Track: RaceAnalysisTrack{ID: record.TrackID, Name: record.TrackName},
		SessionType: record.SessionType, GameFormat: record.GameFormat, RecordedAt: timeString(record.RecordedAt),
		UploadedAt: record.UploadedAt.UTC().Format(time.RFC3339), FinishPosition: copyInt(record.FinishPosition),
		CompletedLaps: completedLaps(record), BestLapMs: copyInt(record.BestLapMs), SchemaVersion: copyInt(record.SchemaVersion),
		IncidentCount: incidentCount, Completeness: RaceAnalysisListCompleteness{Analysis: analysis, Incidents: incidents},
	}
}

func listCompleteness(record raceAnalysisRecord) (RaceAnalysisSectionCompleteness, RaceAnalysisSectionCompleteness, *int) {
	if record.SchemaVersion == nil || *record.SchemaVersion < 2 {
		unknown := legacySection()
		return unknown, unknown, nil
	}
	if *record.SchemaVersion > 2 {
		unknown := unsupportedSection()
		return unknown, unknown, nil
	}
	detail, ok := decodeAnalysisDetail(record)
	if !ok || detail.Completeness == nil {
		unavailable := unavailableSection()
		return unavailable, unavailable, nil
	}
	analysis := mapSectionCompleteness(detail.Completeness.Analysis)
	incidents := mapSectionCompleteness(detail.Completeness.Sections.Incidents)
	return analysis, incidents, copyInt(incidents.StoredCount)
}

func buildRaceAnalysisDetail(record raceAnalysisRecord, laps []RaceAnalysisLap, pit *RaceAnalysisPitMeasurement) *RaceAnalysisDetail {
	if laps == nil {
		laps = []RaceAnalysisLap{}
	}
	detail := &RaceAnalysisDetail{
		ID: record.ID, Track: RaceAnalysisTrack{ID: record.TrackID, Name: record.TrackName},
		SessionType: record.SessionType, GameFormat: record.GameFormat, RecordedAt: timeString(record.RecordedAt),
		UploadedAt: record.UploadedAt.UTC().Format(time.RFC3339), FinishPosition: copyInt(record.FinishPosition),
		CompletedLaps: completedLaps(record), BestLapMs: copyInt(record.BestLapMs), SchemaVersion: copyInt(record.SchemaVersion),
		Laps: laps, Stints: []RaceAnalysisStint{}, Dynamics: []RaceAnalysisDynamic{}, Events: []RaceAnalysisEvent{}, Incidents: []RaceAnalysisIncidentSummary{},
	}
	if record.SchemaVersion == nil || *record.SchemaVersion < 2 {
		populateLegacyDetail(detail, record, pit)
		return detail
	}
	if *record.SchemaVersion > 2 {
		detail.SectionCompleteness = unsupportedSections()
		if pit != nil {
			detail.PitMeasurement = pit
			detail.SectionCompleteness.Pit = partialRelationalPitSection()
		}
		return detail
	}
	uploadDetail, ok := decodeAnalysisDetail(record)
	if !ok || uploadDetail.Completeness == nil {
		detail.SectionCompleteness = unavailableSections()
		return detail
	}
	populateProjectedDetail(detail, uploadDetail, false)
	detail.SectionCompleteness = mapDetailSections(uploadDetail.Completeness.Sections)
	if uploadDetail.Debrief != nil {
		if detail.SectionCompleteness.Penalties.Status != string(dto.AvailabilityUnavailable) {
			detail.Penalties = mapPenalties(uploadDetail.Debrief.Penalties)
		} else {
			normalizeUnavailableObjectSection(&detail.SectionCompleteness.Penalties)
		}
		if detail.SectionCompleteness.Tyres.Status != string(dto.AvailabilityUnavailable) {
			detail.Tyres = mapTyres(uploadDetail.Debrief.Tyres)
		} else {
			normalizeUnavailableObjectSection(&detail.SectionCompleteness.Tyres)
		}
		if detail.SectionCompleteness.Pit.Status != string(dto.AvailabilityUnavailable) {
			detail.PitMeasurement = &RaceAnalysisPitMeasurement{Stops: uploadDetail.Debrief.Pit.Stops}
		} else {
			normalizeUnavailableObjectSection(&detail.SectionCompleteness.Pit)
		}
	}
	if pit != nil && detail.SectionCompleteness.Pit.Status != string(dto.AvailabilityUnavailable) {
		if detail.PitMeasurement == nil {
			detail.PitMeasurement = pit
		} else {
			detail.PitMeasurement.PitLaneTimeMs = copyInt(pit.PitLaneTimeMs)
			detail.PitMeasurement.StationaryMs = copyInt(pit.StationaryMs)
		}
	}
	return detail
}

// normalizeUnavailableObjectSection makes the public count unit match the
// normalized public fact. V2 uploads retain a required debrief envelope with
// object count 1 even when its source was absent; the owner API intentionally
// projects that placeholder as null, so it has zero recognized public objects.
func normalizeUnavailableObjectSection(section *RaceAnalysisSectionCompleteness) {
	if section == nil || section.Status != string(dto.AvailabilityUnavailable) {
		return
	}
	zero := 0
	section.CapturedCount = &zero
	section.StoredCount = &zero
}

func populateLegacyDetail(detail *RaceAnalysisDetail, record raceAnalysisRecord, pit *RaceAnalysisPitMeasurement) {
	detail.SectionCompleteness = legacySections()
	uploadDetail, ok := decodeAnalysisDetail(record)
	if ok {
		populateProjectedDetail(detail, uploadDetail, true)
	}
	if pit != nil {
		detail.PitMeasurement = pit
		detail.SectionCompleteness.Pit = partialRelationalPitSection()
	}
}

func populateProjectedDetail(detail *RaceAnalysisDetail, source UploadDetail, legacy bool) {
	for _, stint := range source.Stints {
		detail.Stints = append(detail.Stints, RaceAnalysisStint{
			Compound: stint.Compound, Laps: stint.Laps, StartLap: nullablePositiveInt(stint.StartLap),
			EndLap: nullablePositiveInt(stint.EndLap), TireWearPct: nullablePositiveInt(stint.TireWearPct),
		})
	}
	for _, dynamic := range source.Dynamics {
		detail.Dynamics = append(detail.Dynamics, RaceAnalysisDynamic{
			LapNumber: dynamic.LapNum, UndersteerPct: dynamic.UndersteerPct, OversteerPct: dynamic.OversteerPct,
			LockupCount: dynamic.LockupCount, SpinCount: dynamic.SpinCount,
		})
	}
	for _, event := range source.Events {
		detail.Events = append(detail.Events, RaceAnalysisEvent{
			Lap: nullablePositiveInt(event.Lap), Timestamp: nullablePositiveInt64(event.Timestamp),
			Category: event.Category, Severity: event.Severity, Message: event.Message, DriverName: nullableString(event.DriverName),
		})
	}
	if source.TrackOutline != nil {
		detail.TrackOutline = &RaceAnalysisTrackOutline{
			Points: append([][2]float64{}, source.TrackOutline.Points...),
			Bounds: RaceAnalysisTrackOutlineBounds{MinX: source.TrackOutline.Bounds.MinX, MaxX: source.TrackOutline.Bounds.MaxX, MinZ: source.TrackOutline.Bounds.MinZ, MaxZ: source.TrackOutline.Bounds.MaxZ},
		}
	}
	for index, incident := range source.Incidents {
		detail.Incidents = append(detail.Incidents, mapIncidentSummary(index, incident, legacy))
	}
}

func mapIncidentSummary(index int, incident UploadIncident, legacy bool) RaceAnalysisIncidentSummary {
	participants := mapIncidentParticipants(incident.Participants, legacy)
	completeness := mapReplayCompleteness(incident.Completeness, len(participants), len(incident.Frames), legacy)
	return RaceAnalysisIncidentSummary{
		Index: index, SessionTimeMs: incident.SessionTimeMs, WindowStartMs: incident.WindowStartMs, FrameIntervalMs: incident.FrameIntervalMs,
		Lap: nullablePositiveInt(incident.Lap), Collisions: append([][2]int{}, incident.Collisions...), Participants: participants,
		FrameCount: len(incident.Frames), Completeness: completeness,
	}
}

func mapIncidentReplay(raceID string, index int, schemaVersion *int, incident UploadIncident, legacy bool) *RaceAnalysisIncidentReplay {
	frames := append([]UploadIncidentFrame(nil), incident.Frames...)
	if legacy {
		sort.SliceStable(frames, func(i, j int) bool { return frames[i].TMs < frames[j].TMs })
	}
	out := &RaceAnalysisIncidentReplay{
		RaceID: raceID, Index: index, SchemaVersion: copyInt(schemaVersion), SessionTimeMs: incident.SessionTimeMs,
		WindowStartMs: incident.WindowStartMs, FrameIntervalMs: incident.FrameIntervalMs, Lap: nullablePositiveInt(incident.Lap),
		Collisions: append([][2]int{}, incident.Collisions...), Participants: mapIncidentParticipants(incident.Participants, legacy),
		Frames: []RaceAnalysisIncidentFrame{}, Completeness: mapReplayCompleteness(incident.Completeness, len(incident.Participants), len(frames), legacy),
	}
	for _, frame := range frames {
		cars := make([][]float64, len(frame.Cars))
		for i, car := range frame.Cars {
			if car != nil {
				cars[i] = append([]float64{}, car...)
			}
		}
		result := RaceAnalysisIncidentFrame{TMs: frame.TMs, Cars: cars}
		if !legacy {
			result.TelemetryUnavailable = append([]int{}, frame.TelemetryUnavailable...)
		}
		out.Frames = append(out.Frames, result)
	}
	return out
}

func mapIncidentParticipants(source []UploadIncidentParticipant, legacy bool) []RaceAnalysisIncidentParticipant {
	out := make([]RaceAnalysisIncidentParticipant, 0, len(source))
	for _, participant := range source {
		teamID := copyInt(participant.TeamID)
		if legacy {
			teamID = nil
		}
		out = append(out, RaceAnalysisIncidentParticipant{
			Idx: participant.Idx, Name: participant.Name, TeamID: teamID, IsPlayer: participant.IsPlayer, MinDistM: participant.MinDistM,
		})
	}
	return out
}

func mapReplayCompleteness(source *UploadIncidentCompleteness, participants, frames int, legacy bool) RaceAnalysisIncidentCompleteness {
	if legacy || source == nil {
		return RaceAnalysisIncidentCompleteness{
			Status: string("unknown"), Reasons: []string{string("legacy-metadata-missing")},
			StoredParticipantCount: participants, StoredFrameCount: frames,
		}
	}
	return RaceAnalysisIncidentCompleteness{
		Status: source.Status, Reasons: copyStrings(source.Reasons), CapturedParticipantCount: copyInt(source.CapturedParticipantCount),
		StoredParticipantCount: source.StoredParticipantCount, CapturedFrameCount: copyInt(source.CapturedFrameCount), StoredFrameCount: source.StoredFrameCount,
	}
}

func mapPenalties(source UploadPenaltyDebrief) *RaceAnalysisPenalties {
	return &RaceAnalysisPenalties{
		TimePenaltySeconds: source.TimePenaltySeconds, Warnings: source.Warnings, CornerCutWarnings: source.CornerCutWarnings,
		UnservedDriveThrough: source.UnservedDriveThrough, UnservedStopGo: source.UnservedStopGo,
	}
}

func mapTyres(source UploadTyreDebrief) *RaceAnalysisTyres {
	return &RaceAnalysisTyres{
		FinalCompound: copyString(source.FinalCompound), FinalAge: copyInt(source.FinalAge), AverageWearPct: copyInt(source.AverageWearPct),
		PeakWearPct: copyInt(source.PeakWearPct), FinalSetWearPct: copyInt(source.FinalSetWearPct), LifeSpan: copyInt(source.LifeSpan),
		UsableLife: copyInt(source.UsableLife), LifeRemainingPct: copyInt(source.LifeRemainingPct),
	}
}

func decodeAnalysisDetail(record raceAnalysisRecord) (UploadDetail, bool) {
	if record.Payload == nil {
		return UploadDetail{}, false
	}
	var detail UploadDetail
	if err := json.Unmarshal([]byte(*record.Payload), &detail); err != nil {
		return UploadDetail{}, false
	}
	return detail, true
}

func mapDetailSections(source UploadCompletenessSections) RaceAnalysisDetailSections {
	return RaceAnalysisDetailSections{
		Laps: mapSectionCompleteness(source.Laps), Sectors: mapSectionCompleteness(source.Sectors),
		Stints: mapSectionCompleteness(source.Stints), Tyres: mapSectionCompleteness(source.Tyres),
		Dynamics: mapSectionCompleteness(source.Dynamics), Penalties: mapSectionCompleteness(source.Penalties),
		Events: mapSectionCompleteness(source.Events), Pit: mapSectionCompleteness(source.Pit),
		TrackOutline: mapSectionCompleteness(source.TrackOutline), Incidents: mapSectionCompleteness(source.Incidents),
	}
}

func mapSectionCompleteness(source UploadSectionCompleteness) RaceAnalysisSectionCompleteness {
	return RaceAnalysisSectionCompleteness{
		Status: source.Status, Reasons: copyStrings(source.Reasons), CapturedCount: copyInt(source.CapturedCount), StoredCount: copyInt(source.StoredCount),
	}
}

func legacySection() RaceAnalysisSectionCompleteness {
	return RaceAnalysisSectionCompleteness{Status: "unknown", Reasons: []string{"legacy-metadata-missing"}}
}

func unsupportedSection() RaceAnalysisSectionCompleteness {
	return RaceAnalysisSectionCompleteness{Status: "unknown", Reasons: []string{"schema-unsupported"}}
}

func unavailableSection() RaceAnalysisSectionCompleteness {
	return RaceAnalysisSectionCompleteness{Status: "unavailable", Reasons: []string{"source-missing"}}
}

func legacySections() RaceAnalysisDetailSections {
	section := legacySection()
	return RaceAnalysisDetailSections{Laps: section, Sectors: section, Stints: section, Tyres: section, Dynamics: section, Penalties: section, Events: section, Pit: section, TrackOutline: section, Incidents: section}
}

func unsupportedSections() RaceAnalysisDetailSections {
	section := unsupportedSection()
	return RaceAnalysisDetailSections{Laps: section, Sectors: section, Stints: section, Tyres: section, Dynamics: section, Penalties: section, Events: section, Pit: section, TrackOutline: section, Incidents: section}
}

func unavailableSections() RaceAnalysisDetailSections {
	section := unavailableSection()
	return RaceAnalysisDetailSections{Laps: section, Sectors: section, Stints: section, Tyres: section, Dynamics: section, Penalties: section, Events: section, Pit: section, TrackOutline: section, Incidents: section}
}

func partialRelationalPitSection() RaceAnalysisSectionCompleteness {
	return RaceAnalysisSectionCompleteness{Status: "partial", Reasons: []string{"legacy-metadata-missing"}}
}

func completedLaps(record raceAnalysisRecord) *int {
	if record.CompletedLaps != nil {
		return copyInt(record.CompletedLaps)
	}
	if record.LapCount > 0 {
		count := record.LapCount
		return &count
	}
	return nil
}

func timeString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func nullablePositiveInt(value int) *int {
	if value == 0 {
		return nil
	}
	copyValue := value
	return &copyValue
}

func nullablePositiveInt64(value int64) *int64 {
	if value == 0 {
		return nil
	}
	copyValue := value
	return &copyValue
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	copyValue := value
	return &copyValue
}

func copyInt[T ~int | ~int64](value *T) *T {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func copyString(value *string) *string {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func copyStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}
