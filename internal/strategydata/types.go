package strategydata

// RawTrackFile is the source JSON schema under data/strategy/tracks.
type RawTrackFile struct {
	Track                 string            `json:"track"`
	TrackInfo             RawTrackInfo      `json:"track_info"`
	TyreStrategy          RawTyreStrategy   `json:"tyre_strategy"`
	QualiStrategy         RawQualiStrategy  `json:"quali_strategy"`
	RaceStrategy          RawRaceStrategy   `json:"race_strategy"`
	SetupTypeDescriptions map[string]string `json:"setup_type_descriptions"`
	Setups                RawSetups         `json:"setups"`
	ERSGuide              RawERSGuide       `json:"ers_guide"`
	HotlapVideo           string            `json:"hotlap_video"`
	ScrapedAt             string            `json:"scraped_at"`
	URL                   string            `json:"url"`
}

type RawTrackInfo struct {
	LapCount      any    `json:"lap_count"`
	Laps50Pct     int    `json:"laps_50pct"`
	CircuitLength string `json:"circuit_length"`
	LapRecord     string `json:"lap_record"`
	DRSZones      int    `json:"drs_zones"`
	PolePosition  string `json:"pole_position"`
	PitLimit      string `json:"pit_limit"`
}

type RawTyreStrategy struct {
	Compounds     map[string]string              `json:"compounds"`
	WearPerLap    map[string]RawValueDescription `json:"wear_per_lap"`
	TyreLife50Pct map[string]RawLapsDescription  `json:"tyre_life_50pct"`
}

type RawValueDescription struct {
	Value       string `json:"value"`
	Description string `json:"description"`
}

type RawLapsDescription struct {
	Laps        int    `json:"laps"`
	Description string `json:"description"`
}

type RawQualiStrategy struct {
	FuelAmount        RawValueDescription `json:"fuel_amount"`
	OutlapTime        RawValueDescription `json:"outlap_time"`
	StartingTyreTemps RawValueDescription `json:"starting_tyre_temps"`
	EnableERS         RawValueDescription `json:"enable_ers"`
}

type RawRaceStrategy struct {
	Laps50Pct         int                  `json:"laps_50pct"`
	StartingFuel50Pct *RawValueDescription `json:"starting_fuel_50pct"`
	PlanA             *RawRacePlan         `json:"plan_a"`
	PlanB             *RawRacePlan         `json:"plan_b"`
	Plan100Pct        *RawRacePlan         `json:"plan_100pct"`
	PitStopTimeLost   *RawValueDescription `json:"pit_stop_time_lost"`
	Notes             string               `json:"notes"`
}

type RawRacePlan struct {
	Tyres       []string `json:"tyres"`
	PitWindow   string   `json:"pit_window"`
	Description string   `json:"description"`
}

type RawSetups struct {
	Dry []RawSetup `json:"dry"`
	Wet []RawSetup `json:"wet"`
}

type RawSetup struct {
	Name                    string  `json:"name"`
	ID                      string  `json:"id"`
	FrontWing               int     `json:"front_wing"`
	RearWing                int     `json:"rear_wing"`
	OnThrottleDifferential  int     `json:"on_throttle_differential"`
	OffThrottleDifferential int     `json:"off_throttle_differential"`
	FrontCamber             float64 `json:"front_camber"`
	RearCamber              float64 `json:"rear_camber"`
	FrontToe                float64 `json:"front_toe"`
	RearToe                 float64 `json:"rear_toe"`
	FrontSuspension         int     `json:"front_suspension"`
	RearSuspension          int     `json:"rear_suspension"`
	FrontAntiRollBar        int     `json:"front_anti_roll_bar"`
	RearAntiRollBar         int     `json:"rear_anti_roll_bar"`
	FrontRideHeight         int     `json:"front_ride_height"`
	RearRideHeight          int     `json:"rear_ride_height"`
	BrakeBias               int     `json:"brake_bias"`
	BrakePressure           int     `json:"brake_pressure"`
	FrontRightPressure      float64 `json:"front_right_pressure"`
	FrontLeftPressure       float64 `json:"front_left_pressure"`
	RearRightPressure       float64 `json:"rear_right_pressure"`
	RearLeftPressure        float64 `json:"rear_left_pressure"`
	Updated                 *string `json:"updated"`
	Notes                   *string `json:"notes"`
}

type RawERSGuide struct {
	TrackMapURL string `json:"track_map_url"`
}

type RawTyreTempDataset map[string][]RawTyreTempPoint

type RawTyreTempPoint struct {
	Temp string `json:"temp"`
	Grip string `json:"grip"`
	Zone string `json:"zone"`
}

// NormalizedTrackFile is the normalized schema written to data/strategy/normalized/tracks.
type NormalizedTrackFile struct {
	Track                 string                   `json:"track"`
	Source                NormalizedSource         `json:"source"`
	TrackInfo             NormalizedTrackInfo      `json:"track_info"`
	TyreStrategy          NormalizedTyreStrategy   `json:"tyre_strategy"`
	QualiStrategy         *NormalizedQualiStrategy `json:"quali_strategy,omitempty"`
	RaceStrategy          *NormalizedRaceStrategy  `json:"race_strategy,omitempty"`
	SetupTypeDescriptions map[string]*string       `json:"setup_type_descriptions"`
	Setups                NormalizedSetups         `json:"setups"`
	ERSGuide              *NormalizedERSGuide      `json:"ers_guide,omitempty"`
	HotlapVideoURL        *string                  `json:"hotlap_video_url,omitempty"`
}

