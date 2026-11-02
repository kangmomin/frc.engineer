package races

import (
	"strings"
	"time"

	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
)

// NotificationCounts tracks race control notifications emitted for the player.
type NotificationCounts struct {
	Penalty int `json:"penalty"`
	Warning int `json:"warning"`
	Info    int `json:"info"`
}

// RaceSummarySchemaVersion is the single document version stamped on every
// persisted summary. Bump when the summary/Detail structure changes so readers can
// discriminate. 0 = legacy (pre-versioning, no Detail); 1 = rich Detail; 2 =
// explicit analysis completeness, identity/freshness fields, and restart metadata.
const RaceSummarySchemaVersion = 2

// RaceSummary is the persisted, non-raw race result snapshot. SchemaVersion is
// always emitted (a single document version is an explicit signal, so readers
// never have to guess). GameFormat and Detail are the rich, player-centric
// enrichments; GameFormat in particular is the leaderboard/market partition key,
// so it must be present from v1 (the local JSON is immutable history).
type RaceSummary struct {
	ID              string                   `json:"id"`
	SchemaVersion   int                      `json:"schemaVersion"`
	SavedAtLocal    string                   `json:"savedAtLocal"`
	SessionUID      uint64                   `json:"sessionUID"`
	DataStorageMode rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	GameFormat      string                   `json:"gameFormat,omitempty"`
	Track           TrackInfo                `json:"track"`
	Session         SessionSummary           `json:"session"`
	Player          PlayerSummary            `json:"player"`
	Drivers         []DriverSummary          `json:"drivers"`
	Highlights      RaceHighlights           `json:"highlights"`
	Debrief         *RaceDebrief             `json:"debrief,omitempty"`
	Detail          *RaceDetail              `json:"detail,omitempty"`
	Replay          *ReplayTimeline          `json:"replay,omitempty"`
	// Incidents is the player-involved collision capture block. Top-level (not in
	// Detail) so every DataChannel path can strip it like Replay — the untrimmed
	// local block can far exceed the 256KB SCTP budget. The upload path sends a
	// budget-trimmed copy (TrimIncidentsForUpload) inside the race_detail payload.
	Incidents []dto.IncidentClip `json:"incidents,omitempty"`
	// PrivateCapture is persisted only to support restart-safe capture merging.
	// It must be stripped from DataChannel and local/archive API responses and is
	// never mapped to the platform upload payload.
	PrivateCapture *dto.RacePrivateCapture `json:"privateCapture,omitempty"`
}

// RaceDetail is the rich, player-centric sub-block (per-lap timings/dynamics, the
// event timeline, and the car setup). Kept as one optional pointer block — like
// Replay — so the base summary is unchanged for legacy/resultOnly readers and the
// whole block maps 1:1 onto the platform race_detail JSONB payload. Player-centric
// on purpose: all-24-car per-lap data would overflow the DataChannel SCTP budget.
type RaceDetail struct {
	Laps     []dto.LapTimingDTO            `json:"laps,omitempty"`
	Dynamics []dto.DynamicsLapDTO          `json:"dynamics,omitempty"`
	Events   []dto.RaceControlNotification `json:"events,omitempty"`
	Setup    *dto.CarSetupDTO              `json:"setup,omitempty"`
	// CaptureStartLap: player's lap when capture began (1 = full session observed,
	// >1 = late attach — dynamics before this lap were never measured, 0 = unknown).
	CaptureStartLap int `json:"captureStartLap,omitempty"`
	// FinalizeTrigger: what caused this save — race-end event code, "session-switch",
	// "idle-timeout", or "shutdown". Empty on legacy summaries (pre-feature, always
	// event-final). Checkpoint-class values mean the session may not have been over.
	FinalizeTrigger string                      `json:"finalizeTrigger,omitempty"`
	TrackOutline    *dto.TrackOutlineDTO        `json:"trackOutline,omitempty"`
	Completeness    *dto.RaceDetailCompleteness `json:"completeness,omitempty"`
}

// TrackInfo describes the track for a stored race summary.
type TrackInfo struct {
	TrackID   int8   `json:"trackId"`
	TrackName string `json:"trackName"`
}

// SessionSummary captures session-level race context.
type SessionSummary struct {
	SessionType string  `json:"sessionType"`
	TotalLaps   int     `json:"totalLaps"`
	SafetyCar   string  `json:"safetyCar"`
	Weather     string  `json:"weather"`
	AirTemp     float32 `json:"airTemp"`
	TrackTemp   float32 `json:"trackTemp"`
}

// RaceStint summarises one tire stint. StartLap/EndLap/TireWearPct are rich
// enrichments (omitempty) — zero on legacy summaries.
type RaceStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    int    `json:"startLap,omitempty"`
	EndLap      int    `json:"endLap,omitempty"`
	TireWearPct int    `json:"tireWearPct,omitempty"`
}

