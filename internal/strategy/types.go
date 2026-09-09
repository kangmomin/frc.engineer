// Package strategy builds deterministic, measured-data strategy comparisons.
// It has no network, database, AI client, or dependency on live broadcast DTOs.
package strategy

const (
	EvidenceVersion  = 1
	MaxLaps          = 200
	MaxStops         = 30
	MaxEvidenceBytes = 128 << 10
	// These are minimum evidence gates, not accuracy guarantees.
	MinUsers     = 3
	MinSessions  = 6
	MinCleanLaps = 40
)

// Rules contains reported game settings that change vehicle or pit behaviour.
// A nil Rules means the source packet did not contain these fields.
type Rules struct {
	EqualPerformance  bool `json:"equalPerformance"`
	GameMode          int  `json:"gameMode"`
	RuleSet           int  `json:"ruleSet"`
	SessionLength     int  `json:"sessionLength"`
	SurfaceType       int  `json:"surfaceType"`
	LowFuelMode       int  `json:"lowFuelMode"`
	TyreTemperature   int  `json:"tyreTemperature"`
	PitLaneTyreSim    int  `json:"pitLaneTyreSim"`
	ERSAssist         int  `json:"ersAssist"`
	PitAssist         int  `json:"pitAssist"`
	PitReleaseAssist  int  `json:"pitReleaseAssist"`
	PitStopExperience int  `json:"pitStopExperience"`
}

type Conditions struct {
	PacketFormat int    `json:"packetFormat"`
	GameYear     int    `json:"gameYear"`
	GameMajor    int    `json:"gameMajor"`
	GameMinor    int    `json:"gameMinor"`
	Formula      int    `json:"formula"`
	SessionType  int    `json:"sessionType"`
	TotalLaps    int    `json:"totalLaps"`
	TrackLengthM int    `json:"trackLengthM"`
	TeamID       *int   `json:"teamId"`
	Rules        *Rules `json:"rules"`
}

// Evidence is private player-only capture, uploaded over HTTP with the race.
// It is never included in a WebRTC state or an externally served race summary.
type Evidence struct {
	Version    int        `json:"version"`
	SessionUID string     `json:"sessionUid"`
	Conditions Conditions `json:"conditions"`
	Laps       []Lap      `json:"laps"`
	Stops      []Stop     `json:"stops"`
	Reasons    []string   `json:"reasons"`
}

type EnergySector struct {
	DeployedJ    float64 `json:"deployedJ"`
	HarvestedJ   float64 `json:"harvestedJ"`
	DurationMs   float64 `json:"durationMs"`
	MeanSpeedKph float64 `json:"meanSpeedKph"`
}

type Lap struct {
	Number          int            `json:"number"`
	TimeMs          int            `json:"timeMs"`
	Compound        int            `json:"compound"` // actual compound, never inferred from colour
	Tyre            string         `json:"tyre"`
	TyreAge         int            `json:"tyreAge"` // age at the start of this lap
	EndCompound     int            `json:"endCompound"`
	EndTyreAge      int            `json:"endTyreAge"`
	Stint           int            `json:"stint"`
	SetupRevision   int            `json:"setupRevision"`
	Weather         int            `json:"weather"`
	TrackTemp       int            `json:"trackTemp"`
	TractionControl int            `json:"tractionControl"`
	ABS             int            `json:"abs"`
	FuelKg          *float64       `json:"fuelKg"`
	FuelEndKg       *float64       `json:"fuelEndKg"`
	ERSStartJ       *float64       `json:"ersStartJ"`
	ERSEndJ         *float64       `json:"ersEndJ"`
	Energy          []EnergySector `json:"energy"` // three distance thirds, not official sectors
	Flags           []string       `json:"flags"`
}

type Stop struct {
	InLap        int `json:"inLap"`
	OutLap       int `json:"outLap"`
	LaneMs       int `json:"laneMs"`
	StationaryMs int `json:"stationaryMs"`
}

// Record identities stay server-side. SessionUID, not uploaded row count, is
// the independent race identity when several drivers upload the same race.
type Record struct {
	TrackID   int
	AccountID string
	RaceID    string
	Evidence  Evidence
}

// Context is a cohort of known compatible conditions. No setup, account or
// session identifier is returned through this public aggregate shape.
type Context struct {
	ID              string     `json:"id"`
	TrackID         int        `json:"trackId"`
	Conditions      Conditions `json:"conditions"`
	Weather         int        `json:"weather"`
	TrackTempBucket int        `json:"trackTempBucket"`
	TractionControl int        `json:"tractionControl"`
	ABS             int        `json:"abs"`
	Users           int        `json:"users"`
	Sessions        int        `json:"sessions"`
	CleanLaps       int        `json:"cleanLaps"`
}

type Request struct {
	ContextID           string         `json:"contextId"`
	MaxStops            int            `json:"maxStops"`
	AvailableSets       map[string]int `json:"availableSets"`
	RequireTwoCompounds bool           `json:"requireTwoCompounds"`
}

type CompoundModel struct {
	Compound   int     `json:"compound"`
	Tyre       string  `json:"tyre"`
	OffsetMs   float64 `json:"offsetMs"`
	AgeSlopeMs float64 `json:"ageSlopeMs"`
	MinAge     int     `json:"minAge"`
	MaxAge     int     `json:"maxAge"`
	Users      int     `json:"users"`
	Sessions   int     `json:"sessions"`
	Laps       int     `json:"laps"`
}

type Stint struct {
	Tyre     string `json:"tyre"`
	Compound int    `json:"compound"`
	StartLap int    `json:"startLap"`
	EndLap   int    `json:"endLap"`
}

type Plan struct {
	Stints         []Stint `json:"stints"`
	PitLaps        []int   `json:"pitLaps"` // box at the end of this lap
	RelativeCostMs float64 `json:"relativeCostMs"`
	DeltaMs        float64 `json:"deltaMs"`
}

type PitModel struct {
	AdditionalTimeMs          float64 `json:"additionalTimeMs"`
	MedianAbsoluteDeviationMs float64 `json:"medianAbsoluteDeviationMs"`
	Users                     int     `json:"users"`
	Sessions                  int     `json:"sessions"`
	Stops                     int     `json:"stops"`
}

type ERSProfile struct {
	Status          string         `json:"status"`
	Users           int            `json:"users"`
	Sessions        int            `json:"sessions"`
	Laps            int            `json:"laps"`
	DeployedJ       float64        `json:"deployedJ"`
	HarvestedJ      float64        `json:"harvestedJ"`
	NetUseJ         float64        `json:"netUseJ"`
	StartEnergyJ    float64        `json:"startEnergyJ"`
	EndEnergyJ      float64        `json:"endEnergyJ"`
	SustainableLaps int            `json:"sustainableLaps"`
	Segments        []EnergySector `json:"segments"`
}

type Result struct {
	Status                   string          `json:"status"`
	Context                  *Context        `json:"context"`
	Reasons                  []string        `json:"reasons"`
	Compounds                []CompoundModel `json:"compounds"`
	FuelSlopeMsPerKg         *float64        `json:"fuelSlopeMsPerKg"`
	LapMedianAbsoluteErrorMs *float64        `json:"lapMedianAbsoluteErrorMs"`
	Pit                      *PitModel       `json:"pit"`
	Plans                    []Plan          `json:"plans"`
	ERS                      ERSProfile      `json:"ers"`
	Validation               string          `json:"validation"`
}
