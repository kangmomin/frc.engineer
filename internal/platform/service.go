// Package platform is a read-only bounded context that aggregates the local
// user's own telemetry (captured races) into hub-facing read models. It has no
// notion of accounts or cross-user data — the backend is single-tenant, so
// "own data" is simply everything stored on this machine. Cross-user platform
// features (marketplace, credits, leaderboards) are deferred to a later phase.
package platform

import (
	"log/slog"
	"time"

	"frc.engineer/internal/races"
)

// recentSessionCount is how many of the newest sessions the overview surfaces.
const recentSessionCount = 8

// SessionStat is one recent captured session, sourced from race list metadata.
type SessionStat struct {
	Track string `json:"track"`
	Type  string `json:"type"`
	Pos   int    `json:"pos"`
	LapMs uint32 `json:"lapMs"`
	AtMs  int64  `json:"atMs"`
}

// OverviewStats is the own-data slice of the hub overview. It deliberately
// carries no platform fields (credits, ledger, ranks) — those stay mock on the
// frontend until the platform domain exists.
type OverviewStats struct {
	RecentSessions   []SessionStat `json:"recentSessions"`
	SeasonBestMs     uint32        `json:"seasonBestMs"`
	SeasonBestTrack  string        `json:"seasonBestTrack"`
	SessionCount     int           `json:"sessionCount"`
	SessionsThisWeek int           `json:"sessionsThisWeek"`
}

// Service builds hub read models over the race storage. It depends on the
// races.Storage interface only, so it stays testable with a fake store.
type Service struct {
	store races.Storage
	log   *slog.Logger
}

// NewService constructs a platform read-model service over the given store.
func NewService(store races.Storage, log *slog.Logger) *Service {
	return &Service{store: store, log: log}
}

// Overview aggregates the user's own captured races into the overview read
// model. It reads only list metadata (never Load, which would unmarshal full
// replay payloads under the storage lock) and never fabricates platform data.
func (s *Service) Overview() (*OverviewStats, error) {
	list, err := s.store.List()
	if err != nil {
		return nil, err
	}

	weekAgoMs := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	recent := make([]SessionStat, 0, recentSessionCount)
	var bestMs uint32
	var bestTrack string
	thisWeek := 0

	// list is newest-first (storage sorts by ID descending).
	for _, it := range list {
		atMs := parseAtMs(it.SavedAtLocal)
		if atMs > 0 && atMs >= weekAgoMs {
			thisWeek++
		}
		if it.BestLapMS > 0 && (bestMs == 0 || it.BestLapMS < bestMs) {
			bestMs = it.BestLapMS
			bestTrack = it.TrackName
		}
		if len(recent) < recentSessionCount {
			recent = append(recent, SessionStat{
				Track: it.TrackName,
				Type:  it.SessionType,
				Pos:   it.FinalPosition,
				LapMs: it.BestLapMS,
				AtMs:  atMs,
			})
		}
	}

	return &OverviewStats{
		RecentSessions:   recent,
		SeasonBestMs:     bestMs,
		SeasonBestTrack:  bestTrack,
		SessionCount:     len(list),
		SessionsThisWeek: thisWeek,
	}, nil
}

// parseAtMs converts a race's SavedAtLocal ("2006-01-02 15:04:05", server-local
// wall time, no timezone) into epoch milliseconds. On any parse failure it
// returns 0, which the frontend renders as "—" rather than a bogus time.
func parseAtMs(savedAtLocal string) int64 {
	if savedAtLocal == "" {
		return 0
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", savedAtLocal, time.Local)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}