// PlayerSummary captures player-centric race result metrics.
type PlayerSummary struct {
	DriverIndex   int         `json:"driverIndex"`
	Name          string      `json:"name"`
	TeamID        int         `json:"teamId"`
	FinalPosition int         `json:"finalPosition"`
	CompletedLaps int         `json:"completedLaps"`
	BestLapMS     uint32      `json:"bestLapMs"`
	LastLapMS     uint32      `json:"lastLapMs"`
	PitStops      int         `json:"pitStops"`
	Stints        []RaceStint `json:"stints,omitempty"`
	// ResultStatus is the player's LapData m_resultStatus at summary time
	// (2 = active, 3 = finished, 4 = DNF, 5 = DSQ, 6 = not classified,
	// 7 = retired). 0 means unknown — including summaries written before this
	// field existed. It gates the platform finishPosition: a SEND that arrives
	// while the player is still active is a mid-race exit, not a result.
	ResultStatus int `json:"resultStatus,omitempty"`
}

// DriverSummary captures lightweight result metrics for each driver.
type DriverSummary struct {
	DriverIndex   int         `json:"driverIndex"`
	Name          string      `json:"name"`
	TeamID        int         `json:"teamId"`
	Position      int         `json:"position"`
	CompletedLaps int         `json:"completedLaps"`
	BestLapMS     uint32      `json:"bestLapMs"`
	LastLapMS     uint32      `json:"lastLapMs"`
	PitStops      int         `json:"pitStops"`
	TireCompound  string      `json:"tireCompound"`
	TireAge       int         `json:"tireAge"`
	Stints        []RaceStint `json:"stints,omitempty"`
}

// RaceHighlights includes extra summary signal useful for race review.
type RaceHighlights struct {
	FastestLapHolder string             `json:"fastestLapHolder,omitempty"`
	FastestLapMS     uint32             `json:"fastestLapMs,omitempty"`
	Notifications    NotificationCounts `json:"notifications"`
}

// RaceDebrief captures post-race review signals for the player.
type RaceDebrief struct {
	ClassifiedDrivers int                           `json:"classifiedDrivers"`
	WinnerName        string                        `json:"winnerName,omitempty"`
	GapToWinnerMS     uint32                        `json:"gapToWinnerMs,omitempty"`
	FastestLapDeltaMS uint32                        `json:"fastestLapDeltaMs,omitempty"`
	Penalties         RacePenaltySummary            `json:"penalties"`
	Pit               RacePitSummary                `json:"pit"`
	Tyres             RaceTyreSummary               `json:"tyres"`
	Timeline          []dto.RaceControlNotification `json:"timeline,omitempty"`
}

// RacePenaltySummary aggregates player penalties and warnings.
type RacePenaltySummary struct {
	TimePenaltySeconds   int `json:"timePenaltySeconds,omitempty"`
	Warnings             int `json:"warnings,omitempty"`
	CornerCutWarnings    int `json:"cornerCutWarnings,omitempty"`
	UnservedDriveThrough int `json:"unservedDriveThrough,omitempty"`
	UnservedStopGo       int `json:"unservedStopGo,omitempty"`
}

// RacePitSummary captures pit stop count and time loss.
type RacePitSummary struct {
	Stops               int    `json:"stops"`
	PitLaneTimeMS       uint32 `json:"pitLaneTimeMs,omitempty"`
	StationaryTimeMS    uint32 `json:"stationaryTimeMs,omitempty"` // 실측 정지 작업 시간(스톱 유형 분류 입력)
	EstimatedTimeLostMS uint32 `json:"estimatedTimeLostMs,omitempty"`
}

// RaceTyreSummary captures end-of-race tyre state.
type RaceTyreSummary struct {
	FinalCompound    string `json:"finalCompound,omitempty"`
	FinalAge         int    `json:"finalAge,omitempty"`
	AverageWearPct   int    `json:"averageWearPct,omitempty"`
	PeakWearPct      int    `json:"peakWearPct,omitempty"`
	FinalSetWearPct  int    `json:"finalSetWearPct,omitempty"`
	LifeSpan         int    `json:"lifeSpan,omitempty"`
	UsableLife       int    `json:"usableLife,omitempty"`
	LifeRemainingPct int    `json:"lifeRemainingPct,omitempty"`
}

// ReplayFrame is one dashboard timeline snapshot.
type ReplayFrame struct {
	Timestamp   int64                         `json:"timestamp"`
	Pitwall     *dto.PitwallState             `json:"pitwall"`
	RaceControl []dto.RaceControlNotification `json:"raceControl,omitempty"`
}

// ReplayTimeline holds time-ordered snapshots for timeline playback.
type ReplayTimeline struct {
	FrameIntervalMS int              `json:"frameIntervalMs"`
	TrackMap        *dto.TrackMapDTO `json:"trackMap,omitempty"`
	Session         *dto.SessionInfo `json:"session,omitempty"`
	Frames          []ReplayFrame    `json:"frames"`
}

