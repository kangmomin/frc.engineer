package platform

import (
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"frc.engineer/internal/races"
)

// fakeStore is a races.Storage that only implements List meaningfully.
type fakeStore struct {
	items []races.RaceListItem
	err   error
}

func (f *fakeStore) List() ([]races.RaceListItem, error)     { return f.items, f.err }
func (f *fakeStore) Save(*races.RaceSummary) (string, error) { return "", nil }
func (f *fakeStore) Load(string) (*races.RaceSummary, error) { return nil, nil }
func (f *fakeStore) Delete(string) error                     { return nil }

func localStamp(t time.Time) string { return t.Format("2006-01-02 15:04:05") }

func TestOverviewRecentAndSeasonBest(t *testing.T) {
	now := time.Now()
	items := make([]races.RaceListItem, 0, 10)
	// 10 sessions, newest-first, with slowly increasing lap times.
	for i := range 10 {
		items = append(items, races.RaceListItem{
			ID:            fmt.Sprintf("id-%02d", 10-i),
			SavedAtLocal:  localStamp(now.Add(-time.Duration(i) * time.Hour)),
			TrackName:     fmt.Sprintf("Track%d", i),
			SessionType:   "TIME TRIAL",
			FinalPosition: i + 1,
			BestLapMS:     uint32(90000 + i*100),
		})
	}
	// The global fastest lap sits at index 9 — outside the recent-8 window — so
	// this asserts SeasonBest scans the full list, not just RecentSessions.
	items[9].BestLapMS = 80000
	items[9].TrackName = "FastTrack"

	got, err := NewService(&fakeStore{items: items}, slog.Default()).Overview()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.SessionCount != 10 {
		t.Errorf("SessionCount = %d, want 10", got.SessionCount)
	}
	if len(got.RecentSessions) != 8 {
		t.Fatalf("RecentSessions len = %d, want 8", len(got.RecentSessions))
	}
	if got.RecentSessions[0].Track != "Track0" {
		t.Errorf("RecentSessions[0].Track = %q, want Track0 (newest-first)", got.RecentSessions[0].Track)
	}
	if got.SeasonBestMs != 80000 {
		t.Errorf("SeasonBestMs = %d, want 80000", got.SeasonBestMs)
	}
	if got.SeasonBestTrack != "FastTrack" {
		t.Errorf("SeasonBestTrack = %q, want FastTrack", got.SeasonBestTrack)
	}
}

func TestOverviewNoValidLaps(t *testing.T) {
	now := time.Now()
	items := []races.RaceListItem{
		{ID: "id-2", SavedAtLocal: localStamp(now), TrackName: "A", BestLapMS: 0},
		{ID: "id-1", SavedAtLocal: localStamp(now), TrackName: "B", BestLapMS: 0},
	}
	got, err := NewService(&fakeStore{items: items}, slog.Default()).Overview()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// No valid lap anywhere → SeasonBest stays zero-valued (frontend shows "—"),
	// never masked by a mock fallback.
	if got.SeasonBestMs != 0 {
		t.Errorf("SeasonBestMs = %d, want 0", got.SeasonBestMs)
	}
	if got.SeasonBestTrack != "" {
		t.Errorf("SeasonBestTrack = %q, want empty", got.SeasonBestTrack)
	}
	if len(got.RecentSessions) != 2 || got.RecentSessions[0].LapMs != 0 {
		t.Errorf("recent sessions should still list with LapMs 0, got %+v", got.RecentSessions)
	}
}

func TestOverviewListErrorPropagates(t *testing.T) {
	wantErr := errors.New("read race storage dir")
	_, err := NewService(&fakeStore{err: wantErr}, slog.Default()).Overview()
	if !errors.Is(err, wantErr) {
		t.Errorf("err = %v, want it to wrap %v (List errors must not be swallowed)", err, wantErr)
	}
}

func TestOverviewBadTimestampYieldsZeroAtMs(t *testing.T) {
	items := []races.RaceListItem{
		{ID: "id-1", SavedAtLocal: "not-a-date", TrackName: "A", BestLapMS: 90000},
	}
	got, err := NewService(&fakeStore{items: items}, slog.Default()).Overview()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.RecentSessions[0].AtMs != 0 {
		t.Errorf("AtMs = %d, want 0 on unparseable timestamp", got.RecentSessions[0].AtMs)
	}
}

func TestOverviewSessionsThisWeek(t *testing.T) {
	now := time.Now()
	items := []races.RaceListItem{
		{ID: "id-3", SavedAtLocal: localStamp(now.Add(-1 * time.Hour)), TrackName: "A", BestLapMS: 90000},
		{ID: "id-2", SavedAtLocal: localStamp(now.Add(-3 * 24 * time.Hour)), TrackName: "B", BestLapMS: 90000},
		{ID: "id-1", SavedAtLocal: localStamp(now.Add(-10 * 24 * time.Hour)), TrackName: "C", BestLapMS: 90000},
	}
	got, err := NewService(&fakeStore{items: items}, slog.Default()).Overview()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.SessionsThisWeek != 2 {
		t.Errorf("SessionsThisWeek = %d, want 2", got.SessionsThisWeek)
	}
}
