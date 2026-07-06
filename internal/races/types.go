package races

import (
	"time"

	rtconfig "frc.engineer/internal/config"
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
	ID              string                   `json:"id"`
	SavedAtLocal    string                   `json:"savedAtLocal"`
	SessionUID      uint64                   `json:"sessionUID"`
	DataStorageMode rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	Track           TrackInfo                `json:"track"`
	Session         SessionSummary           `json:"session"`
	Player          PlayerSummary            `json:"player"`
	Drivers         []DriverSummary          `json:"drivers"`
	Highlights      RaceHighlights           `json:"highlights"`
	Debrief         *RaceDebrief             `json:"debrief,omitempty"`
	Replay          *ReplayTimeline          `json:"replay,omitempty"`
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

// RaceDebrief captures post-race review signals for the player.
type RaceDebrief struct {
	ClassifiedDrivers int                           `json:"classifiedDrivers"`
	WinnerName        string                        `json:"winnerName,omitempty"`
	GapToWinnerMS     uint32                        `json:"gapToWinnerMs,omitempty"`
	FastestLapDeltaMS uint32                        `json:"fastestLapDeltaMs,omitempty"`
	Penalties         RacePenaltySummary            `json:"penalties"`
	Pit               RacePitSummary                `json:"pit"`
	Tyres             RaceTyreSummary               `json:"tyres"`
	Timeline          []dto.RaceControlNotification `json:"timeline,omitempty"`
}

// RacePenaltySummary aggregates player penalties and warnings.
type RacePenaltySummary struct {
	TimePenaltySeconds   int `json:"timePenaltySeconds,omitempty"`
	Warnings             int `json:"warnings,omitempty"`
	CornerCutWarnings    int `json:"cornerCutWarnings,omitempty"`
	UnservedDriveThrough int `json:"unservedDriveThrough,omitempty"`
	UnservedStopGo       int `json:"unservedStopGo,omitempty"`
}

// RacePitSummary captures pit stop count and time loss.
type RacePitSummary struct {
	Stops               int    `json:"stops"`
	PitLaneTimeMS       uint32 `json:"pitLaneTimeMs,omitempty"`
	EstimatedTimeLostMS uint32 `json:"estimatedTimeLostMs,omitempty"`
}

// RaceTyreSummary captures end-of-race tyre state.
type RaceTyreSummary struct {
	FinalCompound    string `json:"finalCompound,omitempty"`
	FinalAge         int    `json:"finalAge,omitempty"`
	AverageWearPct   int    `json:"averageWearPct,omitempty"`
	PeakWearPct      int    `json:"peakWearPct,omitempty"`
	FinalSetWearPct  int    `json:"finalSetWearPct,omitempty"`
	LifeSpan         int    `json:"lifeSpan,omitempty"`
	UsableLife       int    `json:"usableLife,omitempty"`
	LifeRemainingPct int    `json:"lifeRemainingPct,omitempty"`
}

// ReplayFrame is one dashboard timeline snapshot.
type ReplayFrame struct {
	Timestamp   int64                         `json:"timestamp"`
	Pitwall     *dto.PitwallState             `json:"pitwall"`
	RaceControl []dto.RaceControlNotification `json:"raceControl,omitempty"`
}

// ReplayTimeline holds time-ordered snapshots for timeline playback.
type ReplayTimeline struct {
	FrameIntervalMS int              `json:"frameIntervalMs"`
	TrackMap        *dto.TrackMapDTO `json:"trackMap,omitempty"`
	Session         *dto.SessionInfo `json:"session,omitempty"`
	Frames          []ReplayFrame    `json:"frames"`
}

// RaceListItem is a lightweight list row returned by /api/races.
type RaceListItem struct {
	ID              string                   `json:"id"`
	SavedAtLocal    string                   `json:"savedAtLocal"`
	TrackName       string                   `json:"trackName"`
	SessionType     string                   `json:"sessionType"`
	PlayerName      string                   `json:"playerName"`
	FinalPosition   int                      `json:"finalPosition"`
	BestLapMS       uint32                   `json:"bestLapMs"`
	FileSizeBytes   int64                    `json:"fileSizeBytes"`
	DataStorageMode rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	HasReplay       bool                     `json:"hasReplay"`
	FrameCount      int                      `json:"frameCount"`
}

// BuildSummary creates a race summary from the latest pitwall snapshot.
func BuildSummary(sessionUID uint64, state *dto.PitwallState, counts NotificationCounts, timeline []dto.RaceControlNotification, savedAt time.Time) *RaceSummary {
	out := &RaceSummary{
		SavedAtLocal:    savedAt.Format("2006-01-02 15:04:05"),
		SessionUID:      sessionUID,
		DataStorageMode: rtconfig.DataStorageModeResultOnly,
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
			out.Debrief = buildDebrief(p, state, out.Highlights.FastestLapMS, timeline)
		}
	}

	return out
}