// RaceListItem is a lightweight list row returned by /api/races.
type RaceListItem struct {
	ID              string                   `json:"id"`
	SavedAtLocal    string                   `json:"savedAtLocal"`
	TrackName       string                   `json:"trackName"`
	SessionType     string                   `json:"sessionType"`
	PlayerName      string                   `json:"playerName"`
	FinalPosition   int                      `json:"finalPosition"`
	BestLapMS       uint32                   `json:"bestLapMs"`
	FileSizeBytes   int64                    `json:"fileSizeBytes"`
	DataStorageMode rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	HasReplay       bool                     `json:"hasReplay"`
	FrameCount      int                      `json:"frameCount"`
}

// BuildSummary creates a race summary from the latest pitwall snapshot plus the
// rich, player-centric detail gathered by the caller (per-lap timings, setup,
// lap-tagged events). detail may be nil (e.g. a caller with no rich inputs);
// SchemaVersion is stamped unconditionally.
func BuildSummary(sessionUID uint64, state *dto.PitwallState, counts NotificationCounts, timeline []dto.RaceControlNotification, detail *dto.RaceDetailInput, savedAt time.Time) *RaceSummary {
	out := &RaceSummary{
		SchemaVersion:   RaceSummarySchemaVersion,
		SavedAtLocal:    savedAt.Format("2006-01-02 15:04:05"),
		SessionUID:      sessionUID,
		DataStorageMode: rtconfig.DataStorageModeResultOnly,
		Highlights: RaceHighlights{
			Notifications: counts,
		},
	}

	if state == nil {
		return out
	}

	out.GameFormat = gameFormatLabel(state.GameFormat)

	if state.Session != nil {
		out.Track = TrackInfo{
			TrackID:   state.Session.TrackID,
			TrackName: state.Session.TrackName,
		}
		out.Session = SessionSummary{
			SessionType: state.Session.SessionType,
			TotalLaps:   state.Session.TotalLaps,
			SafetyCar:   state.Session.SafetyCar,
			Weather:     state.Session.Weather,
			AirTemp:     state.Session.AirTemp,
			TrackTemp:   state.Session.TrackTemp,
		}
	}

	if len(state.Drivers) > 0 {
		out.Drivers = make([]DriverSummary, 0, len(state.Drivers))
		for _, d := range state.Drivers {
			driver := DriverSummary{
				DriverIndex:   d.Index,
				Name:          d.Name,
				TeamID:        d.TeamID,
				Position:      d.Position,
				CompletedLaps: d.CurrentLapNum,
				BestLapMS:     uint32(maxf32(d.BestLapTime, 0)),
				LastLapMS:     uint32(maxf32(d.LastLapTime, 0)),
				PitStops:      d.NumPitStops,
				TireCompound:  d.TireCompound,
				TireAge:       d.TireAge,
			}
			driver.Stints = stintsFromDTO(d.StintHistory)
			out.Drivers = append(out.Drivers, driver)

			if d.BestLapTime > 0 && (out.Highlights.FastestLapMS == 0 || uint32(d.BestLapTime) < out.Highlights.FastestLapMS) {
				out.Highlights.FastestLapMS = uint32(d.BestLapTime)
				out.Highlights.FastestLapHolder = d.Name
			}
		}

		playerIdx := state.PlayerIndex
		if playerIdx >= 0 && playerIdx < len(state.Drivers) {
			p := state.Drivers[playerIdx]
			out.Player = PlayerSummary{
				DriverIndex:   p.Index,
				Name:          p.Name,
				TeamID:        p.TeamID,
				FinalPosition: p.Position,
				CompletedLaps: p.CurrentLapNum,
				BestLapMS:     uint32(maxf32(p.BestLapTime, 0)),
				LastLapMS:     uint32(maxf32(p.LastLapTime, 0)),
				PitStops:      p.NumPitStops,
				ResultStatus:  p.ResultStatus,
			}
			// The player's stints drive the rich Detail's per-lap tyre mapping, so
			// synthesize the final in-progress stint (StintHistory only closes on a
			// compound change — the last, ongoing stint is otherwise missing).
			out.Player.Stints = appendCurrentStint(stintsFromDTO(p.StintHistory), p)
			out.Debrief = buildDebrief(p, state, out.Highlights.FastestLapMS, timeline)

			out.Detail = buildDetail(detail, p, out.Player.Stints)
		}
	}
	if detail != nil && detail.PrivateCapture != nil {
		capture := *detail.PrivateCapture
		capture.EligibleIncidentKeys = cloneIncidentKeys(detail.PrivateCapture.EligibleIncidentKeys)
		out.PrivateCapture = &capture
	}

	return out
}

// gameFormatLabel maps the packet format year to the platform's game_format label
// ("F1 25"/"F1 26") — the leaderboard/market partition key. Unknown → "".
func gameFormatLabel(format int) string {
	switch format {
	case 2025:
		return "F1 25"
	case 2026:
		return "F1 26"
	default:
		return ""
	}
}

