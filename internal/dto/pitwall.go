package dto

// PitwallState is the comprehensive state DTO broadcast to pitwall clients
type PitwallState struct {
	Session     *SessionInfo  `json:"session"`
	Drivers     []DriverInfo  `json:"drivers"`
	Positions   []CarPosition `json:"positions"`
	PlayerIndex int           `json:"playerIndex"`
	TrackMap    *TrackMapDTO  `json:"trackMap,omitempty"`
}

// TrackMapDTO holds the full track outline with bounds
type TrackMapDTO struct {
	Points []TrackPointDTO `json:"points"`
	MinX   float64         `json:"minX"`
	MaxX   float64         `json:"maxX"`
	MinZ   float64         `json:"minZ"`
	MaxZ   float64         `json:"maxZ"`
}

// TrackPointDTO represents a single coordinate on the track outline
type TrackPointDTO struct {
	X      float32 `json:"x"`
	Z      float32 `json:"z"`
	Sector int     `json:"sector"`
	DRS    int     `json:"drs"`
}

// MarshalZoneDTO represents a marshal zone for frontend consumption
type MarshalZoneDTO struct {
	Start float32 `json:"start"`
	Flag  int8    `json:"flag"`
}

// WeatherForecastDTO represents a weather forecast entry for frontend consumption
type WeatherForecastDTO struct {
	SessionType     string  `json:"sessionType"`
	TimeOffset      int     `json:"timeOffset"`
	Weather         string  `json:"weather"`
	TrackTemp       float32 `json:"trackTemp"`
	TrackTempChange int     `json:"trackTempChange"`
	AirTemp         float32 `json:"airTemp"`
	AirTempChange   int     `json:"airTempChange"`
	RainPercentage  int     `json:"rainPercentage"`
}

// SessionInfo contains session-level data (weather, track, safety car)
type SessionInfo struct {
	Weather         string               `json:"weather"`
	TrackTemp       float32              `json:"trackTemp"`
	AirTemp         float32              `json:"airTemp"`
	SafetyCar       string               `json:"safetyCar"`
	SessionType     string               `json:"sessionType"`
	TotalLaps       int                  `json:"totalLaps"`
	TrackID         int8                 `json:"trackId"`
	TrackLength     int                  `json:"trackLength"`
	MarshalZones    []MarshalZoneDTO     `json:"marshalZones,omitempty"`
	WeatherForecast []WeatherForecastDTO `json:"weatherForecast,omitempty"`
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
	TireWear        [4]int `json:"tireWear"`
	TireSurfaceTemp [4]int `json:"tireSurfaceTemp"`
	TireInnerTemp   [4]int `json:"tireInnerTemp"`
	BrakeTemp       [4]int `json:"brakeTemp"`

	// Fuel & Energy
	FuelInTank          float32 `json:"fuelInTank"`
	FuelRemainingLaps   float32 `json:"fuelRemainingLaps"`
	FuelMix             int     `json:"fuelMix"`
	ERSStoreEnergy      float32 `json:"ersStoreEnergy"`
	ERSDeployMode       int     `json:"ersDeployMode"`
	ERSDeployedThisLap  float32 `json:"ersDeployedThisLap"`
	ERSHarvestedThisLap float32 `json:"ersHarvestedThisLap"`

	// Damage
	Damage *CarDamage `json:"damage,omitempty"`

	// Strategy
	StintHistory []StintInfoDTO `json:"stintHistory,omitempty"`

	// Pit
	PitStatus    int     `json:"pitStatus"`
	NumPitStops  int     `json:"numPitStops"`
	LapDistance  float32 `json:"lapDistance"`
	PitStopTimer float32 `json:"pitStopTimer"`
	DeltaToCarInFront int     `json:"deltaToCarInFront"`
	DeltaToRaceLeader int     `json:"deltaToRaceLeader"`
	PitLaneTime       int     `json:"pitLaneTime"`
}

// StintInfoDTO represents a completed tire stint
type StintInfoDTO struct {
	Compound string `json:"compound"`
	Laps     int    `json:"laps"`
}

// CarDamage contains damage percentages for car components
type CarDamage struct {
	FrontLeftWing  int  `json:"frontLeftWing"`
	FrontRightWing int  `json:"frontRightWing"`
	RearWing       int  `json:"rearWing"`
	Floor          int  `json:"floor"`
	Diffuser       int  `json:"diffuser"`
	Sidepod        int  `json:"sidepod"`
	Engine         int  `json:"engine"`
	Gearbox        int  `json:"gearbox"`
	DRSFault       bool `json:"drsFault"`
	ERSFault       bool `json:"ersFault"`
}

// CarPosition contains GPS position for track map rendering
type CarPosition struct {
	Index int     `json:"index"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
}
