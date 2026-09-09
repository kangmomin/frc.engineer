package platformsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/strategy"
)

// ErrDuplicate is returned when a race with the same (account, source) was
// already uploaded. ErrBadUpload flags a malformed payload (no laps, too many
// laps, duplicate lap numbers).
var (
	ErrDuplicate = errors.New("platformsvc: duplicate upload")
	ErrBadUpload = errors.New("platformsvc: bad upload")
)

// Generic plausibility bounds (milliseconds) used when a track has no
// track_bounds row. Deliberately wide — this is anti-noise, not anti-cheat
// (§trust model): it rejects garbage, not a determined forger. The min is a
// globally-safe floor: no official F1 lap is under ~63s, so 45s never rejects a
// real lap while still lifting the toppable floor well above zero.
const (
	genericMinLapMs = 45_000  // 45s: safely below any real F1 lap
	genericMaxLapMs = 900_000 // 15min: above any plausible lap incl. incidents
)

// sectorSumToleranceMs bounds how far the three sector times may sum away from
// the lap time before the lap is treated as inconsistent. Sectors carry sub-ms
// rounding, so a small slack is expected.
const sectorSumToleranceMs = 1500

// Input caps (worst-case ingest bounds; DoS guard).
const (
	maxLapsPerUpload  = 500
	maxLapNumber      = 1000
	maxSourceRaceLen  = 128
	maxGameFormatLen  = 32
	maxSessionTypeLen = 48
	maxTrackNameLen   = 64

	// Rich Detail caps (player-centric; worst-case 2026 24-car/78-lap fits well
	// under the 512 KiB body cap).
	maxDetailStints   = 30
	maxDetailDynamics = 500
	maxDetailEvents   = 200
	maxSchemaVersion  = 32767 // SMALLINT ceiling (race_detail.schema_version)
	// finalizeTrigger is a short enum-ish label ("SEND", "session-switch", ...);
	// bound generously without trusting the contents (payload stays opaque).
	maxFinalizeTriggerLen = 32

	// Incident-clip caps. The sender enforces the same bounds at the source
	// (incident recorder + races.TrimIncidentsForUpload); these mirror them so a
	// forged or buggy payload gets a clean 400 instead of bloating race_detail.
	maxDetailIncidents      = 20
	maxIncidentParticipants = dto.IncidentMaxParticipants
	maxIncidentFrames       = 101 // 5s merged window at nominal 50ms + endpoints
	maxIncidentCollisions   = 20
	maxIncidentNameLen      = 48
	maxIncidentVehicleIdx   = 23 // 2026 grid: 24 slots
	incidentCarFrameValues  = 14
)

// validTyres whitelists the compound strings that may reach the public pace
// leaderboard (mode() aggregation). Anything else normalizes to "" so attacker
// text can't be surfaced. Mirrors internal/analysis compoundName.
var validTyres = map[string]struct{}{
	"Soft": {}, "Medium": {}, "Hard": {}, "Inter": {}, "Wet": {},
}

func normalizeTyre(t string) string {
	if _, ok := validTyres[t]; ok {
		return t
	}
	return ""
}

// validateUpload enforces the payload's structural bounds before any DB work and
// normalizes tyre strings in place. Returns ErrBadUpload on any violation
// (including duplicate lap numbers, caught here for a clean 400 rather than a
// unique-violation backstop).
func validateUpload(req *UploadRequest) error {
	n := utf8.RuneCountInString(req.SourceRaceID)
	if n < 1 || n > maxSourceRaceLen {
		return ErrBadUpload
	}
	if utf8.RuneCountInString(req.GameFormat) > maxGameFormatLen ||
		utf8.RuneCountInString(req.SessionType) > maxSessionTypeLen ||
		utf8.RuneCountInString(req.TrackName) > maxTrackNameLen {
		return ErrBadUpload
	}
	if req.TrackID < -1 || req.TrackID > 255 {
		return ErrBadUpload
	}
	if len(req.Laps) == 0 || len(req.Laps) > maxLapsPerUpload {
		return ErrBadUpload
	}
	seen := make(map[int]struct{}, len(req.Laps))
	for i := range req.Laps {
		lp := &req.Laps[i]
		if lp.LapNumber < 1 || lp.LapNumber > maxLapNumber {
			return ErrBadUpload
		}
		if _, dup := seen[lp.LapNumber]; dup {
			return ErrBadUpload
		}
		// ms columns are int4: a value in (2^31, 2^32) is JSON-decodable into
		// uint32 but overflows the column, turning a bad payload into a 500 at
		// INSERT time. Reject here for a clean 400.
		if lp.LapMs > math.MaxInt32 || lp.S1Ms > math.MaxInt32 || lp.S2Ms > math.MaxInt32 || lp.S3Ms > math.MaxInt32 {
			return ErrBadUpload
		}
		seen[lp.LapNumber] = struct{}{}
		lp.Tyre = normalizeTyre(lp.Tyre)
	}
	// A huge-but-JSON-legal setup float (|f| > ~1.8e305) rounds to ±Inf in
	// canonicalizeSetup and fails json.Marshal → 500. Reject non-finite /
	// implausible values here for a clean 400 before any DB work.
	if req.Setup != nil && !setupFloatsFinite(req.Setup) {
		return ErrBadUpload
	}
	if !validFinishPosition(req) {
		return ErrBadUpload
	}
	// schema_version is a SMALLINT column: a value past its range would 500 at
	// INSERT (mirrors the int4 lap-ms guard above). Detail requires a real version.
	if req.SchemaVersion < 0 || req.SchemaVersion > maxSchemaVersion {
		return ErrBadUpload
	}
	if req.Detail != nil {
		if req.SchemaVersion < 1 {
			return ErrBadUpload
		}
		if len(req.Detail.Stints) > maxDetailStints ||
			len(req.Detail.Dynamics) > maxDetailDynamics ||
			len(req.Detail.Events) > maxDetailEvents ||
			len(req.Detail.Incidents) > maxDetailIncidents {
			return ErrBadUpload
		}
		if req.Detail.CaptureStartLap < 0 || req.Detail.CaptureStartLap > maxLapNumber ||
			utf8.RuneCountInString(req.Detail.FinalizeTrigger) > maxFinalizeTriggerLen {
			return ErrBadUpload
		}
		for i := range req.Detail.Incidents {
			if !validIncident(&req.Detail.Incidents[i]) {
				return ErrBadUpload
			}
		}
		if req.SchemaVersion == 2 && !validV2Detail(req) {
			return ErrBadUpload
		}
	}
	if p := req.Pit; p != nil {
		// pit 블록이 무효여도(lane==0 등) 레이스 전체를 버리지 않는다 — IngestRace가 lane>0일
		// 때만 INSERT하므로 lane==0은 조용히 무시된다(Fable Minor 3). 다만 범위 밖·물리적으로
		// 불가능한(정지 > 레인 체류) 값은 race_pit_loss를 오염시키므로 400으로 거부한다.
		if p.PitLaneTimeMs > 600000 || p.StationaryMs > 600000 ||
			p.Stops < 0 || p.Stops > 100 ||
			(p.PitLaneTimeMs > 0 && p.StationaryMs > p.PitLaneTimeMs) { // 정지 ≤ 레인 체류(Minor 2)
			return ErrBadUpload
		}
	}
	if err := validateStrategyUpload(req); err != nil {
		return err
	}
	return nil
}