// stintsFromDTO copies stint DTOs, carrying the StartLap/EndLap/wear enrichments.
func stintsFromDTO(src []dto.StintInfoDTO) []RaceStint {
	if len(src) == 0 {
		return nil
	}
	out := make([]RaceStint, len(src))
	for i, s := range src {
		out[i] = RaceStint{
			Compound:    s.Compound,
			Laps:        s.Laps,
			StartLap:    s.StartLap,
			EndLap:      s.EndLap,
			TireWearPct: s.TireWearPct,
		}
	}
	return out
}

// appendCurrentStint appends the player's ongoing (unclosed) stint so the stint
// list spans the whole race — StintHistory only closes a stint on a compound
// change, so the last, in-progress stint is otherwise missing. StartLap continues
// from the last closed stint; wear is the current 4-corner average.
func appendCurrentStint(stints []RaceStint, p dto.DriverInfo) []RaceStint {
	if p.TireCompound == "" || p.TireCompound == "unknown" {
		return stints
	}
	lastEnd := 0
	if n := len(stints); n > 0 {
		lastEnd = stints[n-1].EndLap
	}
	start := lastEnd + 1
	end := p.CurrentLapNum
	if end < start {
		return stints // no completed lap in the current stint yet
	}
	return append(stints, RaceStint{
		Compound:    p.TireCompound,
		Laps:        end - start + 1,
		StartLap:    start,
		EndLap:      end,
		TireWearPct: avgTireWear(p.TireWear),
	})
}

// avgTireWear returns the rounded mean of the 4-corner wear percentages.
func avgTireWear(w [4]int) int {
	return (w[0] + w[1] + w[2] + w[3] + 2) / 4
}

// buildDetail assembles the rich Detail sub-block from the injected inputs plus the
// player's dynamics (already on the driver DTO). Per-lap tyre is derived by joining
// each lap number against the player's stint ranges (the session-history packet
// carries no per-lap compound). Returns nil when there is nothing rich to store.
func buildDetail(in *dto.RaceDetailInput, p dto.DriverInfo, stints []RaceStint) *RaceDetail {
	if in == nil {
		return nil
	}
	laps := in.PlayerLaps
	if len(laps) > 0 {
		laps = append([]dto.LapTimingDTO(nil), laps...)
		for i := range laps {
			laps[i].Tyre = tyreForLap(laps[i].LapNumber, stints)
		}
	}
	detail := &RaceDetail{
		Laps:            laps,
		Dynamics:        p.Dynamics,
		Events:          in.RichEvents,
		Setup:           in.PlayerSetup,
		CaptureStartLap: in.CaptureStartLap,
		FinalizeTrigger: in.FinalizeTrigger,
		TrackOutline:    cloneTrackOutline(in.TrackOutline),
		Completeness:    cloneCompleteness(in.Completeness),
	}
	if len(detail.Laps) == 0 && len(detail.Dynamics) == 0 && len(detail.Events) == 0 && detail.Setup == nil &&
		detail.TrackOutline == nil && detail.Completeness == nil {
		return nil
	}
	return detail
}

func cloneIncidentKeys(src []dto.IncidentCaptureKey) []dto.IncidentCaptureKey {
	if len(src) == 0 {
		return nil
	}
	out := make([]dto.IncidentCaptureKey, len(src))
	for i, key := range src {
		out[i] = key
		out[i].Collisions = append([][2]int(nil), key.Collisions...)
	}
	return out
}

func cloneTrackOutline(src *dto.TrackOutlineDTO) *dto.TrackOutlineDTO {
	if src == nil {
		return nil
	}
	out := *src
	out.Points = append([][2]float64(nil), src.Points...)
	return &out
}

func cloneCompleteness(src *dto.RaceDetailCompleteness) *dto.RaceDetailCompleteness {
	if src == nil {
		return nil
	}
	out := *src
	cloneSection(&out.Analysis)
	for _, section := range []*dto.SectionCompleteness{
		&out.Sections.Laps, &out.Sections.Sectors, &out.Sections.Stints, &out.Sections.Tyres,
		&out.Sections.Dynamics, &out.Sections.Penalties, &out.Sections.Events, &out.Sections.Pit,
		&out.Sections.TrackOutline, &out.Sections.Incidents,
	} {
		cloneSection(section)
	}
	return &out
}

func cloneSection(section *dto.SectionCompleteness) {
	if section == nil {
		return
	}
	section.Reasons = append([]dto.CompletenessReason(nil), section.Reasons...)
	if section.CapturedCount != nil {
		count := *section.CapturedCount
		section.CapturedCount = &count
	}
	if section.StoredCount != nil {
		count := *section.StoredCount
		section.StoredCount = &count
	}
}

