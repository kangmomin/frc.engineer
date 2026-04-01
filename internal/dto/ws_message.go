package dto

// WebSocket message types
const (
	MessageTypeTelemetry      = "telemetry"      // Server → Client: Real-time telemetry (existing Dashboard)
	MessageTypeLapData        = "lapData"        // Server → Client: Response to getLapData request
	MessageTypeGetBestLap     = "getBestLap"     // Client → Server: Request best lap data
	MessageTypePitwallState   = "pitwallState"   // Server → Client: Comprehensive pitwall state
	MessageTypeRaceControl    = "raceControl"    // Server → Client: Race control notifications
	MessageTypeBattleAlert    = "battleAlert"    // Server → Client: Battle prediction alert
	MessageTypeRaceResult     = "raceResult"     // Server → Client: Race result summary
	MessageTypePositionUpdate = "positionUpdate" // Server → Client: High-frequency car positions (fast channel)
)

// BattleAlertDTO is sent when an overtake is predicted within a few laps
type BattleAlertDTO struct {
	ID            string  `json:"id,omitempty"`
	DriverAhead    string  `json:"driverAhead"`
	DriverBehind   string  `json:"driverBehind"`
	GapSeconds     float64 `json:"gapSeconds"`
	ClosingRate    float64 `json:"closingRatePerLap"` // seconds per lap
	EstOvertakeLap int     `json:"estOvertakeLap"`
	Side           string  `json:"side"` // "ahead" | "behind"
	Timestamp      int64   `json:"timestamp,omitempty"`
}

// RaceControlNotification represents a race control event sent to clients
type RaceControlNotification struct {
	ID         string `json:"id,omitempty"`
	Category   string `json:"category"`             // "penalty", "warning", "info"
	Message    string `json:"message"`
	Severity   string `json:"severity"`             // "critical", "warning", "info"
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
