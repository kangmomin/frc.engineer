package races

import (
	"strings"
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

// RaceSummarySchemaVersion is the single document version stamped on every
// persisted summary. Bump when the summary/Detail structure changes so readers can
// discriminate. 0 = legacy (pre-versioning, no Detail); 1 = rich Detail.
const RaceSummarySchemaVersion = 1

// RaceSummary is the persisted, non-raw race result snapshot. SchemaVersion is
// always emitted (a single document version is an explicit signal, so readers
// never have to guess). GameFormat and Detail are the rich, player-centric
// enrichments; GameFormat in particular is the leaderboard/market partition key,
// so it must be present from v1 (the local JSON is immutable history).
type RaceSummary struct {
	ID              string                   `json:"id"`
	SchemaVersion   int                      `json:"schemaVersion"`
	SavedAtLocal    string                   `json:"savedAtLocal"`
	SessionUID      uint64                   `json:"sessionUID"`
	DataStorageMode rtconfig.DataStorageMode `json:"dataStorageMode,omitempty"`
	GameFormat      string                   `json:"gameFormat,omitempty"`
	Track           TrackInfo                `json:"track"`
	Session         SessionSummary           `json:"session"`
	Player          PlayerSummary            `json:"player"`
	Drivers         []DriverSummary          `json:"drivers"`
	Highlights      RaceHighlights           `json:"highlights"`
	Debrief         *RaceDebrief             `json:"debrief,omitempty"`
	Detail          *RaceDetail              `json:"detail,omitempty"`
	Replay          *ReplayTimeline          `json:"replay,omitempty"`
	// Incidents is the player-involved collision capture block. Top-level (not in
	// Detail) so every DataChannel path can strip it like Replay — the untrimmed
	// local block can far exceed the 256KB SCTP budget. The upload path sends a
	// budget-trimmed copy (TrimIncidentsForUpload) inside the race_detail payload.
	Incidents []dto.IncidentClip `json:"incidents,omitempty"`
}

// RaceDetail is the rich, player-centric sub-block (per-lap timings/dynamics, the
// event timeline, and the car setup). Kept as one optional pointer block — like
// Replay — so the base summary is unchanged for legacy/resultOnly readers and the
// whole block maps 1:1 onto the platform race_detail JSONB payload. Player-centric
// on purpose: all-24-car per-lap data would overflow the DataChannel SCTP budget.
type RaceDetail struct {
	Laps     []dto.LapTimingDTO            `json:"laps,omitempty"`
	Dynamics []dto.DynamicsLapDTO          `json:"dynamics,omitempty"`
	Events   []dto.RaceControlNotification `json:"events,omitempty"`
	Setup    *dto.CarSetupDTO              `json:"setup,omitempty"`
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

// RaceStint summarises one tire stint. StartLap/EndLap/TireWearPct are rich
// enrichments (omitempty) — zero on legacy summaries.
type RaceStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    int    `json:"startLap,omitempty"`
	EndLap      int    `json:"endLap,omitempty"`
	TireWearPct int    `json:"tireWearPct,omitempty"`
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
	StationaryTimeMS    uint32 `json:"stationaryTimeMs,omitempty"` // 실측 정지 작업 시간(스톱 유형 분류 입력)
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

// BuildSummary creates a race summary from the latest pitwall snapshot plus the
// rich, player-centric detail gathered by the caller (per-lap timings, setup,
// lap-tagged events). detail may be nil (e.g. a caller with no rich inputs);
// SchemaVersion is stamped unconditionally.
func BuildSummary(sessionUID uint64, state *dto.PitwallState, counts NotificationCounts, timeline []dto.RaceControlNotification, detail *dto.RaceDetailInput, savedAt time.Time) *RaceSummary {
	out := &RaceSummary{
		SchemaVersion:   RaceSummarySchemaVersion,
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

	out.GameFormat = gameFormatLabel(state.GameFormat)

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
			driver.Stints = stintsFromDTO(d.StintHistory)
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
			// The player's stints drive the rich Detail's per-lap tyre mapping, so
			// synthesize the final in-progress stint (StintHistory only closes on a
			// compound change — the last, ongoing stint is otherwise missing).
			out.Player.Stints = appendCurrentStint(stintsFromDTO(p.StintHistory), p)
			out.Debrief = buildDebrief(p, state, out.Highlights.FastestLapMS, timeline)

			out.Detail = buildDetail(detail, p, out.Player.Stints)
		}
	}

	return out
}

// gameFormatLabel maps the packet format year to the platform's game_format label
// ("F1 25"/"F1 26") — the leaderboard/market partition key. Unknown → "".
func gameFormatLabel(format int) string {
	switch format {
	case 2025:
		return "F1 25"
	case 2026:
		return "F1 26"
	default:
		return ""
	}
}

// stintsFromDTO copies stint DTOs, carrying the StartLap/EndLap/wear enrichments.
func stintsFromDTO(src []dto.StintInfoDTO) []RaceStint {
	if len(src) == 0 {
		return nil
	}
	out := make([]RaceStint, len(src))
	for i, s := range src {
		out[i] = RaceStint{
			Compound:    s.Compound,
			Laps:        s.Laps,
			StartLap:    s.StartLap,
			EndLap:      s.EndLap,
			TireWearPct: s.TireWearPct,
		}
	}
	return out
}

// appendCurrentStint appends the player's ongoing (unclosed) stint so the stint
// list spans the whole race — StintHistory only closes a stint on a compound
// change, so the last, in-progress stint is otherwise missing. StartLap continues
// from the last closed stint; wear is the current 4-corner average.
func appendCurrentStint(stints []RaceStint, p dto.DriverInfo) []RaceStint {
	if p.TireCompound == "" || p.TireCompound == "unknown" {
		return stints
	}
	lastEnd := 0
	if n := len(stints); n > 0 {
		lastEnd = stints[n-1].EndLap
	}
	start := lastEnd + 1
	end := p.CurrentLapNum
	if end < start {
		return stints // no completed lap in the current stint yet
	}
	return append(stints, RaceStint{
		Compound:    p.TireCompound,
		Laps:        end - start + 1,
		StartLap:    start,
		EndLap:      end,
		TireWearPct: avgTireWear(p.TireWear),
	})
}

// avgTireWear returns the rounded mean of the 4-corner wear percentages.
func avgTireWear(w [4]int) int {
	return (w[0] + w[1] + w[2] + w[3] + 2) / 4
}

// buildDetail assembles the rich Detail sub-block from the injected inputs plus the
// player's dynamics (already on the driver DTO). Per-lap tyre is derived by joining
// each lap number against the player's stint ranges (the session-history packet
// carries no per-lap compound). Returns nil when there is nothing rich to store.
func buildDetail(in *dto.RaceDetailInput, p dto.DriverInfo, stints []RaceStint) *RaceDetail {
	if in == nil {
		return nil
	}
	laps := in.PlayerLaps
	if len(laps) > 0 {
		laps = append([]dto.LapTimingDTO(nil), laps...)
		for i := range laps {
			laps[i].Tyre = tyreForLap(laps[i].LapNumber, stints)
		}
	}
	detail := &RaceDetail{
		Laps:     laps,
		Dynamics: p.Dynamics,
		Events:   in.RichEvents,
		Setup:    in.PlayerSetup,
	}
	if len(detail.Laps) == 0 && len(detail.Dynamics) == 0 && len(detail.Events) == 0 && detail.Setup == nil {
		return nil
	}
	return detail
}

// tyreForLap returns the canonical compound of the stint covering lapNum, or "".
func tyreForLap(lapNum int, stints []RaceStint) string {
	for _, s := range stints {
		if lapNum >= s.StartLap && lapNum <= s.EndLap {
			return canonicalTyre(s.Compound)
		}
	}
	return ""
}

// canonicalTyre maps an internal lowercase compound to the platform's whitelisted
// capitalized form (Soft/Medium/Hard/Inter/Wet); unknown → "".
func canonicalTyre(compound string) string {
	switch strings.ToLower(compound) {
	case "soft":
		return "Soft"
	case "medium":
		return "Medium"
	case "hard":
		return "Hard"
	case "inter", "intermediate":
		return "Inter"
	case "wet":
		return "Wet"
	default:
		return ""
	}
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
	if player.MeasuredPitLaneMs > 0 {
		// 스톱 완료 시점에 확정된 실측값 — 종료 시점 라이브 PitLaneTime 리셋에 영향받지 않는다.
		// PitLaneTimeMS는 이 measured 경로에서만 채워지므로, 업로더의 "실측만 업로드" 게이트가
		// 라이브 폴백 부분값을 흘리지 않는다(Fable M3).
		debrief.Pit.PitLaneTimeMS = uint32(player.MeasuredPitLaneMs)
		debrief.Pit.StationaryTimeMS = uint32(player.MeasuredPitStopMs)
		debrief.Pit.EstimatedTimeLostMS = uint32(player.MeasuredPitLaneMs)
	} else if player.PitLaneTime > 0 {
		// 라이브 폴백: 종료 시점 레인시간은 부분값일 수 있어 실측으로 신뢰하지 않는다.
		// 표시용 추정(EstimatedTimeLostMS)으로만 남기고 PitLaneTimeMS는 비워 업로드에서 제외한다.
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