// UploadCompletenessFacts describes transformations that happen after a local
// summary was captured. In particular, trimming must update counts/reasons on a
// copy of the v2 wire metadata instead of mutating restart state on disk.
type UploadCompletenessFacts struct {
	Incidents            []dto.IncidentClip
	EventsStored         int
	EventsUploadDropped  int
	ParticipantsTrimmed  bool
	DroppedClips         int
	RequestBudgetDropped bool
	IncidentMergeLimited bool
}

// RefreshLocalCompleteness records v2 capture truth before a local summary is
// saved. It is safe for legacy summaries (a no-op) and is intentionally called
// only after Incident clips/private ledger have been attached by the host.
func RefreshLocalCompleteness(summary *RaceSummary) {
	if summary == nil || summary.SchemaVersion < RaceSummarySchemaVersion || summary.Detail == nil {
		return
	}
	summary.Detail.Completeness = DeriveUploadCompleteness(summary, UploadCompletenessFacts{
		Incidents:            summary.Incidents,
		EventsStored:         len(summary.Detail.Events),
		IncidentMergeLimited: summary.PrivateCapture != nil && summary.PrivateCapture.Provenance.IncidentMergeLimited,
	})
}

// DeriveUploadCompleteness constructs the frozen v2 completeness envelope from
// producer provenance and the final serialized shapes. It does not mutate its
// inputs, making it usable by the uploader after 300KiB and request-budget
// trimming. Historical summaries deliberately return nil: they retain legacy
// unknown semantics instead of fabricating metadata.
func DeriveUploadCompleteness(summary *RaceSummary, facts UploadCompletenessFacts) *dto.RaceDetailCompleteness {
	if summary == nil || summary.SchemaVersion < RaceSummarySchemaVersion || summary.Detail == nil {
		return nil
	}
	detail := summary.Detail
	provenance := dto.RaceCaptureProvenance{}
	if summary.PrivateCapture != nil {
		provenance = summary.PrivateCapture.Provenance
	}
	if facts.EventsStored < 0 {
		facts.EventsStored = 0
	}

	sections := dto.DetailSections{}
	lapCount := len(detail.Laps)
	sections.Laps = directSection(lapCount > 0 && provenance.SessionHistoryObserved, lapCount, lapCount,
		provenance, nil)
	sectorCount := 0
	for _, lap := range detail.Laps {
		if lap.S1Ms != 0 && lap.S2Ms != 0 && lap.S3Ms != 0 {
			sectorCount++
		}
	}
	sectorReasons := []dto.CompletenessReason(nil)
	if lapCount > 0 && sectorCount != lapCount {
		sectorReasons = append(sectorReasons, dto.ReasonSourceMissing)
	}
	sections.Sectors = directSection(lapCount > 0, lapCount, sectorCount, provenance, sectorReasons)

	stintCount := len(summary.Player.Stints)
	stintReasons := []dto.CompletenessReason(nil)
	if detail.CaptureStartLap > 1 {
		stintReasons = append(stintReasons, dto.ReasonLateCapture)
	}
	sections.Stints = directSection(provenance.CarStatusObserved && stintCount > 0, stintCount, stintCount, provenance, stintReasons)

	// A schema-v2 upload always carries one debrief object. Its object-unit count
	// stays fixed even when no usable fact was observed; the section status tells
	// clients whether that required envelope contains a confirmed fact or only
	// nullable placeholders.
	debriefPresent := true
	debriefFactsPresent := summary.Debrief != nil
	// The current tyre-set packet enriches optional life/set fields only. A
	// complete debrief is still possible when those nullable fields are not
	// applicable; car status and damage are the raw sources for the core final
	// compound/age/wear facts.
	tyreObserved := debriefFactsPresent && (provenance.CarStatusObserved || provenance.CarDamageObserved)
	tyreComplete := debriefFactsPresent && provenance.CarStatusObserved && provenance.CarDamageObserved
	tyreReasons := []dto.CompletenessReason(nil)
	if tyreObserved && !tyreComplete {
		tyreReasons = append(tyreReasons, dto.ReasonSourceMissing)
	}
	sections.Tyres = knownObjectSection(debriefPresent, tyreObserved, tyreComplete, provenance, tyreReasons)
	penaltiesObserved := debriefFactsPresent && provenance.LapDataObserved
	sections.Penalties = knownObjectSection(debriefPresent, penaltiesObserved, penaltiesObserved, provenance, nil)

	dynamicCount := len(detail.Dynamics)
	dynamicReasons := []dto.CompletenessReason(nil)
	if detail.CaptureStartLap > 1 {
		dynamicReasons = append(dynamicReasons, dto.ReasonLateCapture)
	}
	sections.Dynamics = directSection(detail.CaptureStartLap > 0 && dynamicCount > 0, dynamicCount, dynamicCount, provenance, dynamicReasons)

	eventCaptured := provenance.EventsSeen
	if eventCaptured < facts.EventsStored {
		eventCaptured = facts.EventsStored
	}
	eventReasons := []dto.CompletenessReason(nil)
	if provenance.EventsBufferDropped > 0 {
		eventReasons = append(eventReasons, dto.ReasonEventBufferLimit)
	}
	if facts.EventsUploadDropped > 0 {
		eventReasons = append(eventReasons, dto.ReasonEventUploadLimit)
	}
	if eventCaptured > facts.EventsStored && provenance.EventsBufferDropped == 0 && facts.EventsUploadDropped == 0 {
		// Restart event union can deduplicate repeated observations, and malformed
		// source samples can otherwise disappear before upload. Do not claim a
		// complete event section when the observed count has no retained fact.
		eventReasons = append(eventReasons, dto.ReasonSourceMissing)
	}
	sections.Events = directSection(provenance.EventsCaptureActive, eventCaptured, facts.EventsStored, provenance, eventReasons)

	pitReasons := []dto.CompletenessReason(nil)
	pitObserved := debriefFactsPresent && provenance.LapDataObserved
	pitComplete := pitObserved
	if summary.Debrief != nil && summary.Debrief.Pit.Stops > 0 && !provenance.PitMeasurementObserved {
		pitReasons = append(pitReasons, dto.ReasonPitMeasurementUnavailable)
		pitComplete = false
	}
	sections.Pit = knownObjectSection(debriefPresent, pitObserved, pitComplete, provenance, pitReasons)

	outlineCaptured, outlineStored := 0, 0
	outlineReasons := []dto.CompletenessReason(nil)
	outlineAvailable := detail.TrackOutline != nil && len(detail.TrackOutline.Points) >= 2
	if outlineAvailable {
		outlineStored = len(detail.TrackOutline.Points)
		outlineCaptured = outlineStored
		if provenance.TrackOutlineSourcePoints > outlineCaptured {
			outlineCaptured = provenance.TrackOutlineSourcePoints
		}
		if outlineCaptured > outlineStored {
			outlineReasons = append(outlineReasons, dto.ReasonTrackOutlineDownsampled)
		}
	} else {
		outlineReasons = append(outlineReasons, dto.ReasonTrackOutlineUnavailable)
	}
	// Unlike time-based sections, a recorded centreline is not made incomplete
	// by checkpoint finalization. Its only v2 partial state is a real bounded
	// sampling loss, which must agree with captured/stored point counts.
	outlineStatus := dto.AvailabilityComplete
	if !outlineAvailable {
		outlineStatus = dto.AvailabilityUnavailable
	} else if outlineCaptured > outlineStored {
		outlineStatus = dto.AvailabilityPartial
	}
	sections.TrackOutline = explicitSection(outlineStatus, outlineReasons, outlineCaptured, outlineStored)

	incidentCaptured := 0
	if summary.PrivateCapture != nil {
		incidentCaptured = len(summary.PrivateCapture.EligibleIncidentKeys)
	}
	if incidentCaptured < len(facts.Incidents) {
		incidentCaptured = len(facts.Incidents)
	}
	incidentReasons := collectIncidentReasons(facts.Incidents)
	// Only the recorder's explicit local refusal proves a clip-cap loss. Upload
	// projection and the request-budget guard also reduce stored clips, and must
	// retain their own precise reasons without inventing incident-clip-limit.
	if provenance.IncidentClipLimitReached {
		incidentReasons = append(incidentReasons, dto.ReasonIncidentClipLimit)
	}
	// An eligible local event can fail to yield any usable clip (for example all
	// candidate motion frames were invalid). It is not a recorder clip-cap or an
	// upload trim, but it still must not promote the session section to complete.
	if incidentCaptured > len(facts.Incidents) && !provenance.IncidentClipLimitReached &&
		facts.DroppedClips == 0 && !facts.RequestBudgetDropped && !facts.IncidentMergeLimited {
		incidentReasons = append(incidentReasons, dto.ReasonSourceMissing)
	}
	if facts.ParticipantsTrimmed {
		incidentReasons = append(incidentReasons, dto.ReasonUploadParticipantsTrimmed)
	}
	if facts.DroppedClips > 0 {
		incidentReasons = append(incidentReasons, dto.ReasonUploadClipsDropped)
	}
	if facts.IncidentMergeLimited {
		incidentReasons = append(incidentReasons, dto.ReasonIncidentMergeLimit)
	}
	if facts.RequestBudgetDropped {
		incidentReasons = append(incidentReasons, dto.ReasonRequestBudgetDropped)
	}
	sections.Incidents = incidentSection(incidentCaptured, len(facts.Incidents), provenance.IncidentsCaptureActive, incidentReasons)

	analysisSections := []dto.SectionCompleteness{
		sections.Laps, sections.Sectors, sections.Stints, sections.Tyres, sections.Dynamics,
		sections.Penalties, sections.Events, sections.Pit, sections.Incidents,
	}
	return &dto.RaceDetailCompleteness{
		Analysis: aggregateCompleteness(analysisSections),
		Sections: sections,
	}
}

