package dto

import "frc.engineer/internal/strategy"

// Availability is the producer-proven availability of a section. It is not a
// UI state: unknown means historical/schema ambiguity, while unavailable means
// the producer knows there is no usable stored data.
type Availability string

const (
	AvailabilityComplete    Availability = "complete"
	AvailabilityPartial     Availability = "partial"
	AvailabilityUnavailable Availability = "unavailable"
	AvailabilityUnknown     Availability = "unknown"
)

// CompletenessReason is intentionally a closed wire vocabulary. Keep these
// strings in one place so the sender, ingest validation, and public read API
// cannot drift.
type CompletenessReason string

const (
	ReasonLegacyMetadataMissing     CompletenessReason = "legacy-metadata-missing"
	ReasonSchemaUnsupported         CompletenessReason = "schema-unsupported"
	ReasonSourceMissing             CompletenessReason = "source-missing"
	ReasonLateCapture               CompletenessReason = "late-capture"
	ReasonCheckpointFinalize        CompletenessReason = "checkpoint-finalize"
	ReasonEventBufferLimit          CompletenessReason = "event-buffer-limit"
	ReasonEventUploadLimit          CompletenessReason = "event-upload-limit"
	ReasonIncidentWindowTruncated   CompletenessReason = "incident-window-truncated"
	ReasonIncidentParticipantLimit  CompletenessReason = "incident-participant-limit"
	ReasonIncidentCollisionLimit    CompletenessReason = "incident-collision-limit"
	ReasonIncidentFrameLimit        CompletenessReason = "incident-frame-limit"
	ReasonIncidentClipLimit         CompletenessReason = "incident-clip-limit"
	ReasonIncidentMergeLimit        CompletenessReason = "incident-merge-limit"
	ReasonUploadParticipantsTrimmed CompletenessReason = "upload-participants-trimmed"
	ReasonUploadClipsDropped        CompletenessReason = "upload-clips-dropped"
	ReasonRequestBudgetDropped      CompletenessReason = "request-budget-dropped"
	ReasonTrackOutlineUnavailable   CompletenessReason = "track-outline-unavailable"
	ReasonTrackOutlineDownsampled   CompletenessReason = "track-outline-downsampled"
	ReasonPitMeasurementUnavailable CompletenessReason = "pit-measurement-unavailable"
)

// SectionCompleteness is the shared v2 shape. Counts are pointers because
// historical data must report null rather than invent a zero; v2 sections write
// explicit numeric counts. Reasons is always serialized as an array by v2
// producers (use an empty slice for no reasons).
type SectionCompleteness struct {
	Status        Availability         `json:"status"`
	Reasons       []CompletenessReason `json:"reasons"`
	CapturedCount *int                 `json:"capturedCount"`
	StoredCount   *int                 `json:"storedCount"`
}

// DetailSections contains the fixed v2 section set. Pointers are avoided so a
// sender cannot accidentally omit an entry when it constructs a schema-v2
// document.
type DetailSections struct {
	Laps         SectionCompleteness `json:"laps"`
	Sectors      SectionCompleteness `json:"sectors"`
	Stints       SectionCompleteness `json:"stints"`
	Tyres        SectionCompleteness `json:"tyres"`
	Dynamics     SectionCompleteness `json:"dynamics"`
	Penalties    SectionCompleteness `json:"penalties"`
	Events       SectionCompleteness `json:"events"`
	Pit          SectionCompleteness `json:"pit"`
	TrackOutline SectionCompleteness `json:"trackOutline"`
	Incidents    SectionCompleteness `json:"incidents"`
}

// RaceDetailCompleteness is the persisted/uploaded v2 completeness envelope.
type RaceDetailCompleteness struct {
	Analysis SectionCompleteness `json:"analysis"`
	Sections DetailSections      `json:"sections"`
}

// TrackOutlineDTO contains actual TrackStore centreline points in the same
// world X/Z coordinate system as incident cars. It never represents a generated
// circuit or boundary.
type TrackOutlineDTO struct {
	Points [][2]float64       `json:"points"`
	Bounds TrackOutlineBounds `json:"bounds"`
}

type TrackOutlineBounds struct {
	MinX float64 `json:"minX"`
	MaxX float64 `json:"maxX"`
	MinZ float64 `json:"minZ"`
	MaxZ float64 `json:"maxZ"`
}

