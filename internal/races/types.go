package races

import (
	"time"

	"frc.engineer/internal/dto"
)

// NotificationCounts tracks race control notifications emitted for the player.
type NotificationCounts struct {
	Penalty int `json:"penalty"`
	Warning int `json:"warning"`
	Info    int `json:"info"`
}

// RaceSummary is the persisted, non-raw race result snapshot.
type RaceSummary struct {
	ID           string             `json:"id"`
	SavedAtLocal string             `json:"savedAtLocal"`
	SessionUID   uint64             `json:"sessionUID"`
	Track        TrackInfo          `json:"track"`
	Session      SessionSummary     `json:"session"`
	Player       PlayerSummary      `json:"player"`
	Drivers      []DriverSummary    `json:"drivers"`
	Highlights   RaceHighlights     `json:"highlights"`
}

// TrackInfo describes the track for a stored race summary.
type TrackInfo struct {
	TrackID   int8   `json:"trackId"`
	TrackName string `json:"trackName"`
}

// SessionSummary captures session-level race context.
type SessionSummary struct {
	SessionType string  `json:"sessionType"`
	TotalLaps   int     `json:"totalLaps"`
	SafetyCar   string  `json:"safetyCar"`
	Weather     string  `json:"weather"`
	AirTemp     float32 `json:"airTemp"`
	TrackTemp   float32 `json:"trackTemp"`
}

// RaceStint summarises one completed tire stint.
type RaceStint struct {
	Compound string `json:"compound"`
	Laps     int    `json:"laps"`
}

// PlayerSummary captures player-centric race result metrics.
type PlayerSummary struct {
	DriverIndex   int         `json:"driverIndex"`
	Name          string      `json:"name"`
	TeamID        int         `json:"teamId"`
	FinalPosition int         `json:"finalPosition"`
	CompletedLaps int         `json:"completedLaps"`
	BestLapMS     uint32      `json:"bestLapMs"`
	LastLapMS     uint32      `json:"lastLapMs"`
	PitStops      int         `json:"pitStops"`
	Stints        []RaceStint `json:"stints,omitempty"`
}

// DriverSummary captures lightweight result metrics for each driver.
type DriverSummary struct {
	DriverIndex   int         `json:"driverIndex"`
	Name          string      `json:"name"`
	TeamID        int         `json:"teamId"`
	Position      int         `json:"position"`
	CompletedLaps int         `json:"completedLaps"`
	BestLapMS     uint32      `json:"bestLapMs"`
	LastLapMS     uint32      `json:"lastLapMs"`
	PitStops      int         `json:"pitStops"`
	TireCompound  string      `json:"tireCompound"`
	TireAge       int         `json:"tireAge"`
	Stints        []RaceStint `json:"stints,omitempty"`
}

// RaceHighlights includes extra summary signal useful for race review.
type RaceHighlights struct {
	FastestLapHolder string             `json:"fastestLapHolder,omitempty"`
	FastestLapMS     uint32             `json:"fastestLapMs,omitempty"`
	Notifications    NotificationCounts `json:"notifications"`
}

// RaceListItem is a lightweight list row returned by /api/races.
type RaceListItem struct {
	ID            string `json:"id"`
	SavedAtLocal  string `json:"savedAtLocal"`
	TrackName     string `json:"trackName"`
	SessionType   string `json:"sessionType"`
	PlayerName    string `json:"playerName"`
	FinalPosition int    `json:"finalPosition"`
}

// BuildSummary creates a race summary from the latest pitwall snapshot.
func BuildSummary(sessionUID uint64, state *dto.PitwallState, counts NotificationCounts, savedAt time.Time) *RaceSummary {
	out := &RaceSummary{
		SavedAtLocal: savedAt.Format("2006-01-02 15:04:05"),
		SessionUID:   sessionUID,
		Highlights: RaceHighlights{
			Notifications: counts,
		},
	}

	if state == nil {
		return out
	}

	if state.Session != nil {
		out.Track = TrackInfo{
			TrackID:   state.Session.TrackID,
			TrackName: state.Session.TrackName,
		}
		out.Session = SessionSummary{
			SessionType: state.Session.SessionType,
			TotalLaps:   state.Session.TotalLaps,
			SafetyCar:   state.Session.SafetyCar,
			Weather:     state.Session.Weather,
			AirTemp:     state.Session.AirTemp,
			TrackTemp:   state.Session.TrackTemp,
		}
	}

	if len(state.Drivers) > 0 {
		out.Drivers = make([]DriverSummary, 0, len(state.Drivers))
		for _, d := range state.Drivers {
			driver := DriverSummary{
				DriverIndex:   d.Index,
				Name:          d.Name,
				TeamID:        d.TeamID,
				Position:      d.Position,
				CompletedLaps: d.CurrentLapNum,
				BestLapMS:     uint32(maxf32(d.BestLapTime, 0)),
				LastLapMS:     uint32(maxf32(d.LastLapTime, 0)),
				PitStops:      d.NumPitStops,
				TireCompound:  d.TireCompound,
				TireAge:       d.TireAge,
			}
			if len(d.StintHistory) > 0 {
				driver.Stints = make([]RaceStint, len(d.StintHistory))
				for i, s := range d.StintHistory {
					driver.Stints[i] = RaceStint{Compound: s.Compound, Laps: s.Laps}
				}
			}
			out.Drivers = append(out.Drivers, driver)

			if d.BestLapTime > 0 && (out.Highlights.FastestLapMS == 0 || uint32(d.BestLapTime) < out.Highlights.FastestLapMS) {
				out.Highlights.FastestLapMS = uint32(d.BestLapTime)
				out.Highlights.FastestLapHolder = d.Name
			}
		}

		playerIdx := state.PlayerIndex
		if playerIdx >= 0 && playerIdx < len(state.Drivers) {
			p := state.Drivers[playerIdx]
			out.Player = PlayerSummary{
				DriverIndex:   p.Index,
				Name:          p.Name,
				TeamID:        p.TeamID,
				FinalPosition: p.Position,
				CompletedLaps: p.CurrentLapNum,
				BestLapMS:     uint32(maxf32(p.BestLapTime, 0)),
				LastLapMS:     uint32(maxf32(p.LastLapTime, 0)),
				PitStops:      p.NumPitStops,
			}
			if len(p.StintHistory) > 0 {
				out.Player.Stints = make([]RaceStint, len(p.StintHistory))
				for i, s := range p.StintHistory {
					out.Player.Stints[i] = RaceStint{Compound: s.Compound, Laps: s.Laps}
				}
			}
		}
	}

	return out
}

func maxf32(v, min float32) float32 {
	if v < min {
		return min
	}
	return v
}