func knownObjectSection(recordPresent, observed, complete bool, provenance dto.RaceCaptureProvenance, extra []dto.CompletenessReason) dto.SectionCompleteness {
	count := 0
	if recordPresent {
		count = 1
	}
	reasons := append([]dto.CompletenessReason(nil), extra...)
	status := dto.AvailabilityComplete
	switch {
	case !observed:
		// The required v2 debrief envelope is a metadata record, not itself a
		// usable tyre/penalty/pit fact. It therefore may have storedCount=1
		// while honestly reporting unavailable.
		status = dto.AvailabilityUnavailable
		reasons = append(reasons, dto.ReasonSourceMissing)
	case !complete:
		status = dto.AvailabilityPartial
	}
	if provenance.CheckpointFinalize && status != dto.AvailabilityUnavailable {
		status = dto.AvailabilityPartial
		reasons = append(reasons, dto.ReasonCheckpointFinalize)
	}
	return explicitSection(status, reasons, count, count)
}

func directSection(available bool, captured, stored int, provenance dto.RaceCaptureProvenance, extra []dto.CompletenessReason) dto.SectionCompleteness {
	reasons := append([]dto.CompletenessReason(nil), extra...)
	status := dto.AvailabilityComplete
	if !available {
		reasons = append(reasons, dto.ReasonSourceMissing)
		// "unavailable" is reserved for no usable stored data. A malformed or
		// partially adopted producer can still carry recognizable facts without
		// its raw observation flag, which is honest partial data rather than an
		// unavailable section with non-zero storedCount.
		if stored > 0 {
			status = dto.AvailabilityPartial
		} else {
			status = dto.AvailabilityUnavailable
		}
	}
	if provenance.CheckpointFinalize {
		reasons = append(reasons, dto.ReasonCheckpointFinalize)
		if available {
			status = dto.AvailabilityPartial
		}
	}
	if len(reasons) > 0 && status == dto.AvailabilityComplete {
		status = dto.AvailabilityPartial
	}
	return explicitSection(status, reasons, captured, stored)
}