type NormalizedSource struct {
	URL       string `json:"url"`
	ScrapedAt string `json:"scraped_at"`
}

type NormalizedTrackInfo struct {
	LapCount         *int    `json:"lap_count,omitempty"`
	Laps50Pct        int     `json:"laps_50pct"`
	CircuitLengthKM  float64 `json:"circuit_length_km"`
	LapRecordDisplay string  `json:"lap_record_display"`
	LapRecordMS      int     `json:"lap_record_ms"`
	DRSZones         int     `json:"drs_zones"`
	PolePositionSide string  `json:"pole_position_side"`
	PitLimitKPH      int     `json:"pit_limit_kph"`
	PitLimitMPH      int     `json:"pit_limit_mph"`
}

type NormalizedTyreStrategy struct {
	Compounds     map[string]string               `json:"compounds"`
	WearPerLap    map[string]NormalizedRangeValue `json:"wear_per_lap"`
	TyreLife50Pct map[string]NormalizedLapValue   `json:"tyre_life_50pct"`
}

type NormalizedRangeValue struct {
	Display     string  `json:"display"`
	MinPct      float64 `json:"min_pct"`
	MaxPct      float64 `json:"max_pct"`
	Description *string `json:"description,omitempty"`
}

type NormalizedLapValue struct {
	Laps        int     `json:"laps"`
	Description *string `json:"description,omitempty"`
}

type NormalizedQualiStrategy struct {
	FuelAmountKG      float64 `json:"fuel_amount_kg"`
	OutlapTimeMS      int     `json:"outlap_time_ms"`
	StartingTyreTempC int     `json:"starting_tyre_temp_c"`
	EnableERSTurn     int     `json:"enable_ers_turn"`
	EnableERSDisplay  string  `json:"enable_ers_display"`
}

type NormalizedRaceStrategy struct {
	Available           bool                `json:"available"`
	Laps50Pct           int                 `json:"laps_50pct,omitempty"`
	StartingFuel50PctKG float64             `json:"starting_fuel_50pct_kg,omitempty"`
	PlanA               *NormalizedRacePlan `json:"plan_a,omitempty"`
	PlanB               *NormalizedRacePlan `json:"plan_b,omitempty"`
	Plan100Pct          *NormalizedRacePlan `json:"plan_100pct,omitempty"`
	PitStopTimeLostS    float64             `json:"pit_stop_time_lost_s,omitempty"`
	Notes               *string             `json:"notes,omitempty"`
}

type NormalizedRacePlan struct {
	Tyres            []string             `json:"tyres"`
	PitWindowDisplay string               `json:"pit_window_display"`
	PitWindows       []NormalizedLapRange `json:"pit_windows"`
	Description      *string              `json:"description,omitempty"`
}

type NormalizedLapRange struct {
	StartLap int `json:"start_lap"`
	EndLap   int `json:"end_lap"`
}

type NormalizedSetups struct {
	Dry []NormalizedSetup `json:"dry"`
	Wet []NormalizedSetup `json:"wet"`
}

type NormalizedSetup struct {
	Name                    string  `json:"name"`
	ID                      string  `json:"id"`
	FrontWing               int     `json:"front_wing"`
	RearWing                int     `json:"rear_wing"`
	OnThrottleDifferential  int     `json:"on_throttle_differential"`
	OffThrottleDifferential int     `json:"off_throttle_differential"`
	FrontCamber             float64 `json:"front_camber"`
	RearCamber              float64 `json:"rear_camber"`
	FrontToe                float64 `json:"front_toe"`
	RearToe                 float64 `json:"rear_toe"`
	FrontSuspension         int     `json:"front_suspension"`
	RearSuspension          int     `json:"rear_suspension"`
	FrontAntiRollBar        int     `json:"front_anti_roll_bar"`
	RearAntiRollBar         int     `json:"rear_anti_roll_bar"`
	FrontRideHeight         int     `json:"front_ride_height"`
	RearRideHeight          int     `json:"rear_ride_height"`
	BrakeBias               int     `json:"brake_bias"`
	BrakePressure           int     `json:"brake_pressure"`
	FrontRightPressure      float64 `json:"front_right_pressure"`
	FrontLeftPressure       float64 `json:"front_left_pressure"`
	RearRightPressure       float64 `json:"rear_right_pressure"`
	RearLeftPressure        float64 `json:"rear_left_pressure"`
	UpdatedDate             *string `json:"updated_date,omitempty"`
	Notes                   *string `json:"notes,omitempty"`
}

type NormalizedERSGuide struct {
	TrackMapURL string `json:"track_map_url"`
}

type NormalizedTyreTempDataset struct {
	Compounds map[string]NormalizedTyreCompound `json:"compounds"`
}

type NormalizedTyreCompound struct {
	PeakTempsC []int                     `json:"peak_temps_c"`
	Points     []NormalizedTyreTempPoint `json:"points"`
}

type NormalizedTyreTempPoint struct {
	TempC   int     `json:"temp_c"`
	GripPct float64 `json:"grip_pct"`
	Zone    string  `json:"zone"`
}

type Manifest struct {
	GeneratedAt   string   `json:"generated_at"`
	SourceRoot    string   `json:"source_root"`
	TrackCount    int      `json:"track_count"`
	Tracks        []string `json:"tracks"`
	TyreCompounds []string `json:"tyre_compounds"`
}