// RaceCaptureProvenance records raw-source observations rather than values
// after normalization. This prevents a genuine zero (for example zero pit
// stops) from being confused with a missing UDP source. It is private local
// restart metadata and is never part of the cloud UploadDetail wire shape.
type RaceCaptureProvenance struct {
	LapDataObserved        bool `json:"lapDataObserved,omitempty"`
	SessionHistoryObserved bool `json:"sessionHistoryObserved,omitempty"`
	CarStatusObserved      bool `json:"carStatusObserved,omitempty"`
	CarDamageObserved      bool `json:"carDamageObserved,omitempty"`
	TyreSetsObserved       bool `json:"tyreSetsObserved,omitempty"`
	PitMeasurementObserved bool `json:"pitMeasurementObserved,omitempty"`
	EventsCaptureActive    bool `json:"eventsCaptureActive,omitempty"`
	IncidentsCaptureActive bool `json:"incidentsCaptureActive,omitempty"`
	EventsSeen             int  `json:"eventsSeen,omitempty"`
	EventsBufferDropped    int  `json:"eventsBufferDropped,omitempty"`
	CheckpointFinalize     bool `json:"checkpointFinalize,omitempty"`
	NormalFinalize         bool `json:"normalFinalize,omitempty"`
	// TrackOutlineSourcePoints preserves the original TrackStore centreline count
	// across restart adoption. It is private provenance: public v2 completeness
	// exposes only the captured/stored point counts derived from it.
	TrackOutlineSourcePoints int  `json:"trackOutlineSourcePoints,omitempty"`
	IncidentMergeLimited     bool `json:"incidentMergeLimited,omitempty"`
	// IncidentClipLimitReached is an explicit local recorder fact. Upload
	// trimming can also make capturedCount exceed storedCount, so that count
	// difference alone must never be reclassified as a recorder clip-cap loss.
	IncidentClipLimitReached bool `json:"incidentClipLimitReached,omitempty"`
}

// RacePrivateCapture is persisted only to allow restart-safe capture merging.
// Callers that serialize summaries to an archive API or DataChannel must clear
// it before encoding.
type RacePrivateCapture struct {
	// Strategy is player-only evidence retained on disk and explicitly mapped
	// to the authenticated race upload. The entire private block is stripped
	// from archive reads and WebRTC summaries.
	Strategy *strategy.Evidence `json:"strategy,omitempty"`
	// RunID distinguishes cumulative snapshots produced by one sender process
	// from a genuinely restarted capture run. It is private restart metadata and
	// is stripped alongside the ledger before every external serialization.
	RunID                string                `json:"runId,omitempty"`
	EligibleIncidentKeys []IncidentCaptureKey  `json:"eligibleIncidentKeys,omitempty"`
	Provenance           RaceCaptureProvenance `json:"provenance"`
}

// Rich race-summary sub-payload types. These carry the player-centric detail that
// is captured at race end and (optionally) uploaded to the platform. They live in
// dto so both the telemetry layer (producer, via PitwallManager accessors) and the
// races layer (consumer, BuildSummary) can reference them without a layer cycle.

// LapTimingDTO is one completed lap's timing. Tyre is derived from stint ranges in
// BuildSummary (the session-history packet does not carry per-lap compound), so the
// PitwallManager accessor leaves it empty.
type LapTimingDTO struct {
	LapNumber int    `json:"lapNumber"`
	LapMs     uint32 `json:"lapMs"`
	S1Ms      uint32 `json:"s1Ms"`
	S2Ms      uint32 `json:"s2Ms"`
	S3Ms      uint32 `json:"s3Ms"`
	Tyre      string `json:"tyre,omitempty"`
	Valid     bool   `json:"valid"`
}

// CarSetupDTO mirrors packets.CarSetupData (23 fields) and the platform ingest
// UploadSetup shape 1:1, so the uploader maps it field-for-field. Captured for the
// player car only; nil when the setup packet was never received.
type CarSetupDTO struct {
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

// RaceDetailInput bundles the rich inputs the processor gathers from PitwallManager
// accessors at race end and hands to the save callback / BuildSummary. Player
// per-lap dynamics are NOT here — they already ride in state.Drivers[player].
type RaceDetailInput struct {
	PlayerLaps  []LapTimingDTO            `json:"playerLaps,omitempty"`
	PlayerSetup *CarSetupDTO              `json:"playerSetup,omitempty"`
	RichEvents  []RaceControlNotification `json:"richEvents,omitempty"`
	// CaptureStartLap is the player's current lap when the sender first observed
	// this session (1 = full capture; >1 = late attach, dynamics before this lap
	// were never measured). 0 = unknown (no lap data seen).
	CaptureStartLap int `json:"captureStartLap,omitempty"`
	// FinalizeTrigger records what caused this summary save: a race-end event code
	// (SEND/CHQF/RCWN), "session-switch", "idle-timeout", or "shutdown". Empty on
	// legacy summaries. Checkpoint-class triggers (idle-timeout/shutdown/CHQF/RCWN
	// under checkpoint mode) mean the session may not have been over at save time.
	FinalizeTrigger string `json:"finalizeTrigger,omitempty"`
	// TrackOutline is a read-only TrackStore snapshot collected without touching
	// live broadcast counters. Nil means no recorded centreline was available.
	TrackOutline *TrackOutlineDTO `json:"trackOutline,omitempty"`
	// Completeness is an optional explicit producer snapshot. The races layer
	// carries it forward and refreshes count facts after incident/upload trims.
	Completeness *RaceDetailCompleteness `json:"completeness,omitempty"`
	// PrivateCapture is restart-only local metadata. It is intentionally not
	// embedded in RaceDetail because RaceDetail maps to cloud JSONB.
	PrivateCapture *RacePrivateCapture `json:"privateCapture,omitempty"`
}