func incidentSection(captured, stored int, captureActive bool, reasons []dto.CompletenessReason) dto.SectionCompleteness {
	reasons = uniqueReasons(reasons)
	status := dto.AvailabilityComplete
	switch {
	case !captureActive:
		if stored > 0 {
			status = dto.AvailabilityPartial
		} else {
			status = dto.AvailabilityUnavailable
		}
		reasons = uniqueReasons(append(reasons, dto.ReasonSourceMissing))
	case stored == 0 && captured > 0:
		status = dto.AvailabilityUnavailable
	case len(reasons) > 0:
		status = dto.AvailabilityPartial
	}
	return explicitSection(status, reasons, captured, stored)
}

func explicitSection(status dto.Availability, reasons []dto.CompletenessReason, captured, stored int) dto.SectionCompleteness {
	if captured < stored {
		captured = stored
	}
	return dto.SectionCompleteness{
		Status:        status,
		Reasons:       uniqueReasons(reasons),
		CapturedCount: intCount(captured),
		StoredCount:   intCount(stored),
	}
}

func aggregateCompleteness(sections []dto.SectionCompleteness) dto.SectionCompleteness {
	allComplete, allUnknown := true, true
	usable, hasUnavailable := false, false
	for _, section := range sections {
		if section.Status != dto.AvailabilityComplete {
			allComplete = false
		}
		if section.Status != dto.AvailabilityUnknown {
			allUnknown = false
		}
		if section.Status == dto.AvailabilityComplete || section.Status == dto.AvailabilityPartial {
			usable = true
		}
		if section.Status == dto.AvailabilityUnavailable {
			hasUnavailable = true
		}
	}
	status := dto.AvailabilityPartial
	switch {
	case allComplete:
		status = dto.AvailabilityComplete
	case allUnknown:
		status = dto.AvailabilityUnknown
	case !usable && hasUnavailable:
		status = dto.AvailabilityUnavailable
	}
	return dto.SectionCompleteness{Status: status, Reasons: []dto.CompletenessReason{}, CapturedCount: nil, StoredCount: nil}
}

func collectIncidentReasons(clips []dto.IncidentClip) []dto.CompletenessReason {
	var out []dto.CompletenessReason
	for _, clip := range clips {
		out = append(out, clip.Completeness.Reasons...)
	}
	return uniqueReasons(out)
}

func uniqueReasons(reasons []dto.CompletenessReason) []dto.CompletenessReason {
	if len(reasons) == 0 {
		return []dto.CompletenessReason{}
	}
	seen := make(map[dto.CompletenessReason]struct{}, len(reasons))
	out := make([]dto.CompletenessReason, 0, len(reasons))
	for _, reason := range reasons {
		if reason == "" {
			continue
		}
		if _, exists := seen[reason]; exists {
			continue
		}
		seen[reason] = struct{}{}
		out = append(out, reason)
	}
	return out
}

func intCount(value int) *int {
	return &value
}

