package dto

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
}
