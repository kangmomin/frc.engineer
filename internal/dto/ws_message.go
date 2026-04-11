package dto

// WebSocket message types
const (
	MessageTypeTelemetry      = "telemetry"
	MessageTypeLapData        = "lapData"
	MessageTypeGetBestLap     = "getBestLap"
	MessageTypePitwallState   = "pitwallState"
	MessageTypeRaceControl    = "raceControl"
	MessageTypeRaceResult     = "raceResult"
	MessageTypePositionUpdate = "positionUpdate"
)

// RaceControlNotification represents a race control event sent to clients
type RaceControlNotification struct {
	ID         string `json:"id,omitempty"`
	Category   string `json:"category"` // "penalty", "warning", "info"
	Message    string `json:"message"`
	Severity   string `json:"severity"` // "critical", "warning", "info"
	DriverName string `json:"driverName,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
}

// WSRequest represents a client request message
type WSRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
}

// WSResponse represents a server response message
type WSResponse struct {
	Type      string      `json:"type"`
	RequestID string      `json:"requestId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// LapDataResponse contains lap telemetry data for chart visualization
type LapDataResponse struct {
	BestLap     *LapTelemetryDTO    `json:"bestLap,omitempty"`
	CurrentLap  []TelemetryPointDTO `json:"currentLap,omitempty"`
	BestLapTime uint32              `json:"bestLapTime"`
}

// LapTelemetryDTO is the frontend-friendly representation of lap telemetry
type LapTelemetryDTO struct {
	TrackID    int8                `json:"trackId"`
	LapTimeMS  uint32              `json:"lapTimeMs"`
	Sector1MS  uint16              `json:"sector1Ms"`
	Sector2MS  uint16              `json:"sector2Ms"`
	Sector3MS  uint16              `json:"sector3Ms"`
	DataPoints []TelemetryPointDTO `json:"dataPoints"`
}

// TelemetryPointDTO is a single telemetry data point for charts
type TelemetryPointDTO struct {
	LapDistance float32 `json:"lapDistance"` // X-axis: distance in metres
	LapTime     uint32  `json:"lapTime"`     // Lap time at this point (ms)
	Speed       uint16  `json:"speed"`       // Speed in km/h
	Throttle    float32 `json:"throttle"`    // 0.0-1.0
	Brake       float32 `json:"brake"`       // 0.0-1.0
	Gear        int8    `json:"gear"`        // -1=R, 0=N, 1-8
}