// validFinishPosition admits the final live position only for the one sender
// path that knows the session ended. It is intentionally not an official race
// classification: checkpoint, session-switch, legacy, and non-race uploads do
// not carry this optional field at all.
func validFinishPosition(req *UploadRequest) bool {
	if req.FinishPosition == nil {
		return true
	}
	if *req.FinishPosition < 1 || *req.FinishPosition > 24 || req.Detail == nil || req.Detail.FinalizeTrigger != "SEND" {
		return false
	}
	switch req.SessionType {
	case "Race", "Race 2", "Race 3":
		return true
	default:
		return false
	}
}

// setupNumericMax bounds any single float setup field. Real setups are tiny
// (camber ~ -3, tyre pressure ~ 20, fuel ~ 0..110); 1e6 is absurdly generous
// while keeping round3 (×1000) finite so canonicalizeSetup never marshals ±Inf.
const setupNumericMax = 1e6

func floatFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0) && math.Abs(f) <= setupNumericMax
}

func setupFloatsFinite(s *UploadSetup) bool {
	return floatFinite(s.FrontCamber) && floatFinite(s.RearCamber) &&
		floatFinite(s.FrontToe) && floatFinite(s.RearToe) &&
		floatFinite(s.RearLeftTyrePressure) && floatFinite(s.RearRightTyrePressure) &&
		floatFinite(s.FrontLeftTyrePressure) && floatFinite(s.FrontRightTyrePressure) &&
		floatFinite(s.FuelLoad)
}

// validIncident enforces the structural bounds of one incident clip: index
// ranges, count caps, name length, frame-array shape and float finiteness. Like
// every Detail check this is structural only — contents are never trusted for a
// server-derived value. Non-finite floats would also 500 at the canonical
// re-marshal, so they get a clean 400 here (mirrors the setup-float guard).
func validIncident(inc *UploadIncident) bool {
	if inc.SessionTimeMs < 0 || inc.WindowStartMs < 0 || inc.WindowStartMs > inc.SessionTimeMs {
		return false
	}
	if inc.FrameIntervalMs < 1 || inc.FrameIntervalMs > 1000 {
		return false
	}
	if inc.Lap < 0 || inc.Lap > maxLapNumber {
		return false
	}
	if len(inc.Collisions) < 1 || len(inc.Collisions) > maxIncidentCollisions {
		return false
	}
	for _, pair := range inc.Collisions {
		if pair[0] < 0 || pair[0] > maxIncidentVehicleIdx ||
			pair[1] < 0 || pair[1] > maxIncidentVehicleIdx || pair[0] == pair[1] {
			return false
		}
	}
	if len(inc.Participants) < 1 || len(inc.Participants) > maxIncidentParticipants {
		return false
	}
	for i := range inc.Participants {
		pt := &inc.Participants[i]
		if pt.Idx < 0 || pt.Idx > maxIncidentVehicleIdx {
			return false
		}
		if utf8.RuneCountInString(pt.Name) > maxIncidentNameLen {
			return false
		}
		if !floatFinite(pt.MinDistM) || pt.MinDistM < 0 {
			return false
		}
	}
	if len(inc.Frames) < 1 || len(inc.Frames) > maxIncidentFrames {
		return false
	}
	for i := range inc.Frames {
		f := &inc.Frames[i]
		if f.TMs < 0 {
			return false
		}
		if len(f.Cars) > len(inc.Participants) {
			return false
		}
		for _, car := range f.Cars {
			if car == nil {
				continue
			}
			if len(car) != incidentCarFrameValues {
				return false
			}
			for _, v := range car {
				if !floatFinite(v) {
					return false
				}
			}
		}
	}
	return true
}

var validAvailability = map[string]struct{}{
	string(dto.AvailabilityComplete): {}, string(dto.AvailabilityPartial): {},
	string(dto.AvailabilityUnavailable): {}, string(dto.AvailabilityUnknown): {},
}

var validCompletenessReasons = map[string]struct{}{
	string(dto.ReasonLegacyMetadataMissing): {}, string(dto.ReasonSchemaUnsupported): {},
	string(dto.ReasonSourceMissing): {}, string(dto.ReasonLateCapture): {},
	string(dto.ReasonCheckpointFinalize): {}, string(dto.ReasonEventBufferLimit): {},
	string(dto.ReasonEventUploadLimit): {}, string(dto.ReasonIncidentWindowTruncated): {},
	string(dto.ReasonIncidentParticipantLimit): {}, string(dto.ReasonIncidentCollisionLimit): {},
	string(dto.ReasonIncidentFrameLimit): {}, string(dto.ReasonIncidentClipLimit): {},
	string(dto.ReasonIncidentMergeLimit): {}, string(dto.ReasonUploadParticipantsTrimmed): {},
	string(dto.ReasonUploadClipsDropped): {}, string(dto.ReasonRequestBudgetDropped): {},
	string(dto.ReasonTrackOutlineUnavailable): {}, string(dto.ReasonTrackOutlineDownsampled): {},
	string(dto.ReasonPitMeasurementUnavailable): {},
}

// validV2Detail validates the additive schema-v2 contract. v0/v1 retain the
// existing intentionally looser structural rules above; unknown future schema
// versions remain opaque and are guarded at read time rather than interpreted.
func validV2Detail(req *UploadRequest) bool {
	detail := req.Detail
	if detail == nil || detail.Debrief == nil || detail.Completeness == nil {
		return false
	}
	if !validV2Debrief(req, detail, &detail.Completeness.Sections.Pit) {
		return false
	}
	sections := detail.Completeness.Sections
	if !validAggregateSection(detail.Completeness.Analysis, sections) ||
		!validSection(sections.Laps) || !validSection(sections.Sectors) ||
		!validSection(sections.Stints) || !validSection(sections.Tyres) ||
		!validSection(sections.Dynamics) || !validSection(sections.Penalties) ||
		!validSection(sections.Events) || !validSection(sections.Pit) ||
		!validSection(sections.TrackOutline) || !validSection(sections.Incidents) {
		return false
	}
	if !exactCounts(sections.Laps, len(req.Laps), len(req.Laps)) {
		return false
	}
	sectorStored := 0
	for _, lap := range req.Laps {
		if lap.S1Ms != 0 && lap.S2Ms != 0 && lap.S3Ms != 0 {
			sectorStored++
		}
	}
	if !exactCounts(sections.Sectors, len(req.Laps), sectorStored) ||
		!arrayCounts(sections.Stints, len(detail.Stints)) ||
		!arrayCounts(sections.Dynamics, len(detail.Dynamics)) ||
		!arrayCounts(sections.Events, len(detail.Events)) ||
		!arrayCounts(sections.Incidents, len(detail.Incidents)) ||
		!exactCounts(sections.Penalties, 1, 1) || !exactCounts(sections.Tyres, 1, 1) ||
		!exactCounts(sections.Pit, 1, 1) {
		return false
	}
	if !validV2SectionAvailabilityTruth(sections) {
		return false
	}
	if !validV2Outline(detail, sections.TrackOutline) {
		return false
	}
	for i := range detail.Incidents {
		if !validV2Incident(&detail.Incidents[i]) {
			return false
		}
	}
	return true
}

