package strategydata

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type Store struct {
	root      string
	tracks    map[string]*NormalizedTrackFile
	tyreTemps *NormalizedTyreTempDataset
}

var strategyTrackSlugByID = map[int8]string{
	0:  "australia",
	2:  "china",
	3:  "bahrain",
	4:  "spain",
	5:  "monaco",
	6:  "canada",
	7:  "britain",
	8:  "hungary",
	9:  "belgium",
	10: "italy",
	11: "singapore",
	12: "japan",
	13: "abu-dhabi",
	14: "texas",
	16: "brazil",
	17: "austria",
	19: "mexico",
	20: "azerbaijan",
	23: "netherlands",
	24: "imola",
	25: "saudi-arabia",
	26: "miami",
	27: "qatar",
	28: "las-vegas",
}

func LoadStore(root string) (*Store, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}

	trackPaths, err := filepath.Glob(filepath.Join(root, "tracks", "*.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(trackPaths)

	store := &Store{
		root:   root,
		tracks: make(map[string]*NormalizedTrackFile, len(trackPaths)),
	}

	for _, path := range trackPaths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var track NormalizedTrackFile
		if err := json.Unmarshal(data, &track); err != nil {
			return nil, fmt.Errorf("unmarshal %s: %w", path, err)
		}
		store.tracks[track.Track] = &track
	}

	tyreData, err := os.ReadFile(filepath.Join(root, "tyre_temps.json"))
	if err != nil {
		return nil, err
	}
	var tyreTemps NormalizedTyreTempDataset
	if err := json.Unmarshal(tyreData, &tyreTemps); err != nil {
		return nil, fmt.Errorf("unmarshal tyre_temps.json: %w", err)
	}
	store.tyreTemps = &tyreTemps

	return store, nil
}

func (s *Store) TrackByID(trackID int8) *NormalizedTrackFile {
	if s == nil {
		return nil
	}
	slug, ok := strategyTrackSlugByID[trackID]
	if !ok {
		return nil
	}
	return s.tracks[slug]
}

func (s *Store) TyreTemps() *NormalizedTyreTempDataset {
	if s == nil {
		return nil
	}
	return s.tyreTemps
}

func (s *Store) TrackCount() int {
	if s == nil {
		return 0
	}
	return len(s.tracks)
}

func StrategyTrackSlug(trackID int8) string {
	return strategyTrackSlugByID[trackID]
}
