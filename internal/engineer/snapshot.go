package engineer

import (
	"time"

	"frc.engineer/internal/dto"
)

// carSnap is the public per-car data the rules use.
type carSnap struct {
	Index        int
	Name         string
	Position     int
	Lap          int
	GapAheadMs   int // DeltaToCarInFront
	PitStops     int
	PitStatus    int
	Compound     string
	TyreAge      int
	ResultStatus int
}

// active mirrors the pit-exit projection rule: on track and classified.
func (c carSnap) active() bool {
	return c.Position > 0 && (c.ResultStatus == 2 || c.ResultStatus == 3)
}

// playerSnap adds the player's private telemetry.
type playerSnap struct {
	carSnap
	FuelKnown        bool
	FuelMarginLaps   float32
	TyreWear         [4]int
	Damage           *dto.CarDamage
	Penalties        int
	Warnings         int
	UnservedDT       int
	UnservedSG       int
	LastLapMs        float32
	BestLapMs        float32
	TyreUsableLife   *int
	DeltaToLeaderMs  int
	CornerCutWarning int
}

// snapshot is a self-contained copy of one pitwall emission.
type snapshot struct {
	At          time.Time
	SessionUID  string
	SessionType string
	TrackName   string
	TotalLaps   int
	SafetyCar   string
	Weather     string
	Forecast    []dto.WeatherForecastDTO
	PitIdeal    int
	PitLatest   int
	PitRejoin   int
	GameFormat  int
	Player      playerSnap
	Cars        []carSnap
}

func (s *snapshot) race() bool {
	return s.SessionType == "Race" || s.SessionType == "Race 2" || s.SessionType == "Race 3"
}

func (s *snapshot) safetyCarOut() bool {
	return s.SafetyCar == "full" || s.SafetyCar == "virtual"
}

// carAt returns the active car at position pos.
func (s *snapshot) carAt(pos int) (carSnap, bool) {
	for _, c := range s.Cars {
		if c.Position == pos && c.active() {
			return c, true
		}
	}
	return carSnap{}, false
}

func (s *snapshot) car(index int) (carSnap, bool) {
	for _, c := range s.Cars {
		if c.Index == index {
			return c, true
		}
	}
	return carSnap{}, false
}

// gapBehindMs is the gap of the car directly behind to the player, or -1.
func (s *snapshot) gapBehindMs() int {
	if c, ok := s.carAt(s.Player.Position + 1); ok && c.GapAheadMs > 0 && c.PitStatus == 0 {
		return c.GapAheadMs
	}
	return -1
}

// gapAheadMs is the player's gap to the car in front, or -1.
func (s *snapshot) gapAheadMs() int {
	if s.Player.Position <= 1 || s.Player.GapAheadMs <= 0 {
		return -1
	}
	if c, ok := s.carAt(s.Player.Position - 1); !ok || c.PitStatus != 0 {
		return -1
	}
	return s.Player.GapAheadMs
}

func (s *snapshot) maxWear() (int, int) {
	best, corner := -1, 0
	for i, w := range s.Player.TyreWear {
		if w > best {
			best, corner = w, i
		}
	}
	return best, corner
}

// extractSnapshot copies state; it returns nil when the player is unknown.
func extractSnapshot(at time.Time, st *dto.PitwallState) *snapshot {
	if st == nil || st.Session == nil || st.PlayerIndex < 0 || st.PlayerIndex >= len(st.Drivers) {
		return nil
	}
	s := &snapshot{
		At:          at,
		SessionUID:  st.SessionUID,
		SessionType: st.Session.SessionType,
		TrackName:   st.Session.TrackName,
		TotalLaps:   st.Session.TotalLaps,
		SafetyCar:   st.Session.SafetyCar,
		Weather:     st.Session.Weather,
		PitIdeal:    st.Session.PitStopWindowIdealLap,
		PitLatest:   st.Session.PitStopWindowLatestLap,
		PitRejoin:   st.Session.PitStopRejoinPosition,
		GameFormat:  st.GameFormat,
		Forecast:    append([]dto.WeatherForecastDTO(nil), st.Session.WeatherForecast...),
		Cars:        make([]carSnap, 0, len(st.Drivers)),
	}
	for i := range st.Drivers {
		d := &st.Drivers[i]
		s.Cars = append(s.Cars, carSnap{
			Index: d.Index, Name: d.Name, Position: d.Position, Lap: d.CurrentLapNum,
			GapAheadMs: d.DeltaToCarInFront, PitStops: d.NumPitStops, PitStatus: d.PitStatus,
			Compound: d.TireCompound, TyreAge: d.TireAge, ResultStatus: d.ResultStatus,
		})
	}
	p := &st.Drivers[st.PlayerIndex]
	s.Player = playerSnap{
		carSnap:          s.Cars[st.PlayerIndex],
		FuelKnown:        p.FuelInTank > 0,
		FuelMarginLaps:   p.FuelRemainingLaps,
		TyreWear:         p.TireWear,
		Penalties:        p.Penalties,
		Warnings:         p.TotalWarnings,
		CornerCutWarning: p.CornerCuttingWarnings,
		UnservedDT:       p.NumUnservedDriveThroughs,
		UnservedSG:       p.NumUnservedStopGoPenalties,
		LastLapMs:        p.LastLapTime,
		BestLapMs:        p.BestLapTime,
		DeltaToLeaderMs:  p.DeltaToRaceLeader,
	}
	if p.Damage != nil {
		d := *p.Damage
		s.Player.Damage = &d
	}
	if p.TyreUsableLife != nil {
		v := *p.TyreUsableLife
		s.Player.TyreUsableLife = &v
	}
	return s
}