func validAggregateSection(section UploadSectionCompleteness, sections UploadCompletenessSections) bool {
	if section.wire && (!section.capturedCountPresent || !section.storedCountPresent) {
		return false
	}
	if section.CapturedCount != nil || section.StoredCount != nil {
		return false
	}
	if !validSectionShape(section) {
		return false
	}
	if section.Status == string(dto.AvailabilityUnknown) {
		return false
	}
	return section.Status == aggregateAvailability(sections)
}

// aggregateAvailability mirrors the frozen sender truth table. The platform
// validates the producer's status instead of trusting an arbitrary aggregate
// label that could conceal an unavailable core section.
func aggregateAvailability(sections UploadCompletenessSections) string {
	core := []UploadSectionCompleteness{
		sections.Laps, sections.Sectors, sections.Stints, sections.Tyres,
		sections.Dynamics, sections.Penalties, sections.Events, sections.Pit,
		sections.Incidents,
	}
	allComplete, allUnknown := true, true
	usable, unavailable := false, false
	for _, section := range core {
		if section.Status != string(dto.AvailabilityComplete) {
			allComplete = false
		}
		if section.Status != string(dto.AvailabilityUnknown) {
			allUnknown = false
		}
		if section.Status == string(dto.AvailabilityComplete) || section.Status == string(dto.AvailabilityPartial) {
			usable = true
		}
		if section.Status == string(dto.AvailabilityUnavailable) {
			unavailable = true
		}
	}
	switch {
	case allComplete:
		return string(dto.AvailabilityComplete)
	case allUnknown:
		return string(dto.AvailabilityUnknown)
	case !usable && unavailable:
		return string(dto.AvailabilityUnavailable)
	default:
		return string(dto.AvailabilityPartial)
	}
}

func validSection(section UploadSectionCompleteness) bool {
	if section.CapturedCount == nil || section.StoredCount == nil || *section.CapturedCount < 0 || *section.StoredCount < 0 ||
		*section.CapturedCount < *section.StoredCount {
		return false
	}
	if !validSectionShape(section) {
		return false
	}
	if section.Status == string(dto.AvailabilityUnknown) {
		return false
	}
	// A complete section cannot conceal an explicit loss. This generic rule is
	// intentionally separate from unavailable required-object envelopes, whose
	// status is not complete and whose source-missing reason is valid.
	if section.Status == string(dto.AvailabilityComplete) {
		return len(section.Reasons) == 0 && *section.CapturedCount == *section.StoredCount
	}
	if section.Status == string(dto.AvailabilityPartial) {
		return len(section.Reasons) > 0 || *section.CapturedCount != *section.StoredCount
	}
	return true
}

func validV2SectionAvailabilityTruth(sections UploadCompletenessSections) bool {
	// A v2 unavailable array/fact has no usable stored data. Penalties, tyres,
	// and pit are the one deliberate exception: their required debrief envelope
	// occupies object unit 1 even when it contains only nullable placeholders.
	for _, section := range []UploadSectionCompleteness{
		sections.Laps, sections.Sectors, sections.Stints, sections.Dynamics,
		sections.Events, sections.TrackOutline, sections.Incidents,
	} {
		if section.Status == string(dto.AvailabilityUnavailable) &&
			(*section.StoredCount != 0 || len(section.Reasons) == 0) {
			return false
		}
	}
	for _, section := range []UploadSectionCompleteness{sections.Penalties, sections.Tyres, sections.Pit} {
		if section.Status == string(dto.AvailabilityUnavailable) &&
			(*section.CapturedCount != 1 || *section.StoredCount != 1 || !containsReason(section.Reasons, string(dto.ReasonSourceMissing))) {
			return false
		}
	}
	return true
}

func validSectionShape(section UploadSectionCompleteness) bool {
	if (section.wire && (!section.statusPresent || !section.reasonsPresent)) ||
		section.Reasons == nil {
		return false
	}
	if _, ok := validAvailability[section.Status]; !ok {
		return false
	}
	seen := make(map[string]struct{}, len(section.Reasons))
	for _, reason := range section.Reasons {
		if _, ok := validCompletenessReasons[reason]; !ok {
			return false
		}
		if _, duplicate := seen[reason]; duplicate {
			return false
		}
		seen[reason] = struct{}{}
	}
	return true
}

func exactCounts(section UploadSectionCompleteness, captured, stored int) bool {
	return section.CapturedCount != nil && section.StoredCount != nil &&
		*section.CapturedCount == captured && *section.StoredCount == stored
}

func arrayCounts(section UploadSectionCompleteness, stored int) bool {
	return section.CapturedCount != nil && section.StoredCount != nil &&
		*section.CapturedCount >= stored && *section.StoredCount == stored
}

func validV2Debrief(req *UploadRequest, detail *UploadDetail, pitSection *UploadSectionCompleteness) bool {
	if detail == nil || detail.Debrief == nil {
		return false
	}
	if len(detail.debriefRaw) > 0 && !validV2DebriefWire(detail.debriefRaw) {
		return false
	}
	debrief := detail.Debrief
	if debrief == nil || debrief.Pit.Stops < 0 || debrief.Pit.Stops > 100 {
		return false
	}
	hasLane := debrief.Pit.PitLaneTimeMs != nil
	hasStationary := debrief.Pit.StationaryTimeMs != nil
	if hasLane != hasStationary {
		return false
	}
	if hasLane {
		if debrief.Pit.Stops <= 0 || *debrief.Pit.PitLaneTimeMs == 0 || *debrief.Pit.PitLaneTimeMs > 600000 ||
			*debrief.Pit.StationaryTimeMs > *debrief.Pit.PitLaneTimeMs || req.Pit == nil ||
			(req.Pit.wire && (!req.Pit.stopsPresent || !req.Pit.pitLanePresent || !req.Pit.stationaryPresent ||
				req.Pit.stopsNull || req.Pit.pitLaneNull || req.Pit.stationaryNull)) ||
			req.Pit.Stops != debrief.Pit.Stops || req.Pit.PitLaneTimeMs != *debrief.Pit.PitLaneTimeMs ||
			req.Pit.StationaryMs != *debrief.Pit.StationaryTimeMs {
			return false
		}
		if pitSection.Status == string(dto.AvailabilityUnavailable) || pitSection.Status == string(dto.AvailabilityUnknown) {
			return false
		}
	} else if req.Pit != nil {
		return false
	}
	if debrief.Pit.Stops > 0 && !hasLane && (pitSection.Status != string(dto.AvailabilityPartial) || !containsReason(pitSection.Reasons, string(dto.ReasonPitMeasurementUnavailable))) {
		return false
	}
	return true
}