func buildDebrief(player dto.DriverInfo, state *dto.PitwallState, fastestLapMS uint32, timeline []dto.RaceControlNotification) *RaceDebrief {
	debrief := &RaceDebrief{
		ClassifiedDrivers: len(state.Drivers),
		Penalties: RacePenaltySummary{
			TimePenaltySeconds:   player.Penalties,
			Warnings:             player.TotalWarnings,
			CornerCutWarnings:    player.CornerCuttingWarnings,
			UnservedDriveThrough: player.NumUnservedDriveThroughs,
			UnservedStopGo:       player.NumUnservedStopGoPenalties,
		},
		Pit: RacePitSummary{
			Stops: player.NumPitStops,
		},
		Tyres: RaceTyreSummary{
			FinalCompound: player.TireCompound,
			FinalAge:      player.TireAge,
		},
	}

	for _, driver := range state.Drivers {
		if driver.Position == 1 && driver.Name != "" {
			debrief.WinnerName = driver.Name
			break
		}
	}
	if player.DeltaToRaceLeader > 0 {
		debrief.GapToWinnerMS = uint32(player.DeltaToRaceLeader)
	}
	playerBest := uint32(maxf32(player.BestLapTime, 0))
	if fastestLapMS > 0 && playerBest > fastestLapMS {
		debrief.FastestLapDeltaMS = playerBest - fastestLapMS
	}
	if player.PitLaneTime > 0 {
		debrief.Pit.PitLaneTimeMS = uint32(player.PitLaneTime)
		debrief.Pit.EstimatedTimeLostMS = uint32(player.PitLaneTime)
	} else if player.NumPitStops > 0 {
		debrief.Pit.EstimatedTimeLostMS = uint32(player.NumPitStops * 22000)
	}

	wearTotal := 0
	peakWear := 0
	for _, wear := range player.TireWear {
		if wear > peakWear {
			peakWear = wear
		}
		wearTotal += wear
	}
	if wearTotal > 0 {
		debrief.Tyres.AverageWearPct = wearTotal / len(player.TireWear)
		debrief.Tyres.PeakWearPct = peakWear
	}
	if player.TyreSetWear != nil && *player.TyreSetWear > 0 {
		debrief.Tyres.FinalSetWearPct = *player.TyreSetWear
	}
	if player.TyreLifeSpan != nil && *player.TyreLifeSpan > 0 {
		debrief.Tyres.LifeSpan = *player.TyreLifeSpan
	}
	if player.TyreUsableLife != nil && *player.TyreUsableLife > 0 {
		debrief.Tyres.UsableLife = *player.TyreUsableLife
	}
	if player.TyreLifeSpan != nil && *player.TyreLifeSpan > 0 && player.TireAge >= 0 {
		remaining := *player.TyreLifeSpan - player.TireAge
		if remaining < 0 {
			remaining = 0
		}
		debrief.Tyres.LifeRemainingPct = int(float64(remaining) / float64(*player.TyreLifeSpan) * 100)
	}
	if len(timeline) > 0 {
		debrief.Timeline = append([]dto.RaceControlNotification(nil), timeline...)
	}

	return debrief
}

func maxf32(v, min float32) float32 {
	if v < min {
		return min
	}
	return v
}
