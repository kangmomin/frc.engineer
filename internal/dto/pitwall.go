package dto

// PitwallState is the comprehensive state DTO broadcast to pitwall clients
type PitwallState struct {
	Session     *SessionInfo  `json:"session"`
	Drivers     []DriverInfo  `json:"drivers"`
	Positions   []CarPosition `json:"positions"`
	PlayerIndex int           `json:"playerIndex"`
}

// SessionInfo contains session-level data (weather, track, safety car)
type SessionInfo struct {
	Weather     string  `json:"weather"`
	TrackTemp   float32 `json:"trackTemp"`
	AirTemp     float32 `json:"airTemp"`
	SafetyCar   string  `json:"safetyCar"`
	SessionType string  `json:"sessionType"`
	TotalLaps   int     `json:"totalLaps"`
	TrackID     int8    `json:"trackId"`
	TrackLength int     `json:"trackLength"`
}

// DriverInfo contains per-driver race data
type DriverInfo struct {
	Index         int     `json:"index"`
	Name          string  `json:"name"`
	TeamID        int     `json:"teamId"`
	Position      int     `json:"position"`
	CurrentLapNum int     `json:"currentLapNum"`
	LastLapTime   float32 `json:"lastLapTime"`
	BestLapTime   float32 `json:"bestLapTime"`
	TireCompound  string  `json:"tireCompound"`
	TireAge       int     `json:"tireAge"`
	TireWear      [4]int  `json:"tireWear"`
	TireTemp      [4]int  `json:"tireTemp"`
}

// CarPosition contains GPS position for track map rendering
type CarPosition struct {
	Index int     `json:"index"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
}