func containsReason(reasons []string, wanted string) bool {
	for _, reason := range reasons {
		if reason == wanted {
			return true
		}
	}
	return false
}

func validV2Outline(detail *UploadDetail, section UploadSectionCompleteness) bool {
	if detail == nil {
		return false
	}
	outline := detail.TrackOutline
	if outline == nil {
		return section.Status == string(dto.AvailabilityUnavailable) &&
			exactCounts(section, 0, 0) &&
			containsReason(section.Reasons, string(dto.ReasonTrackOutlineUnavailable))
	}
	if len(detail.trackOutlineRaw) > 0 && !validV2OutlineWire(detail.trackOutlineRaw) {
		return false
	}
	if len(outline.Points) < 2 || len(outline.Points) > 256 ||
		!finiteOnly(outline.Bounds.MinX) || !finiteOnly(outline.Bounds.MaxX) ||
		!finiteOnly(outline.Bounds.MinZ) || !finiteOnly(outline.Bounds.MaxZ) ||
		outline.Bounds.MinX > outline.Bounds.MaxX || outline.Bounds.MinZ > outline.Bounds.MaxZ {
		return false
	}
	for _, point := range outline.Points {
		if !finiteOnly(point[0]) || !finiteOnly(point[1]) || point[0] < outline.Bounds.MinX || point[0] > outline.Bounds.MaxX ||
			point[1] < outline.Bounds.MinZ || point[1] > outline.Bounds.MaxZ {
			return false
		}
	}
	if section.Status != string(dto.AvailabilityComplete) && section.Status != string(dto.AvailabilityPartial) ||
		section.StoredCount == nil || section.CapturedCount == nil ||
		*section.StoredCount != len(outline.Points) || *section.CapturedCount < *section.StoredCount {
		return false
	}
	if section.Status == string(dto.AvailabilityComplete) {
		return *section.CapturedCount == *section.StoredCount && len(section.Reasons) == 0
	}
	return *section.CapturedCount > *section.StoredCount &&
		containsReason(section.Reasons, string(dto.ReasonTrackOutlineDownsampled))
}

func validV2Incident(incident *UploadIncident) bool {
	if incident == nil || incident.Completeness == nil || !validIncidentCompleteness(incident.Completeness) {
		return false
	}
	if incident.completenessWire && !validV2IncidentCompletenessWire(incident.completenessRaw) {
		return false
	}
	participantIDs := make(map[int]struct{}, len(incident.Participants))
	participantPositions := make(map[int]int, len(incident.Participants))
	players := 0
	for position, participant := range incident.Participants {
		if _, duplicate := participantIDs[participant.Idx]; duplicate {
			return false
		}
		participantIDs[participant.Idx] = struct{}{}
		participantPositions[participant.Idx] = position
		if participant.IsPlayer {
			players++
		}
		// TeamID:nil is valid explicit null. The presence bit is populated for
		// decoded JSON, where omission is prohibited by the v2 wire contract.
		if !participant.teamIDPresent && incident.completenessWire {
			return false
		}
	}
	if players != 1 {
		return false
	}
	for _, collision := range incident.Collisions {
		if _, ok := participantIDs[collision[0]]; !ok {
			return false
		}
		if _, ok := participantIDs[collision[1]]; !ok {
			return false
		}
	}
	lastTime := int64(-1)
	for _, frame := range incident.Frames {
		if frame.TMs <= lastTime || len(frame.Cars) != len(incident.Participants) || frame.TelemetryUnavailable == nil ||
			(!frame.telemetryPresent && incident.completenessWire) {
			return false
		}
		lastTime = frame.TMs
		unavailable := make(map[int]struct{}, len(frame.TelemetryUnavailable))
		for _, idx := range frame.TelemetryUnavailable {
			if _, ok := participantIDs[idx]; !ok {
				return false
			}
			if frame.Cars[participantPositions[idx]] == nil {
				return false
			}
			if _, duplicate := unavailable[idx]; duplicate {
				return false
			}
			unavailable[idx] = struct{}{}
		}
		for _, car := range frame.Cars {
			if car != nil && !validV2CarTuple(car) {
				return false
			}
		}
	}
	return incident.Completeness.StoredParticipantCount == len(incident.Participants) &&
		incident.Completeness.StoredFrameCount == len(incident.Frames) &&
		validV2IncidentCompletenessTruth(incident.Completeness)
}

func validV2IncidentCompletenessTruth(completeness *UploadIncidentCompleteness) bool {
	if completeness == nil {
		return false
	}
	countsEqual := completeness.CapturedParticipantCount != nil && completeness.CapturedFrameCount != nil &&
		*completeness.CapturedParticipantCount == completeness.StoredParticipantCount &&
		*completeness.CapturedFrameCount == completeness.StoredFrameCount
	hasLossEvidence := len(completeness.Reasons) > 0 || !countsEqual
	switch completeness.Status {
	case string(dto.AvailabilityComplete):
		return !hasLossEvidence
	case string(dto.AvailabilityPartial):
		return hasLossEvidence
	case string(dto.AvailabilityUnavailable), string(dto.AvailabilityUnknown):
		// validIncident already requires at least one participant and frame for
		// every v2 clip, so it cannot honestly be unavailable or unknown.
		return false
	default:
		return false
	}
}

func validIncidentCompleteness(completeness *UploadIncidentCompleteness) bool {
	if completeness.CapturedParticipantCount == nil || completeness.CapturedFrameCount == nil ||
		*completeness.CapturedParticipantCount < completeness.StoredParticipantCount ||
		*completeness.CapturedFrameCount < completeness.StoredFrameCount ||
		completeness.StoredParticipantCount < 0 || completeness.StoredFrameCount < 0 {
		return false
	}
	return completeness.Status != string(dto.AvailabilityUnknown) &&
		validSectionShape(UploadSectionCompleteness{Status: completeness.Status, Reasons: completeness.Reasons})
}

func validV2CarTuple(car []float64) bool {
	if len(car) != incidentCarFrameValues {
		return false
	}
	for _, value := range car {
		if !finiteOnly(value) {
			return false
		}
	}
	return car[9] >= 0 && car[10] >= 0 && car[10] <= 1 && car[11] >= 0 && car[11] <= 1 &&
		car[12] >= -1 && car[12] <= 1 && car[13] >= -1 && car[13] <= 8 && math.Trunc(car[13]) == car[13]
}

