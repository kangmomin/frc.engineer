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

// CrossoverPredictionDTO summarizes the latest dry-vs-wet pace crossover model.
type CrossoverPredictionDTO struct {
	Available          bool    `json:"available"`
	DryGroup           string  `json:"dryGroup"`
	WetGroup           string  `json:"wetGroup"`
	CurrentDeltaMS     float64 `json:"currentDeltaMs"`
	TrendDeltaMSPerLap float64 `json:"trendDeltaMsPerLap"`
	AvgLapTimeMS       float64 `json:"avgLapTimeMs"`
	DrySampleCount     int     `json:"drySampleCount"`
	WetSampleCount     int     `json:"wetSampleCount"`
	HistoryDepth       int     `json:"historyDepth"`
	CurrentDryAvgMS    float64 `json:"currentDryAvgMs"`
	CurrentWetAvgMS    float64 `json:"currentWetAvgMs"`
	Reason             string  `json:"reason,omitempty"`
}

// SessionInfo contains session-level data (weather, track, safety car)
type SessionInfo struct {
	Weather                string                  `json:"weather"`
	TrackTemp              float32                 `json:"trackTemp"`
	AirTemp                float32                 `json:"airTemp"`
	SafetyCar              string                  `json:"safetyCar"`
	SessionType            string                  `json:"sessionType"`
	TotalLaps              int                     `json:"totalLaps"`
	TrackID                int8                    `json:"trackId"`
	TrackName              string                  `json:"trackName"`
	TrackLength            int                     `json:"trackLength"`
	PitStopWindowIdealLap  int                     `json:"pitStopWindowIdealLap,omitempty"`
	PitStopWindowLatestLap int                     `json:"pitStopWindowLatestLap,omitempty"`
	PitStopRejoinPosition  int                     `json:"pitStopRejoinPosition,omitempty"`
	MarshalZones           []MarshalZoneDTO        `json:"marshalZones,omitempty"`
	WeatherForecast        []WeatherForecastDTO    `json:"weatherForecast,omitempty"`
	CrossoverPrediction    *CrossoverPredictionDTO `json:"crossoverPrediction,omitempty"`
}

// DriverInfo contains per-driver race data
type DriverInfo struct {
	Index           int     `json:"index"`
	Name            string  `json:"name"`
	TeamID          int     `json:"teamId"`
	Position        int     `json:"position"`
	CurrentLapNum   int     `json:"currentLapNum"`
	Speed           uint16  `json:"speed"`
	Throttle        float32 `json:"throttle"`
	Brake           float32 `json:"brake"`
	Gear            int8    `json:"gear"`
	Steering        float32 `json:"steering"`
	LastLapTime     float32 `json:"lastLapTime"`
	BestLapTime     float32 `json:"bestLapTime"`
	TireCompound    string  `json:"tireCompound"`
	TireAge         int     `json:"tireAge"`
	TireWear        [4]int  `json:"tireWear"`
	TireSurfaceTemp [4]int  `json:"tireSurfaceTemp"`
	TireInnerTemp   [4]int  `json:"tireInnerTemp"`
	BrakeTemp       [4]int  `json:"brakeTemp"`

	// Car Controls
	BrakeBias       int `json:"brakeBias"`
	DiffOnThrottle  int `json:"diffOnThrottle"`
	DiffOffThrottle int `json:"diffOffThrottle"`

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

	// Sector times (current lap)
	Sector1TimeMs int `json:"sector1TimeMs"`
	Sector2TimeMs int `json:"sector2TimeMs"`
	CurrentSector int `json:"currentSector"`

	// Vehicle Dynamics
	Dynamics []DynamicsLapDTO `json:"dynamics,omitempty"`

	// Setup Analysis (player car only)
	SetupAnalysis []SetupLapAnalysisDTO `json:"setupAnalysis,omitempty"`
	Setup         *CarSetupDTO          `json:"setup,omitempty"`

	// Pit
	PitStatus         int     `json:"pitStatus"`
	NumPitStops       int     `json:"numPitStops"`
	LapDistance       float32 `json:"lapDistance"`
	PitStopTimer      float32 `json:"pitStopTimer"`
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

// DynamicsLapDTO contains per-lap vehicle dynamics statistics
type DynamicsLapDTO struct {
	LapNum        int     `json:"lapNum"`
	UndersteerPct float64 `json:"understeerPct"`
	OversteerPct  float64 `json:"oversteerPct"`
	LockupCount   int     `json:"lockupCount"`
	SpinCount     int     `json:"spinCount"`
}

// SetupLapAnalysisDTO contains per-lap setup analysis metrics
type SetupLapAnalysisDTO struct {
	LapNum           int        `json:"lapNum"`
	AvgStraightSpeed float64    `json:"avgStraightSpeed"`
	MaxStraightSpeed float64    `json:"maxStraightSpeed"`
	AvgCorneringG    float64    `json:"avgCorneringG"`
	WheelspinPct     float64    `json:"wheelspinPct"`
	TempBalance      [4]float64 `json:"tempBalance"`
	BottomingPct     float64    `json:"bottomingPct"`
	VertGSpikeCount  int        `json:"vertGSpikeCount"`
	FrontLockupPct   float64    `json:"frontLockupPct"`
	RearLockupPct    float64    `json:"rearLockupPct"`
	AvgTyrePressure  [4]float64 `json:"avgTyrePressure"`
	AvgTyreInnerTemp [4]float64 `json:"avgTyreInnerTemp"`
}

// CarSetupDTO exposes the current car setup values to the frontend
type CarSetupDTO struct {
	FrontWing        int        `json:"frontWing"`
	RearWing         int        `json:"rearWing"`
	FrontCamber      float32    `json:"frontCamber"`
	RearCamber       float32    `json:"rearCamber"`
	FrontToe         float32    `json:"frontToe"`
	RearToe          float32    `json:"rearToe"`
	FrontSuspension  int        `json:"frontSuspension"`
	RearSuspension   int        `json:"rearSuspension"`
	FrontAntiRollBar int        `json:"frontAntiRollBar"`
	RearAntiRollBar  int        `json:"rearAntiRollBar"`
	FrontRideHeight  int        `json:"frontRideHeight"`
	RearRideHeight   int        `json:"rearRideHeight"`
	BrakePressure    int        `json:"brakePressure"`
	EngineBraking    int        `json:"engineBraking"`
	TyrePressures    [4]float32 `json:"tyrePressures"`
}

// CarPosition contains GPS position for track map rendering
type CarPosition struct {
	Index int     `json:"index"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
}
