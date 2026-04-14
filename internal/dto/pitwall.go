package dto

// PitwallState is the comprehensive state DTO broadcast to pitwall clients
type PitwallState struct {
	Session              *SessionInfo  `json:"session"`
	Drivers              []DriverInfo  `json:"drivers"`
	Positions            []CarPosition `json:"positions"`
	PlayerIndex          int           `json:"playerIndex"`
	TrackMap             *TrackMapDTO  `json:"trackMap,omitempty"`
	SenderState          *SenderState  `json:"senderState,omitempty"`
	ERSEstimateEnabled   bool          `json:"ersEstimateEnabled"`
	ERSComparisonEnabled bool          `json:"ersComparisonEnabled"`
}

// SenderState exposes sender-owned runtime flags that remote engineers should read over P2P.
type SenderState struct {
	SaveFiles       bool   `json:"saveFiles"`
	TrackRecording  bool   `json:"trackRecording"`
	RaceStorageMode string `json:"raceStorageMode,omitempty"`
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
	SessionTimeLeft        int                     `json:"sessionTimeLeft"`
	SessionDuration        int                     `json:"sessionDuration"`
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
	AIControlled    bool    `json:"aiControlled"`
	Position        int     `json:"position"`
	CurrentLapNum   int     `json:"currentLapNum"`
	Speed           uint16  `json:"speed,omitempty"`
	TopSpeed        int     `json:"topSpeed,omitempty"`
	Throttle        float32 `json:"throttle,omitempty"`
	Brake           float32 `json:"brake,omitempty"`
	Gear            int8    `json:"gear,omitempty"`
	Steering        float32 `json:"steering,omitempty"`
	DRSActivated    bool    `json:"drsActivated"`
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
	ERSDeployedThisLap  float32 `json:"ersDeployedThisLap,omitempty"`
	ERSHarvestedThisLap float32 `json:"ersHarvestedThisLap,omitempty"`
	ERSEstimatePct      int     `json:"ersEstimatePct,omitempty"`
	ERSEstimateReady    bool    `json:"ersEstimateReady,omitempty"`
	ERSActualPct        int     `json:"ersActualPct,omitempty"`
	ERSActualReady      bool    `json:"ersActualReady,omitempty"`

	// Damage
	Damage *CarDamage `json:"damage,omitempty"`

	// Strategy
	StintHistory []StintInfoDTO `json:"stintHistory,omitempty"`

	// Sector times (current lap)
	Sector1TimeMs int `json:"sector1TimeMs,omitempty"`
	Sector2TimeMs int `json:"sector2TimeMs,omitempty"`
	CurrentSector int `json:"currentSector"`

	// Best sector times (from SessionHistory)
	BestSector1Ms *int `json:"bestSector1Ms,omitempty"`
	BestSector2Ms *int `json:"bestSector2Ms,omitempty"`
	BestSector3Ms *int `json:"bestSector3Ms,omitempty"`

	// Vehicle Dynamics
	Dynamics []DynamicsLapDTO `json:"dynamics,omitempty"`

	// Penalties
	Penalties                  int `json:"penalties,omitempty"`
	TotalWarnings              int `json:"totalWarnings,omitempty"`
	CornerCuttingWarnings      int `json:"cornerCuttingWarnings,omitempty"`
	NumUnservedDriveThroughs   int `json:"numUnservedDriveThroughs,omitempty"`
	NumUnservedStopGoPenalties int `json:"numUnservedStopGoPenalties,omitempty"`

	// Lap validity
	LapInvalid bool `json:"lapInvalid"`

	// TyreSets (Commentary)
	TyreSetWear    *int           `json:"tyreSetWear"`
	TyreLifeSpan   *int           `json:"tyreLifeSpan"`
	TyreUsableLife *int           `json:"tyreUsableLife"`
	AvailableSets  []TyreSetBrief `json:"availableSets,omitempty"`

	// Pit
	PitStatus         int     `json:"pitStatus"`
	DriverStatus      int     `json:"driverStatus,omitempty"`
	ResultStatus      int     `json:"resultStatus,omitempty"`
	NumPitStops       int     `json:"numPitStops"`
	LapDistance       float32 `json:"lapDistance"`
	PitStopTimer      float32 `json:"pitStopTimer,omitempty"`
	DeltaToCarInFront int     `json:"deltaToCarInFront,omitempty"`
	DeltaToRaceLeader int     `json:"deltaToRaceLeader,omitempty"`
	DeltaToPlayer     int     `json:"deltaToPlayer,omitempty"`
	PitLaneTime       int     `json:"pitLaneTime,omitempty"`
}