func finiteOnly(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// UploadLap is one lap in an ingest payload. Every field is attacker-controlled;
// `Valid` is only an advisory input to the server-side validity decision.
type UploadLap struct {
	LapNumber int    `json:"lapNumber"`
	LapMs     uint32 `json:"lapMs"`
	S1Ms      uint32 `json:"s1Ms"`
	S2Ms      uint32 `json:"s2Ms"`
	S3Ms      uint32 `json:"s3Ms"`
	Tyre      string `json:"tyre"`
	Valid     bool   `json:"valid"`
}

// UploadSetup mirrors packets.CarSetupData (23 fields). Stored privately in
// race_setup; never returned on a public endpoint.
type UploadSetup struct {
	FrontWing              int     `json:"frontWing"`
	RearWing               int     `json:"rearWing"`
	OnThrottle             int     `json:"onThrottle"`
	OffThrottle            int     `json:"offThrottle"`
	FrontCamber            float64 `json:"frontCamber"`
	RearCamber             float64 `json:"rearCamber"`
	FrontToe               float64 `json:"frontToe"`
	RearToe                float64 `json:"rearToe"`
	FrontSuspension        int     `json:"frontSuspension"`
	RearSuspension         int     `json:"rearSuspension"`
	FrontAntiRollBar       int     `json:"frontAntiRollBar"`
	RearAntiRollBar        int     `json:"rearAntiRollBar"`
	FrontSuspensionHeight  int     `json:"frontSuspensionHeight"`
	RearSuspensionHeight   int     `json:"rearSuspensionHeight"`
	BrakePressure          int     `json:"brakePressure"`
	BrakeBias              int     `json:"brakeBias"`
	EngineBraking          int     `json:"engineBraking"`
	RearLeftTyrePressure   float64 `json:"rearLeftTyrePressure"`
	RearRightTyrePressure  float64 `json:"rearRightTyrePressure"`
	FrontLeftTyrePressure  float64 `json:"frontLeftTyrePressure"`
	FrontRightTyrePressure float64 `json:"frontRightTyrePressure"`
	Ballast                int     `json:"ballast"`
	FuelLoad               float64 `json:"fuelLoad"`
}

// UploadRequest is the POST /races body. sourceRaceId is the local
// RaceSummary.ID; (account, sourceRaceId) is unique so re-upload is a no-op
// reject. Laps feed the (public) leaderboards; Setup is the private sellable
// snapshot; Detail is the private rich document (stints/dynamics/events) stored
// opaquely in race_detail and never surfaced on a public endpoint.
type UploadRequest struct {
	Strategy      *strategy.Evidence `json:"strategy,omitempty"`
	SourceRaceID  string             `json:"sourceRaceId"`
	TrackID       int                `json:"trackId"`
	TrackName     string             `json:"trackName"`
	SessionType   string             `json:"sessionType"`
	GameFormat    string             `json:"gameFormat"`
	Laps          []UploadLap        `json:"laps"`
	Setup         *UploadSetup       `json:"setup,omitempty"`
	SchemaVersion int                `json:"schemaVersion,omitempty"`
	Detail        *UploadDetail      `json:"detail,omitempty"`
	Pit           *UploadPit         `json:"pit,omitempty"`
	// RecordedAt is the sender's summary/finish record time, not an upload
	// timestamp. A nil value deliberately preserves legacy unknown history.
	RecordedAt *time.Time `json:"recordedAt,omitempty"`
	// FinishPosition is the last live position at a SEND-triggered Race/Race
	// 2/Race 3 close. It is not supplied for session switches or legacy files.
	FinishPosition *int `json:"finishPosition,omitempty"`
}

// UploadPit mirrors the measured fields of races.RacePitSummary. Stored
// relationally in race_pit_loss for public track/type pit-loss averages. The
// sender sends this only when a real measurement exists (PitLaneTimeMs>0); a
// pure-estimate summary is omitted so averages stay measurement-only.
type UploadPit struct {
	Stops         int    `json:"stops"`
	PitLaneTimeMs uint32 `json:"pitLaneTimeMs"`
	StationaryMs  uint32 `json:"stationaryMs"`
	// Presence flags are only used by schema-v2 validation. A genuine measured
	// stationary time can be zero, so scalar decoding alone cannot distinguish
	// that value from an omitted top-level pit field.
	wire              bool
	stopsPresent      bool
	pitLanePresent    bool
	stationaryPresent bool
	stopsNull         bool
	pitLaneNull       bool
	stationaryNull    bool
}

// UploadDetail is the rich, private per-race document stored (versioned) in
// race_detail. Per-lap timing lives in Laps (leaderboard) and the setup in Setup,
// so Detail carries only what has no relational home: stints, per-lap dynamics,
// and the event/issue timeline. Stored opaquely — validated for size, re-marshaled
// canonically, never trusted for any server-derived value.
type UploadDetail struct {
	Stints    []UploadStint    `json:"stints,omitempty"`
	Dynamics  []UploadDynamic  `json:"dynamics,omitempty"`
	Events    []UploadEvent    `json:"events,omitempty"`
	Incidents []UploadIncident `json:"incidents,omitempty"`
	// CaptureStartLap: uploader's lap when its capture began (1 = full session
	// observed, >1 = late attach — dynamics before that lap were never measured).
	// FinalizeTrigger: what closed the summary client-side (race-end event code,
	// "session-switch", "idle-timeout", "shutdown"); checkpoint-class values mean
	// the session may not have been over at save time. Both omitempty so legacy
	// uploads keep their payload key set unchanged.
	CaptureStartLap int                 `json:"captureStartLap,omitempty"`
	FinalizeTrigger string              `json:"finalizeTrigger,omitempty"`
	Debrief         *UploadDebrief      `json:"debrief,omitempty"`
	TrackOutline    *UploadTrackOutline `json:"trackOutline,omitempty"`
	Completeness    *UploadCompleteness `json:"completeness,omitempty"`
	// Presence bits are populated only when decoding JSON. Programmatic callers
	// can represent a required nullable teamId with TeamID:nil; HTTP decoding
	// additionally rejects an omitted key rather than conflating it with null.
	debriefPresent      bool
	completenessPresent bool
	debriefRaw          json.RawMessage
	trackOutlineRaw     json.RawMessage
}

// UploadIncident mirrors the sender's uploadIncident (dto.IncidentClip): a
// player-involved collision capture. Frames[i].Cars[j] aligns with
// Participants[j]; each non-nil entry is a fixed 14-value array. Structural
// bounds are enforced in validIncident; the contents stay opaque.
type UploadIncident struct {
	SessionTimeMs    int64                       `json:"sessionTimeMs"`
	WindowStartMs    int64                       `json:"windowStartMs"`
	FrameIntervalMs  int                         `json:"frameIntervalMs"`
	Lap              int                         `json:"lap,omitempty"`
	Collisions       [][2]int                    `json:"collisions"`
	Participants     []UploadIncidentParticipant `json:"participants"`
	Frames           []UploadIncidentFrame       `json:"frames"`
	Completeness     *UploadIncidentCompleteness `json:"completeness,omitempty"`
	completenessWire bool
	completenessRaw  json.RawMessage
}

// UploadIncidentParticipant mirrors dto.IncidentParticipant.
type UploadIncidentParticipant struct {
	Idx           int     `json:"idx"`
	Name          string  `json:"name,omitempty"`
	TeamID        *int    `json:"teamId"`
	IsPlayer      bool    `json:"isPlayer,omitempty"`
	MinDistM      float64 `json:"minDistM"`
	teamIDPresent bool
}

// UploadIncidentFrame mirrors dto.IncidentFrame.
type UploadIncidentFrame struct {
	TMs                  int64       `json:"tMs"`
	Cars                 [][]float64 `json:"cars"`
	TelemetryUnavailable []int       `json:"telemetryUnavailable"`
	telemetryPresent     bool
}

// UploadSectionCompleteness mirrors the frozen wire shape. Counts are pointers
// because schema v2 permits null only for aggregate analysis; every individual
// section is validated as explicit numeric values.
type UploadSectionCompleteness struct {
	Status        string   `json:"status"`
	Reasons       []string `json:"reasons"`
	CapturedCount *int     `json:"capturedCount"`
	StoredCount   *int     `json:"storedCount"`
	// JSON-wire presence is only relevant to schema-v2 validation. Direct Go
	// callers keep the ergonomic zero-value construction used by legacy tests.
	wire                 bool
	statusPresent        bool
	reasonsPresent       bool
	capturedCountPresent bool
	storedCountPresent   bool
}

type UploadCompletenessSections struct {
	Laps         UploadSectionCompleteness `json:"laps"`
	Sectors      UploadSectionCompleteness `json:"sectors"`
	Stints       UploadSectionCompleteness `json:"stints"`
	Tyres        UploadSectionCompleteness `json:"tyres"`
	Dynamics     UploadSectionCompleteness `json:"dynamics"`
	Penalties    UploadSectionCompleteness `json:"penalties"`
	Events       UploadSectionCompleteness `json:"events"`
	Pit          UploadSectionCompleteness `json:"pit"`
	TrackOutline UploadSectionCompleteness `json:"trackOutline"`
	Incidents    UploadSectionCompleteness `json:"incidents"`
}

type UploadCompleteness struct {
	Analysis UploadSectionCompleteness  `json:"analysis"`
	Sections UploadCompletenessSections `json:"sections"`
}

type UploadIncidentCompleteness struct {
	Status                   string   `json:"status"`
	Reasons                  []string `json:"reasons"`
	CapturedParticipantCount *int     `json:"capturedParticipantCount"`
	StoredParticipantCount   int      `json:"storedParticipantCount"`
	CapturedFrameCount       *int     `json:"capturedFrameCount"`
	StoredFrameCount         int      `json:"storedFrameCount"`
}

type UploadDebrief struct {
	Penalties UploadPenaltyDebrief `json:"penalties"`
	Tyres     UploadTyreDebrief    `json:"tyres"`
	Pit       UploadPitDebrief     `json:"pit"`
}

type UploadPenaltyDebrief struct {
	TimePenaltySeconds   int `json:"timePenaltySeconds"`
	Warnings             int `json:"warnings"`
	CornerCutWarnings    int `json:"cornerCutWarnings"`
	UnservedDriveThrough int `json:"unservedDriveThrough"`
	UnservedStopGo       int `json:"unservedStopGo"`
}

type UploadTyreDebrief struct {
	FinalCompound    *string `json:"finalCompound"`
	FinalAge         *int    `json:"finalAge"`
	AverageWearPct   *int    `json:"averageWearPct"`
	PeakWearPct      *int    `json:"peakWearPct"`
	FinalSetWearPct  *int    `json:"finalSetWearPct"`
	LifeSpan         *int    `json:"lifeSpan"`
	UsableLife       *int    `json:"usableLife"`
	LifeRemainingPct *int    `json:"lifeRemainingPct"`
}

type UploadPitDebrief struct {
	Stops            int     `json:"stops"`
	PitLaneTimeMs    *uint32 `json:"pitLaneTimeMs"`
	StationaryTimeMs *uint32 `json:"stationaryTimeMs"`
}

type UploadTrackOutline struct {
	Points [][2]float64        `json:"points"`
	Bounds UploadOutlineBounds `json:"bounds"`
}

type UploadOutlineBounds struct {
	MinX float64 `json:"minX"`
	MaxX float64 `json:"maxX"`
	MinZ float64 `json:"minZ"`
	MaxZ float64 `json:"maxZ"`
}

// UnmarshalJSON records required-v2 key presence without changing the public Go
// construction ergonomics used by internal callers/tests. A JSON null teamId is
// valid and leaves TeamID nil; an omitted teamId is distinguishable and rejected
// only for decoded schema-v2 payloads.
func (p *UploadIncidentParticipant) UnmarshalJSON(data []byte) error {
	type plain UploadIncidentParticipant
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = UploadIncidentParticipant(decoded)
	_, p.teamIDPresent = fields["teamId"]
	return nil
}

func (f *UploadIncidentFrame) UnmarshalJSON(data []byte) error {
	type plain UploadIncidentFrame
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*f = UploadIncidentFrame(decoded)
	_, f.telemetryPresent = fields["telemetryUnavailable"]
	return nil
}

func (i *UploadIncident) UnmarshalJSON(data []byte) error {
	type plain UploadIncident
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*i = UploadIncident(decoded)
	i.completenessWire = true
	i.completenessRaw = append(i.completenessRaw[:0], fields["completeness"]...)
	return nil
}

func (d *UploadDetail) UnmarshalJSON(data []byte) error {
	type plain UploadDetail
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*d = UploadDetail(decoded)
	_, d.debriefPresent = fields["debrief"]
	_, d.completenessPresent = fields["completeness"]
	d.debriefRaw = append(d.debriefRaw[:0], fields["debrief"]...)
	d.trackOutlineRaw = append(d.trackOutlineRaw[:0], fields["trackOutline"]...)
	return nil
}

func (p *UploadPit) UnmarshalJSON(data []byte) error {
	type plain UploadPit
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = UploadPit(decoded)
	p.wire = true
	_, p.stopsPresent = fields["stops"]
	_, p.pitLanePresent = fields["pitLaneTimeMs"]
	_, p.stationaryPresent = fields["stationaryMs"]
	p.stopsNull = jsonRawNull(fields["stops"])
	p.pitLaneNull = jsonRawNull(fields["pitLaneTimeMs"])
	p.stationaryNull = jsonRawNull(fields["stationaryMs"])
	return nil
}

func (section *UploadSectionCompleteness) UnmarshalJSON(data []byte) error {
	type plain UploadSectionCompleteness
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*section = UploadSectionCompleteness(decoded)
	section.wire = true
	_, section.statusPresent = fields["status"]
	_, section.reasonsPresent = fields["reasons"]
	_, section.capturedCountPresent = fields["capturedCount"]
	_, section.storedCountPresent = fields["storedCount"]
	return nil
}

// validV2DebriefWire closes the JSON-null/omission gap left by Go's scalar
// decoding: json.Unmarshal turns an omitted or null integer into the same zero
// value. The v2 detail is exact about field presence, while programmatic
// internal callers intentionally remain supported without wire bookkeeping.
func validV2DebriefWire(raw json.RawMessage) bool {
	debrief, ok := requiredJSONObject(raw, "penalties", "tyres", "pit")
	if !ok || jsonRawNull(debrief["penalties"]) || jsonRawNull(debrief["tyres"]) || jsonRawNull(debrief["pit"]) {
		return false
	}
	penalties, ok := requiredJSONObject(debrief["penalties"], "timePenaltySeconds", "warnings", "cornerCutWarnings", "unservedDriveThrough", "unservedStopGo")
	if !ok {
		return false
	}
	for _, key := range []string{"timePenaltySeconds", "warnings", "cornerCutWarnings", "unservedDriveThrough", "unservedStopGo"} {
		if jsonRawNull(penalties[key]) {
			return false
		}
	}
	if _, ok := requiredJSONObject(debrief["tyres"], "finalCompound", "finalAge", "averageWearPct", "peakWearPct", "finalSetWearPct", "lifeSpan", "usableLife", "lifeRemainingPct"); !ok {
		return false
	}
	pit, ok := requiredJSONObject(debrief["pit"], "stops", "pitLaneTimeMs", "stationaryTimeMs")
	return ok && !jsonRawNull(pit["stops"])
}

func validV2IncidentCompletenessWire(raw json.RawMessage) bool {
	completeness, ok := requiredJSONObject(raw, "status", "reasons", "capturedParticipantCount", "storedParticipantCount", "capturedFrameCount", "storedFrameCount")
	if !ok {
		return false
	}
	for _, key := range []string{"status", "reasons", "capturedParticipantCount", "storedParticipantCount", "capturedFrameCount", "storedFrameCount"} {
		if jsonRawNull(completeness[key]) {
			return false
		}
	}
	return true
}

func validV2OutlineWire(raw json.RawMessage) bool {
	outline, ok := requiredJSONObject(raw, "points", "bounds")
	if !ok || jsonRawNull(outline["points"]) || jsonRawNull(outline["bounds"]) {
		return false
	}
	bounds, ok := requiredJSONObject(outline["bounds"], "minX", "maxX", "minZ", "maxZ")
	if !ok {
		return false
	}
	for _, key := range []string{"minX", "maxX", "minZ", "maxZ"} {
		if jsonRawNull(bounds[key]) {
			return false
		}
	}
	return true
}

func requiredJSONObject(raw json.RawMessage, keys ...string) (map[string]json.RawMessage, bool) {
	if len(raw) == 0 || jsonRawNull(raw) {
		return nil, false
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, false
	}
	for _, key := range keys {
		if _, exists := object[key]; !exists {
			return nil, false
		}
	}
	return object, true
}

func jsonRawNull(raw json.RawMessage) bool {
	return len(raw) == 0 || string(raw) == "null"
}

// UploadStint mirrors races.RaceStint.
type UploadStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    int    `json:"startLap,omitempty"`
	EndLap      int    `json:"endLap,omitempty"`
	TireWearPct int    `json:"tireWearPct,omitempty"`
}

