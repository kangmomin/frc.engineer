package telemetry

import "time"

// TelemetryPoint represents a single data point during a lap
type TelemetryPoint struct {
	LapDistance float32 `json:"lapDistance"` // Distance around current lap in metres (index key)
	SessionTime float32 `json:"sessionTime"` // Session time in seconds
	LapTime     uint32  `json:"lapTime"`     // Lap time at this point in milliseconds
	Speed       uint16  `json:"speed"`       // Speed in km/h
	Throttle    float32 `json:"throttle"`    // Throttle (0.0-1.0)
	Brake       float32 `json:"brake"`       // Brake (0.0-1.0)
	Gear        int8    `json:"gear"`        // Gear (-1 = reverse, 0 = neutral, 1-8 = forward)
}

// LapTelemetry represents complete telemetry data for a lap
type LapTelemetry struct {
	TrackID    int8             `json:"trackId"`
	LapTimeMS  uint32           `json:"lapTimeMs"`
	Sector1MS  uint32           `json:"sector1Ms"`
	Sector2MS  uint32           `json:"sector2Ms"`
	Sector3MS  uint32           `json:"sector3Ms"`
	DataPoints []TelemetryPoint `json:"dataPoints"`
	CreatedAt  time.Time        `json:"createdAt"`
}

// NewLapTelemetry creates a new LapTelemetry with initial capacity
func NewLapTelemetry(trackID int8) *LapTelemetry {
	return &LapTelemetry{
		TrackID:    trackID,
		DataPoints: make([]TelemetryPoint, 0, 1000), // Pre-allocate for ~7km track at 7m intervals
		CreatedAt:  time.Now(),
	}
}

// AddPoint adds a telemetry point to the lap data
func (lt *LapTelemetry) AddPoint(point TelemetryPoint) {
	lt.DataPoints = append(lt.DataPoints, point)
}

// SetLapTimes sets the final lap times after lap completion
func (lt *LapTelemetry) SetLapTimes(lapTimeMS uint32, sector1MS, sector2MS, sector3MS uint32) {
	lt.LapTimeMS = lapTimeMS
	lt.Sector1MS = sector1MS
	lt.Sector2MS = sector2MS
	lt.Sector3MS = sector3MS
}

// PointCount returns the number of telemetry points stored
func (lt *LapTelemetry) PointCount() int {
	return len(lt.DataPoints)
}
