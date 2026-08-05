package dto

// Incident-clip types: a player-involved collision capture (±1s window at ~20Hz,
// chain-merged up to 5s) of nearby-car motion+input samples. Produced by the
// telemetry incident recorder, attached to RaceSummary as a top-level block (like
// Replay, so DataChannel paths can strip it) and uploaded inside the platform
// race_detail payload. They live in dto for the same reason as RaceDetailInput:
// the telemetry layer (producer) and the races/cmd layers (consumers) share them
// without a layer cycle.

// IncidentCarFrameValues is the fixed length of one car's per-frame value array:
// x, y, z, vx, vy, vz, yaw, gLat, gLong, speedKmh, throttle, brake, steer, gear.
const IncidentCarFrameValues = 14

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
}

// IncidentParticipant identifies one captured car. MinDistM is the minimum 3D
// distance to the player over the window (0 for the player itself).
type IncidentParticipant struct {
	Idx      int     `json:"idx"`
	Name     string  `json:"name,omitempty"`
	IsPlayer bool    `json:"isPlayer,omitempty"`
	MinDistM float64 `json:"minDistM"`
}

// IncidentFrame is one ~50ms tick. Each non-nil Cars entry holds exactly
// IncidentCarFrameValues values in the documented order.
type IncidentFrame struct {
	TMS  int64       `json:"tMs"`
	Cars [][]float64 `json:"cars"`
}