// StintInfoDTO represents a completed tire stint
type StintInfoDTO struct {
	Compound string `json:"compound"`
	Laps     int    `json:"laps"`
}

// TyreSetBrief summarizes available tyre sets for a compound
type TyreSetBrief struct {
	Compound string `json:"compound"`
	Count    int    `json:"count"`
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
	Yaw   float32 `json:"yaw"`
}

// RadarData is a lightweight payload for the local radar overlay SSE stream.
type RadarData struct {
	PlayerIndex int            `json:"playerIndex"`
	Cars        []RadarCarData `json:"cars"`
}

// RadarCarData contains per-car data needed by the radar overlay.
type RadarCarData struct {
	Index  int     `json:"index"`
	X      float32 `json:"x"`
	Z      float32 `json:"z"`
	Yaw    float32 `json:"yaw"`
	TeamID int     `json:"teamId"`
}

// StrategyOverlayData is a lightweight payload for the strategy overlay SSE stream.
type StrategyOverlayData struct {
	Mode              string `json:"mode,omitempty"` // race, qualifying
	SessionType       string `json:"sessionType,omitempty"`
	PlayerPosition    int    `json:"playerPosition"`
	PlayerLap         int    `json:"playerLap"`
	TotalLaps         int    `json:"totalLaps"`
	TrackID           int8   `json:"trackId"`
	PitRejoinPosition int    `json:"pitRejoinPosition"`

	CarAhead  *StrategyCar `json:"carAhead,omitempty"`
	CarBehind *StrategyCar `json:"carBehind,omitempty"`

	UndercutVerdict string `json:"undercutVerdict"` // VIABLE, RISKY, NO
	OvercutVerdict  string `json:"overcutVerdict"`  // VIABLE, RISKY, NO

	TrainSize int  `json:"trainSize"`
	InTrain   bool `json:"inTrain"`
}

// StrategyCar holds strategy-relevant data for a nearby car.
type StrategyCar struct {
	Name         string  `json:"name"`
	Position     int     `json:"position"`
	GapMs        int     `json:"gapMs"`
	GapMeters    int     `json:"gapMeters,omitempty"`
	TireCompound string  `json:"tireCompound"`
	TireAge      int     `json:"tireAge"`
	LastLapMs    float32 `json:"lastLapMs"`
	AvgPaceMs    float32 `json:"avgPaceMs"`
	PitStops     int     `json:"pitStops"`
	HasPitted    bool    `json:"hasPitted"`
	PaceDeltaMs  float32 `json:"paceDeltaMs"` // vs player: negative = faster
	SpeedKPH     int     `json:"speedKph,omitempty"`
	TryLabel     string  `json:"tryLabel,omitempty"`
	TryTone      string  `json:"tryTone,omitempty"`
	TrySummary   string  `json:"trySummary,omitempty"`
	TryScore     int     `json:"tryScore,omitempty"`
	SectorDelta1 *int    `json:"sectorDelta1Ms,omitempty"`
	SectorDelta2 *int    `json:"sectorDelta2Ms,omitempty"`
}

// WeatherOverlayData is a lightweight payload for the weather forecast overlay SSE stream.
type WeatherOverlayData struct {
	CurrentWeather string               `json:"currentWeather"`
	TrackTemp      float32              `json:"trackTemp"`
	AirTemp        float32              `json:"airTemp"`
	SessionType    string               `json:"sessionType"`
	Forecasts      []WeatherForecastDTO `json:"forecasts"`
}
