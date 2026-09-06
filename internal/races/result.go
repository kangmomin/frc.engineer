package races

import (
	"encoding/json"
	"os"
)

// ResultSummary is the small result polled by Driver Pack. Rich archive data
// has its own detail/replay endpoints and is never part of this projection.
type ResultSummary struct {
	ID           string         `json:"id"`
	SavedAtLocal string         `json:"savedAtLocal"`
	Track        TrackInfo      `json:"track"`
	Session      SessionSummary `json:"session"`
	Player       PlayerSummary  `json:"player"`
	Highlights   RaceHighlights `json:"highlights"`
}

func ProjectResult(summary *RaceSummary) *ResultSummary {
	if summary == nil {
		return nil
	}
	result := &ResultSummary{
		ID: summary.ID, SavedAtLocal: summary.SavedAtLocal, Track: summary.Track,
		Session: summary.Session, Player: summary.Player, Highlights: summary.Highlights,
	}
	result.Player.Stints = nil
	return result
}

// LoadResult decodes only result fields and caches the latest file generation.
// Repeated polling after a restart must not repeatedly parse a full race replay.
func (s *FileStorage) LoadResult(id string) (*ResultSummary, error) {
	if !isSafeID(id) {
		return nil, ErrUnsafeID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.filePath(id))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if s.result != nil && s.resultID == id && s.resultInfo != nil && os.SameFile(info, s.resultInfo) &&
		info.Size() == s.resultInfo.Size() && info.ModTime().Equal(s.resultInfo.ModTime()) {
		copyResult := *s.result
		return &copyResult, nil
	}
	var result ResultSummary
	if err := json.NewDecoder(f).Decode(&result); err != nil {
		return nil, err
	}
	if result.ID == "" {
		result.ID = id
	}
	result.Player.Stints = nil
	s.resultID, s.resultInfo, s.result = id, info, &result
	copyResult := result
	return &copyResult, nil
}
