package dto

// Incident-clip types: a player-involved collision capture (±1s window at ~20Hz,
// chain-merged up to 5s) of nearby-car motion+input samples. Produced by the
// telemetry incident recorder, attached to RaceSummary as a top-level block (like
// Replay, so DataChannel paths can strip it) and uploaded inside the platform
// race_detail payload. They live in dto for the same reason as RaceDetailInput:
// the telemetry layer (producer) and the races/cmd layers (consumers) share them
// without a layer cycle.

// IncidentMaxParticipants is the maximum supported grid (F1 26: 24 cars).
const IncidentMaxParticipants = 24

// IncidentCarFrameValues is the fixed length of one car's per-frame value array:
// x, y, z, vx, vy, vz, yaw, gLat, gLong, speedKmh, throttle, brake, steer, gear.
const IncidentCarFrameValues = 14

// IncidentDamageValues is the fixed length of one car's damage snapshot, in
// integer percent: front-left wing, front-right wing, rear wing, floor,
// diffuser, sidepod, engine, gearbox, then tyre damage in the packet's RL, RR,
// FL, FR order.
const IncidentDamageValues = 12

// IncidentClip is one captured incident. Frames[i].Cars[j] aligns positionally
// with Participants[j]; a nil entry means no usable sample for that car at that
// tick. FrameIntervalMS is nominal — frames carry their measured game-time TMS.
type IncidentClip struct {
	SessionTimeMS   int64                 `json:"sessionTimeMs"` // first merged COLL (t0, game time)
	WindowStartMS   int64                 `json:"windowStartMs"` // nominal t0−1s, clamped ≥0
	FrameIntervalMS int                   `json:"frameIntervalMs"`
	Lap             int                   `json:"lap,omitempty"`
	Collisions      [][2]int              `json:"collisions"` // merged [vehicleIdx, otherVehicleIdx] pairs
	Participants    []IncidentParticipant `json:"participants"`
	Frames          []IncidentFrame       `json:"frames"`
	// Completeness is emitted for schema-v2 captures. It deliberately stays on
	// the clip (rather than being inferred by a reader) because an early
	// finalization, participant cap, or frame cap is a producer-side fact.
	Completeness IncidentCompleteness `json:"completeness,omitempty"`
}

// IncidentParticipant identifies one captured car. MinDistM is the minimum 3D
// distance to the player over the window (0 for the player itself).
type IncidentParticipant struct {
	Idx  int    `json:"idx"`
	Name string `json:"name,omitempty"`
	// TeamID is required-but-nullable in schema v2. A nil pointer means the
	// participant source was absent; 0 is a valid team id and 255 is the game's
	// real no-team sentinel, so neither may be normalized to nil.
	TeamID   *int    `json:"teamId"`
	IsPlayer bool    `json:"isPlayer,omitempty"`
	MinDistM float64 `json:"minDistM"`
	// DamageBefore and DamageAfter hold IncidentDamageValues entries captured at
	// the first merged COLL and at clip finalization; nil means no fresh
	// CarDamage packet existed then. The packet arrives about every 100ms, so
	// DamageBefore can already include the first contact, and the difference
	// covers every collision merged into the clip.
	DamageBefore []int `json:"damageBefore,omitempty"`
	DamageAfter  []int `json:"damageAfter,omitempty"`
}

// IncidentFrame is one ~50ms tick. Each non-nil Cars entry holds exactly
// IncidentCarFrameValues values in the documented order.
type IncidentFrame struct {
	TMS  int64       `json:"tMs"`
	Cars [][]float64 `json:"cars"`
	// TelemetryUnavailable is a list of participant vehicle indices, not frame
	// columns. It is always a (possibly empty) array for v2 captures and nil for
	// pre-v2 historical clips, preserving the distinction between a genuine zero
	// input and unavailable telemetry.
	TelemetryUnavailable []int `json:"telemetryUnavailable"`
}

// IncidentCompleteness carries capture facts for one stored incident clip.
// Captured counts are nullable only for legacy data; schema-v2 always writes
// explicit values. Stored counts are concrete because they describe this
// serialized clip.
type IncidentCompleteness struct {
	Status                   Availability         `json:"status"`
	Reasons                  []CompletenessReason `json:"reasons"`
	CapturedParticipantCount *int                 `json:"capturedParticipantCount"`
	StoredParticipantCount   int                  `json:"storedParticipantCount"`
	CapturedFrameCount       *int                 `json:"capturedFrameCount"`
	StoredFrameCount         int                  `json:"storedFrameCount"`
}

// IncidentCaptureKey is restart-safe private metadata. It intentionally holds
// only collision identity, never frames or participant telemetry. RaceSummary
// persists it locally so a restarted sender can correctly count eligible clips
// that were refused after the visible clip cap; upload and public/archive paths
// strip the surrounding private metadata.
type IncidentCaptureKey struct {
	SessionTimeMS int64    `json:"sessionTimeMs"`
	Collisions    [][2]int `json:"collisions"`
}
