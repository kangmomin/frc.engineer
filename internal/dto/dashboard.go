package dto

// Dashboard represents the JSON data sent to the dashboard frontend
type Dashboard struct {
	// Core telemetry
	Speed    uint16  `json:"speed"`    // Speed in km/h
	Gear     int8    `json:"gear"`     // -1=R, 0=N, 1-8=forward gears
	RPM      uint16  `json:"rpm"`      // Engine RPM
	Throttle float32 `json:"throttle"` // 0.0 to 1.0
	Brake    float32 `json:"brake"`    // 0.0 to 1.0

	// Delta times (in milliseconds)
	DeltaPersonalBest int32 `json:"deltaPersonalBest"` // Delta to personal best (calculated)
	DeltaCarInFront   int32 `json:"deltaCarInFront"`   // Delta to car in front (from game)
	DeltaRaceLeader   int32 `json:"deltaRaceLeader"`   // Delta to race leader (from game)

	// Lap information
	CurrentLap     uint8  `json:"currentLap"`     // Current lap number
	CurrentLapTime uint32 `json:"currentLapTime"` // Current lap time in ms
	LastLapTime    uint32 `json:"lastLapTime"`    // Last lap time in ms
	BestLapTime    uint32 `json:"bestLapTime"`    // Best lap time in ms
	Position       uint8  `json:"position"`       // Current race position

	// Additional indicators
	DRS        bool  `json:"drs"`        // DRS active
	RevLights  uint8 `json:"revLights"`  // Rev lights percentage (0-100)
	Sector     uint8 `json:"sector"`     // Current sector (0, 1, 2)
	LapInvalid bool  `json:"lapInvalid"` // Whether current lap is invalid

	// Metadata
	Timestamp int64 `json:"timestamp"` // Unix timestamp in milliseconds
}