// UploadDynamic mirrors dto.DynamicsLapDTO.
type UploadDynamic struct {
	LapNum        int     `json:"lapNum"`
	UndersteerPct float64 `json:"understeerPct"`
	OversteerPct  float64 `json:"oversteerPct"`
	LockupCount   int     `json:"lockupCount"`
	SpinCount     int     `json:"spinCount"`
}

// UploadEvent mirrors dto.RaceControlNotification (the race lap tag + text).
type UploadEvent struct {
	Lap        int    `json:"lap,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Category   string `json:"category"`
	Message    string `json:"message"`
	Severity   string `json:"severity"`
	DriverName string `json:"driverName,omitempty"`
}

// UploadResult is the ingest response. Plausible reports whether the race
// passed the anti-noise gate (NOT trust). BestLapMS is 0 when no lap was valid.
// Duplicate is true on an idempotent re-upload (the race already existed).
type UploadResult struct {
	RaceID     string `json:"raceId"`
	Plausible  bool   `json:"plausible"`
	BestLapMS  uint32 `json:"bestLapMs"`
	StoredLaps int    `json:"storedLaps"`
	ValidLaps  int    `json:"validLaps"`
	Duplicate  bool   `json:"duplicate"`
}

// canonicalizeSetup produces deterministic bytes for a setup so that identical
// setups hash identically (content_hash). Struct field order is fixed by Go's
// json marshaller; floats are rounded to 3 decimals to absorb telemetry jitter.
func canonicalizeSetup(s UploadSetup) ([]byte, string, error) {
	q := s
	q.FrontCamber = round3(q.FrontCamber)
	q.RearCamber = round3(q.RearCamber)
	q.FrontToe = round3(q.FrontToe)
	q.RearToe = round3(q.RearToe)
	q.RearLeftTyrePressure = round3(q.RearLeftTyrePressure)
	q.RearRightTyrePressure = round3(q.RearRightTyrePressure)
	q.FrontLeftTyrePressure = round3(q.FrontLeftTyrePressure)
	q.FrontRightTyrePressure = round3(q.FrontRightTyrePressure)
	q.FuelLoad = round3(q.FuelLoad)
	b, err := json.Marshal(q)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:]), nil
}

func round3(f float64) float64 {
	return math.Round(f*1000) / 1000
}

// validateLap applies the plausibility gate to one lap given the resolved
// bounds. Returns the server-decided validity (advisory).
func validateLap(l UploadLap, minMs, maxMs uint32) bool {
	if l.LapMs < minMs || l.LapMs > maxMs {
		return false
	}
	// Bound each sector individually: a single garbage sector (e.g. 2e9 ms) paired
	// with a zero sector would otherwise skip the sum gate below and be served raw
	// on the public leaderboard. Partial telemetry (a zero sector) stays valid.
	lapTol := int64(l.LapMs) + sectorSumToleranceMs
	if int64(l.S1Ms) > lapTol || int64(l.S2Ms) > lapTol || int64(l.S3Ms) > lapTol {
		return false
	}
	if l.S1Ms > 0 && l.S2Ms > 0 && l.S3Ms > 0 {
		sum := int64(l.S1Ms) + int64(l.S2Ms) + int64(l.S3Ms)
		if diff := int64(l.LapMs) - sum; diff > sectorSumToleranceMs || diff < -sectorSumToleranceMs {
			return false
		}
	}
	return l.Valid
}

// IngestRace stores an uploaded race, its laps, and (optionally) its setup in
// one transaction, deriving best_lap_ms and `verified` on the server. It writes
// NOTHING to the ledger — verified races mint no credits (§trust model). A
// re-upload of the same (account, source) yields ErrDuplicate; a malformed
// payload yields ErrBadUpload.
func (s *Store) IngestRace(ctx context.Context, accountID string, req UploadRequest) (*UploadResult, error) {
	if err := validateUpload(&req); err != nil {
		return nil, err
	}
	minMs, maxMs := s.trackBounds(ctx, req.TrackID)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: ingest begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var raceID string
	err = tx.QueryRow(ctx, `
		INSERT INTO platform.races
		    (account_id, source_race_id, track_id, track_name, session_type, game_format,
		     recorded_at, finish_position, completed_laps)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (account_id, source_race_id) DO NOTHING
		RETURNING id`,
		accountID, req.SourceRaceID, req.TrackID, req.TrackName, req.SessionType, req.GameFormat,
		req.RecordedAt, req.FinishPosition, len(req.Laps),
	).Scan(&raceID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotent re-upload: return the already-stored race instead of failing,
		// so a client retrying after a post-commit timeout doesn't strand a race.
		return s.existingRace(ctx, tx, accountID, req.SourceRaceID)
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: insert race: %w", err)
	}

	var best uint32
	validCount := 0
	for _, lp := range req.Laps {
		sv := validateLap(lp, minMs, maxMs)
		if _, err := tx.Exec(ctx, `
			INSERT INTO platform.laps
			    (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			raceID, lp.LapNumber, lp.LapMs, lp.S1Ms, lp.S2Ms, lp.S3Ms, lp.Tyre, sv,
		); err != nil {
			if isUniqueViolation(err) { // duplicate lap_number (validateUpload backstop)
				return nil, ErrBadUpload
			}
			return nil, fmt.Errorf("platformsvc: insert lap: %w", err)
		}
		if sv {
			validCount++
			if best == 0 || lp.LapMs < best {
				best = lp.LapMs
			}
		}
	}
	plausible := validCount > 0

	// best_lap_ms is NULL (not 0) when no lap was valid.
	var bestArg any
	if plausible {
		bestArg = int32(best)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE platform.races SET best_lap_ms = $1, plausible = $2 WHERE id = $3`,
		bestArg, plausible, raceID,
	); err != nil {
		return nil, fmt.Errorf("platformsvc: update race: %w", err)
	}

	if req.Setup != nil {
		canon, hash, err := canonicalizeSetup(*req.Setup)
		if err != nil {
			return nil, fmt.Errorf("platformsvc: canonicalize setup: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.race_setup (race_id, params_canonical, content_hash) VALUES ($1, $2, $3)`,
			raceID, canon, hash,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: insert setup: %w", err)
		}
	}

	// Rich detail (versioned JSONB), in the same tx as races/laps/setup. Only on
	// the new-race path — a duplicate re-upload returns via existingRace above, so
	// the PK=race_id row is written exactly once with no ON CONFLICT needed.
	if req.Detail != nil {
		payload, err := json.Marshal(req.Detail)
		if err != nil {
			return nil, fmt.Errorf("platformsvc: marshal race detail: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.race_detail (race_id, schema_version, payload) VALUES ($1, $2, $3)`,
			raceID, req.SchemaVersion, string(payload),
		); err != nil {
			return nil, fmt.Errorf("platformsvc: insert race detail: %w", err)
		}
	}

	// Measured pit-loss (relational, for public track/type averages). New-race path
	// only — a duplicate returns via existingRace above, so PK=race_id is written
	// once. Guarded on PitLaneTimeMs>0 so pure-estimate rows never dilute the average.
	if req.Pit != nil && req.Pit.PitLaneTimeMs > 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.race_pit_loss (race_id, stops, pit_lane_time_ms, stationary_ms) VALUES ($1, $2, $3, $4)`,
			raceID, req.Pit.Stops, int32(req.Pit.PitLaneTimeMs), int32(req.Pit.StationaryMs),
		); err != nil {
			return nil, fmt.Errorf("platformsvc: insert pit loss: %w", err)
		}
	}

	if req.Strategy != nil {
		payload, err := json.Marshal(normalizedStrategyEvidence(req, minMs, maxMs))
		if err != nil {
			return nil, fmt.Errorf("platformsvc: marshal strategy: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO platform.race_strategy (race_id, session_uid, evidence) VALUES ($1, $2, $3)`, raceID, req.Strategy.SessionUID, string(payload)); err != nil {
			return nil, fmt.Errorf("platformsvc: insert strategy: %w", err)
		}
	}

	// Proof-of-play: stamp verified_at on the account's first plausible race.
	// NO-FAUCET INVARIANT: this mints no credits and must never touch the ledger.
	if plausible {
		if _, err := tx.Exec(ctx,
			`UPDATE platform.accounts SET verified_at = now() WHERE id = $1 AND verified_at IS NULL`,
			accountID,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: stamp verified_at: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("platformsvc: ingest commit: %w", err)
	}
	return &UploadResult{
		RaceID: raceID, Plausible: plausible, BestLapMS: best,
		StoredLaps: len(req.Laps), ValidLaps: validCount,
	}, nil
}