// tyreForLap returns the canonical compound of the stint covering lapNum, or "".
func tyreForLap(lapNum int, stints []RaceStint) string {
	for _, s := range stints {
		if lapNum >= s.StartLap && lapNum <= s.EndLap {
			return canonicalTyre(s.Compound)
		}
	}
	return ""
}

// canonicalTyre maps an internal lowercase compound to the platform's whitelisted
// capitalized form (Soft/Medium/Hard/Inter/Wet); unknown → "".
func canonicalTyre(compound string) string {
	switch strings.ToLower(compound) {
	case "soft":
		return "Soft"
	case "medium":
		return "Medium"
	case "hard":
		return "Hard"
	case "inter", "intermediate":
		return "Inter"
	case "wet":
		return "Wet"
	default:
		return ""
	}
}

func buildDebrief(player dto.DriverInfo, state *dto.PitwallState, fastestLapMS uint32, timeline []dto.RaceControlNotification) *RaceDebrief {
	debrief := &RaceDebrief{
		ClassifiedDrivers: len(state.Drivers),
		Penalties: RacePenaltySummary{
			TimePenaltySeconds:   player.Penalties,
			Warnings:             player.TotalWarnings,
			CornerCutWarnings:    player.CornerCuttingWarnings,
			UnservedDriveThrough: player.NumUnservedDriveThroughs,
			UnservedStopGo:       player.NumUnservedStopGoPenalties,
		},
		Pit: RacePitSummary{
			Stops: player.NumPitStops,
		},
		Tyres: RaceTyreSummary{
			FinalCompound: player.TireCompound,
			FinalAge:      player.TireAge,
		},
	}

	for _, driver := range state.Drivers {
		if driver.Position == 1 && driver.Name != "" {
			debrief.WinnerName = driver.Name
			break
		}
	}
	if player.DeltaToRaceLeader > 0 {
		debrief.GapToWinnerMS = uint32(player.DeltaToRaceLeader)
	}
	playerBest := uint32(maxf32(player.BestLapTime, 0))
	if fastestLapMS > 0 && playerBest > fastestLapMS {
		debrief.FastestLapDeltaMS = playerBest - fastestLapMS
	}
	if player.MeasuredPitLaneMs > 0 {
		// 스톱 완료 시점에 확정된 실측값 — 종료 시점 라이브 PitLaneTime 리셋에 영향받지 않는다.
		// PitLaneTimeMS는 이 measured 경로에서만 채워지므로, 업로더의 "실측만 업로드" 게이트가
		// 라이브 폴백 부분값을 흘리지 않는다(Fable M3).
		debrief.Pit.PitLaneTimeMS = uint32(player.MeasuredPitLaneMs)
		debrief.Pit.StationaryTimeMS = uint32(player.MeasuredPitStopMs)
		debrief.Pit.EstimatedTimeLostMS = uint32(player.MeasuredPitLaneMs)
	} else if player.PitLaneTime > 0 {
		// 라이브 폴백: 종료 시점 레인시간은 부분값일 수 있어 실측으로 신뢰하지 않는다.
		// 표시용 추정(EstimatedTimeLostMS)으로만 남기고 PitLaneTimeMS는 비워 업로드에서 제외한다.
		debrief.Pit.EstimatedTimeLostMS = uint32(player.PitLaneTime)
	} else if player.NumPitStops > 0 {
		debrief.Pit.EstimatedTimeLostMS = uint32(player.NumPitStops * 22000)
	}

	wearTotal := 0
	peakWear := 0
	for _, wear := range player.TireWear {
		if wear > peakWear {
			peakWear = wear
		}
		wearTotal += wear
	}
	if wearTotal > 0 {
		debrief.Tyres.AverageWearPct = wearTotal / len(player.TireWear)
		debrief.Tyres.PeakWearPct = peakWear
	}
	if player.TyreSetWear != nil && *player.TyreSetWear > 0 {
		debrief.Tyres.FinalSetWearPct = *player.TyreSetWear
	}
	if player.TyreLifeSpan != nil && *player.TyreLifeSpan > 0 {
		debrief.Tyres.LifeSpan = *player.TyreLifeSpan
	}
	if player.TyreUsableLife != nil && *player.TyreUsableLife > 0 {
		debrief.Tyres.UsableLife = *player.TyreUsableLife
	}
	if player.TyreLifeSpan != nil && *player.TyreLifeSpan > 0 && player.TireAge >= 0 {
		remaining := *player.TyreLifeSpan - player.TireAge
		if remaining < 0 {
			remaining = 0
		}
		debrief.Tyres.LifeRemainingPct = int(float64(remaining) / float64(*player.TyreLifeSpan) * 100)
	}
	if len(timeline) > 0 {
		debrief.Timeline = append([]dto.RaceControlNotification(nil), timeline...)
	}

	return debrief
}

func maxf32(v, min float32) float32 {
	if v < min {
		return min
	}
	return v
}
