package strategydata

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"frc.engineer/internal/tracks"
)

type Store struct {
	root      string
	tracks    map[string]*NormalizedTrackFile
	aliases   map[string]string
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

var strategyTrackAliases = map[string]string{
	// trackFileMap 이름 → strategy slug (recorded track 매칭용)
	"melbourne":   "australia",
	"shanghai":    "china",
	"sakhir":      "bahrain",
	"catalunya":   "spain",
	"montreal":    "canada",
	"silverstone": "britain",
	"hungaroring": "hungary",
	"spa":         "belgium",
	"monza":       "italy",
	"suzuka":      "japan",
	"baku":        "azerbaijan",
	"zandvoort":   "netherlands",
	"jeddah":      "saudi-arabia",
	"losail":      "qatar",
	"las_vegas":   "las-vegas",
	"abu_dhabi":   "abu-dhabi",

	// 공식 서킷명 별칭
	"albert park":                   "australia",
	"bahrain international":         "bahrain",
	"bahrain international circuit": "bahrain",
	"barcelona":                     "spain",
	"circuit gilles villeneuve":     "canada",
	"silverstone circuit":           "britain",
	"spa francorchamps":             "belgium",
	"spa-francorchamps":             "belgium",
	"yas marina":                    "abu-dhabi",
	"yas marina circuit":            "abu-dhabi",
	"cota":                          "texas",
	"circuit of the americas":       "texas",
	"red bull ring":                 "austria",
	"baku city circuit":             "azerbaijan",
	"jeddah corniche":               "saudi-arabia",
	"jeddah corniche circuit":       "saudi-arabia",
	"lusail":                        "qatar",
	"lusail international circuit":  "qatar",
	"autodromo nazionale monza":     "italy",
	"autodromo hermanos rodriguez":  "mexico",
	"autodromo enzo e dino ferrari": "imola",
	"las vegas strip circuit":       "las-vegas",
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
		root:    root,
		tracks:  make(map[string]*NormalizedTrackFile, len(trackPaths)),
		aliases: make(map[string]string, len(trackPaths)*3),
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
		store.aliases[normalizeTrackLookupKey(track.Track)] = track.Track
	}

	for trackID, slug := range strategyTrackSlugByID {
		store.aliases[normalizeTrackLookupKey(slug)] = slug
		displayName := tracks.TrackName(trackID)
		if displayName != "Unknown" {
			store.aliases[normalizeTrackLookupKey(displayName)] = slug
		}
		storageKey := tracks.TrackStorageKey(trackID)
		if storageKey != "unknown" {
			store.aliases[normalizeTrackLookupKey(storageKey)] = slug
		}
	}
	for alias, slug := range strategyTrackAliases {
		store.aliases[normalizeTrackLookupKey(alias)] = slug
	}

	for trackID, slug := range strategyTrackSlugByID {
		if _, ok := store.tracks[slug]; !ok {
			slog.Warn("strategy data missing for track", "trackID", trackID, "slug", slug)
		}
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

func (s *Store) TrackByName(trackName string) *NormalizedTrackFile {
	if s == nil {
		return nil
	}
	slug, ok := s.aliases[normalizeTrackLookupKey(trackName)]
	if !ok {
		return nil
	}
	return s.tracks[slug]
}

func (s *Store) TrackBySession(trackID int8, trackName string) *NormalizedTrackFile {
	if s == nil {
		return nil
	}
	if track := s.TrackByID(trackID); track != nil {
		return track
	}
	if track := s.TrackByName(trackName); track != nil {
		return track
	}
	slog.Warn("strategy track lookup failed", "trackID", trackID, "trackName", trackName)
	return nil
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

func normalizeTrackLookupKey(name string) string {
	normalized := strings.TrimSpace(strings.ToLower(name))
	if normalized == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		"_", " ",
		"-", " ",
		"/", " ",
		".", " ",
		",", " ",
		"(", " ",
		")", " ",
	)
	normalized = replacer.Replace(normalized)
	return strings.Join(strings.Fields(normalized), " ")
}
