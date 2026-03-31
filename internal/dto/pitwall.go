package dto

// PitwallState is the comprehensive state DTO broadcast to pitwall clients
type PitwallState struct {
	Session              *SessionInfo  `json:"session"`
	Drivers              []DriverInfo  `json:"drivers"`
	Positions            []CarPosition `json:"positions"`
	PlayerIndex          int           `json:"playerIndex"`
	TrackMap             *TrackMapDTO  `json:"trackMap,omitempty"`
	ERSEstimateEnabled   bool          `json:"ersEstimateEnabled"`
	ERSComparisonEnabled bool          `json:"ersComparisonEnabled"`
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
	Speed           uint16  `json:"speed,omitempty"`
	TopSpeed        int     `json:"topSpeed"`
	Throttle        float32 `json:"throttle,omitempty"`
	Brake           float32 `json:"brake,omitempty"`
	Gear            int8    `json:"gear,omitempty"`
	Steering        float32 `json:"steering,omitempty"`
	LastLapTime     float32 `json:"lastLapTime"`
	BestLapTime     float32 `json:"bestLapTime"`
	TireCompound    string  `json:"tireCompound"`
	TireAge         int     `json:"tireAge"`
	TireWear        [4]int  `json:"tireWear"`
	TireSurfaceTemp [4]int  `json:"tireSurfaceTemp"`
	TireInnerTemp   [4]int  `json:"tireInnerTemp"`
	BrakeTemp       [4]int  `json:"brakeTemp,omitempty"`

	// Car Controls
	BrakeBias       int `json:"brakeBias"`
	DiffOnThrottle  int `json:"diffOnThrottle"`
	DiffOffThrottle int `json:"diffOffThrottle,omitempty"`

	// Fuel & Energy
	FuelInTank          float32 `json:"fuelInTank,omitempty"`
	FuelRemainingLaps   float32 `json:"fuelRemainingLaps"`
	FuelMix             int     `json:"fuelMix,omitempty"`
	ERSStoreEnergy      float32 `json:"ersStoreEnergy"`
	ERSDeployMode       int     `json:"ersDeployMode"`
	ERSDeployedThisLap  float32 `json:"ersDeployedThisLap"`
	ERSHarvestedThisLap float32 `json:"ersHarvestedThisLap"`
	ERSEstimatePct      int     `json:"ersEstimatePct"`
	ERSEstimateReady    bool    `json:"ersEstimateReady"`
	ERSActualPct        int     `json:"ersActualPct"`
	ERSActualReady      bool    `json:"ersActualReady"`

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

	// Penalties
	Penalties                  int `json:"penalties"`
	TotalWarnings              int `json:"totalWarnings"`
	CornerCuttingWarnings      int `json:"cornerCuttingWarnings"`
	NumUnservedDriveThroughs   int `json:"numUnservedDriveThroughs"`
	NumUnservedStopGoPenalties int `json:"numUnservedStopGoPenalties"`

	// Lap validity
	LapInvalid bool `json:"lapInvalid"`

	// Pit
	PitStatus         int     `json:"pitStatus"`
	DriverStatus      int     `json:"driverStatus,omitempty"`
	NumPitStops       int     `json:"numPitStops"`
	LapDistance       float32 `json:"lapDistance"`
	PitStopTimer      float32 `json:"pitStopTimer"`
	DeltaToCarInFront int     `json:"deltaToCarInFront"`
	DeltaToRaceLeader int     `json:"deltaToRaceLeader"`
	DeltaToPlayer     int     `json:"deltaToPlayer"`
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

// CarPosition contains GPS position for track map rendering
type CarPosition struct {
	Index int     `json:"index"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
}