// existingRace returns the already-stored race for an idempotent re-upload.
// StoredLaps/ValidLaps are left 0 on this path (the counts are not re-derived);
// a client MUST treat Duplicate=true as "already synced" and not read lap counts.
func (s *Store) existingRace(ctx context.Context, tx pgx.Tx, accountID, sourceRaceID string) (*UploadResult, error) {
	res := &UploadResult{Duplicate: true}
	var best *int32
	err := tx.QueryRow(ctx,
		`SELECT id, plausible, best_lap_ms FROM platform.races
		 WHERE account_id = $1 AND source_race_id = $2`,
		accountID, sourceRaceID,
	).Scan(&res.RaceID, &res.Plausible, &best)
	if errors.Is(err, pgx.ErrNoRows) {
		// Concurrent in-flight insert not yet visible; caller retries.
		return nil, ErrDuplicate
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: existing race: %w", err)
	}
	if best != nil {
		res.BestLapMS = uint32(*best)
	}
	return res, nil
}

// trackBounds resolves plausibility bounds for a track, falling back to generic
// physical bounds when the track has no configured row.
func (s *Store) trackBounds(ctx context.Context, trackID int) (uint32, uint32) {
	var mn, mx int
	err := s.pool.QueryRow(ctx,
		`SELECT min_lap_ms, max_lap_ms FROM platform.track_bounds WHERE track_id = $1`, trackID,
	).Scan(&mn, &mx)
	if err != nil || mn <= 0 || mx <= mn {
		return genericMinLapMs, genericMaxLapMs
	}
	return uint32(mn), uint32(mx)
}

// AllowRate records a hit against a fixed one-minute window for key and reports
// whether the caller is still within maxPerMinute. Counters live in the DB so
// limits survive restarts and hold across instances.
func (s *Store) AllowRate(ctx context.Context, key string, maxPerMinute int) (bool, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.rate_limits (key, window_start, count)
		VALUES ($1, date_trunc('minute', now()), 1)
		ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
		RETURNING count`,
		key,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("platformsvc: rate limit: %w", err)
	}
	return count <= maxPerMinute, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
