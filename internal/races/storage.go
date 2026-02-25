package races

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Storage persists race summaries and serves list/detail reads.
type Storage interface {
	Save(summary *RaceSummary) (string, error)
	List() ([]RaceListItem, error)
	Load(id string) (*RaceSummary, error)
}

// FileStorage stores race summaries as JSON files.
type FileStorage struct {
	baseDir string
	logger  *slog.Logger
	mu      sync.RWMutex
}

var safeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ErrUnsafeID is returned when a summary identifier contains unsafe characters.
var ErrUnsafeID = errors.New("unsafe race summary id")

// NewFileStorage creates a file-backed race summary storage.
func NewFileStorage(baseDir string, logger *slog.Logger) (*FileStorage, error) {
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create race storage dir: %w", err)
	}
	return &FileStorage{
		baseDir: baseDir,
		logger:  logger,
	}, nil
}

// Save persists one race summary using an atomic temp-file rename.
func (s *FileStorage) Save(summary *RaceSummary) (string, error) {
	if summary == nil {
		return "", fmt.Errorf("summary is nil")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	id := summary.ID
	if id == "" {
		timestamp := time.Now().Format("20060102_150405")
		trackSlug := slugTrackName(summary.Track.TrackName)
		if trackSlug == "" {
			trackSlug = "unknown_track"
		}
		id = fmt.Sprintf("%s_%s_%d", timestamp, trackSlug, summary.SessionUID)
	}
	if !isSafeID(id) {
		return "", ErrUnsafeID
	}

	summary.ID = id
	if summary.SavedAtLocal == "" {
		summary.SavedAtLocal = time.Now().Format("2006-01-02 15:04:05")
	}

	path := s.filePath(id)
	data, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal summary: %w", err)
	}

	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return "", fmt.Errorf("write temp summary: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("rename temp summary: %w", err)
	}

	if s.logger != nil {
		s.logger.Info("race summary saved", "id", id, "path", path)
	}
	return id, nil
}

// List returns a lightweight summary list sorted by newest first.
func (s *FileStorage) List() ([]RaceListItem, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read race storage dir: %w", err)
	}

	items := make([]RaceListItem, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !isSafeID(id) {
			continue
		}

		data, err := os.ReadFile(filepath.Join(s.baseDir, entry.Name()))
		if err != nil {
			continue
		}
		var summary RaceSummary
		if err := json.Unmarshal(data, &summary); err != nil {
			continue
		}
		if summary.ID == "" {
			summary.ID = id
		}

		items = append(items, RaceListItem{
			ID:            summary.ID,
			SavedAtLocal:  summary.SavedAtLocal,
			TrackName:     summary.Track.TrackName,
			SessionType:   summary.Session.SessionType,
			PlayerName:    summary.Player.Name,
			FinalPosition: summary.Player.FinalPosition,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].ID > items[j].ID
	})
	return items, nil
}

// Load reads a specific race summary by ID.
func (s *FileStorage) Load(id string) (*RaceSummary, error) {
	if !isSafeID(id) {
		return nil, ErrUnsafeID
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.filePath(id))
	if err != nil {
		return nil, err
	}

	var summary RaceSummary
	if err := json.Unmarshal(data, &summary); err != nil {
		return nil, fmt.Errorf("unmarshal race summary: %w", err)
	}
	if summary.ID == "" {
		summary.ID = id
	}
	return &summary, nil
}

func (s *FileStorage) filePath(id string) string {
	return filepath.Join(s.baseDir, id+".json")
}

func isSafeID(id string) bool {
	if id == "" || len(id) > 256 {
		return false
	}
	return safeIDPattern.MatchString(id)
}

func slugTrackName(name string) string {
	if name == "" {
		return ""
	}
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastUnderscore := false
	for _, r := range name {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "track"
	}
	return out
}
