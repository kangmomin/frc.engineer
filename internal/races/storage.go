package races

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	rtconfig "frc.engineer/internal/config"
	"frc.engineer/internal/dto"
)

// Storage persists race summaries and serves list/detail reads.
type Storage interface {
	Save(summary *RaceSummary) (string, error)
	List() ([]RaceListItem, error)
	Load(id string) (*RaceSummary, error)
	Delete(id string) error
}

type ReplayStreamMeta struct {
	Type            string           `json:"type"`
	FrameIntervalMS int              `json:"frameIntervalMs"`
	TrackMap        *dto.TrackMapDTO `json:"trackMap,omitempty"`
	Session         *dto.SessionInfo `json:"session,omitempty"`
}

type ReplayStreamFrame struct {
	Type  string      `json:"type"`
	Frame ReplayFrame `json:"frame"`
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
	summary.DataStorageMode = rtconfig.NormalizeDataStorageMode(summary.DataStorageMode)

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
	_ = s.writeListMeta(buildRaceListItem(summary, int64(len(data))))

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
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" || strings.HasSuffix(entry.Name(), ".meta.json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !isSafeID(id) {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		item, err := s.readListMeta(id)
		if err != nil {
			item, err = scanRaceListItem(filepath.Join(s.baseDir, entry.Name()), id, info.Size())
			if err != nil {
				continue
			}
			_ = s.writeListMeta(item)
		}
		item.FileSizeBytes = info.Size()
		item.DataStorageMode = rtconfig.NormalizeDataStorageMode(item.DataStorageMode)
		if item.ID == "" {
			item.ID = id
		}
		items = append(items, item)
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
	summary.DataStorageMode = rtconfig.NormalizeDataStorageMode(summary.DataStorageMode)
	return &summary, nil
}

// Delete removes a specific race summary by ID.
func (s *FileStorage) Delete(id string) error {
	if !isSafeID(id) {
		return ErrUnsafeID
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.Remove(s.filePath(id)); err != nil {
		return err
	}
	if err := os.Remove(s.metaPath(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// CopyRawJSON streams a race summary file without decoding/re-encoding huge replay payloads.
func (s *FileStorage) CopyRawJSON(id string, w io.Writer) error {
	if !isSafeID(id) {
		return ErrUnsafeID
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	f, err := os.Open(s.filePath(id))
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(w, f)
	return err
}

// WalkReplay incrementally parses one replay and emits metadata before frames.
func (s *FileStorage) WalkReplay(
	id string,
	onMeta func(ReplayStreamMeta) error,
	onFrame func(ReplayFrame) error,
) error {
	if !isSafeID(id) {
		return ErrUnsafeID
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	f, err := os.Open(s.filePath(id))
	if err != nil {
		return err
	}
	defer f.Close()

	dec := json.NewDecoder(f)

	rootTok, err := dec.Token()
	if err != nil {
		return err
	}
	rootDelim, ok := rootTok.(json.Delim)
	if !ok || rootDelim != '{' {
		return fmt.Errorf("invalid race summary JSON object")
	}

	meta := ReplayStreamMeta{Type: "meta"}
	metaWritten := false
	emitMeta := func() error {
		if metaWritten {
			return nil
		}
		metaWritten = true
		if onMeta != nil {
			return onMeta(meta)
		}
		return nil
	}

	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return err
		}
		key, ok := keyTok.(string)
		if !ok {
			return fmt.Errorf("invalid race summary key token")
		}

		if key != "replay" {
			if err := skipJSONValue(dec); err != nil {
				return err
			}
			continue
		}

		tok, err := dec.Token()
		if err != nil {
			return err
		}
		if tok == nil {
			break
		}
		replayDelim, ok := tok.(json.Delim)
		if !ok || replayDelim != '{' {
			if err := skipTokenValue(dec, tok); err != nil {
				return err
			}
			break
		}

		for dec.More() {
			replayKeyTok, err := dec.Token()
			if err != nil {
				return err
			}
			replayKey, ok := replayKeyTok.(string)
			if !ok {
				return fmt.Errorf("invalid replay key token")
			}

			switch replayKey {
			case "frameIntervalMs":
				if err := dec.Decode(&meta.FrameIntervalMS); err != nil {
					return err
				}
			case "trackMap":
				if err := dec.Decode(&meta.TrackMap); err != nil {
					return err
				}
			case "session":
				if err := dec.Decode(&meta.Session); err != nil {
					return err
				}
			case "frames":
				if err := emitMeta(); err != nil {
					return err
				}

				framesTok, err := dec.Token()
				if err != nil {
					return err
				}
				if framesTok == nil {
					continue
				}
				framesDelim, ok := framesTok.(json.Delim)
				if !ok || framesDelim != '[' {
					if err := skipTokenValue(dec, framesTok); err != nil {
						return err
					}
					continue
				}

				for dec.More() {
					var frame ReplayFrame
					if err := dec.Decode(&frame); err != nil {
						return err
					}
					if onFrame != nil {
						if err := onFrame(frame); err != nil {
							return err
						}
					}
				}
				if _, err := dec.Token(); err != nil {
					return err
				}
			default:
				if err := skipJSONValue(dec); err != nil {
					return err
				}
			}
		}

		if _, err := dec.Token(); err != nil {
			return err
		}
	}

	if _, err := dec.Token(); err != nil {
		return err
	}

	if err := emitMeta(); err != nil {
		return err
	}

	return nil
}

// StreamReplayNDJSON streams replay metadata and frames as newline-delimited JSON.
// First line: {"type":"meta",...}
// Following lines: {"type":"frame","frame":{...}}
func (s *FileStorage) StreamReplayNDJSON(id string, w io.Writer) error {
	enc := json.NewEncoder(w)

	return s.WalkReplay(
		id,
		func(meta ReplayStreamMeta) error {
			if err := enc.Encode(meta); err != nil {
				return err
			}
			if flusher, ok := w.(interface{ Flush() }); ok {
				flusher.Flush()
			}
			return nil
		},
		func(frame ReplayFrame) error {
			if err := enc.Encode(ReplayStreamFrame{Type: "frame", Frame: frame}); err != nil {
				return err
			}
			if flusher, ok := w.(interface{ Flush() }); ok {
				flusher.Flush()
			}
			return nil
		},
	)
}

func (s *FileStorage) filePath(id string) string {
	return filepath.Join(s.baseDir, id+".json")
}

func (s *FileStorage) metaPath(id string) string {
	return filepath.Join(s.baseDir, id+".meta.json")
}

func (s *FileStorage) readListMeta(id string) (RaceListItem, error) {
	data, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		return RaceListItem{}, err
	}

	var item RaceListItem
	if err := json.Unmarshal(data, &item); err != nil {
		return RaceListItem{}, err
	}
	return item, nil
}

func (s *FileStorage) writeListMeta(item RaceListItem) error {
	if !isSafeID(item.ID) {
		return ErrUnsafeID
	}
	data, err := json.Marshal(item)
	if err != nil {
		return err
	}
	return os.WriteFile(s.metaPath(item.ID), data, 0o644)
}

func buildRaceListItem(summary *RaceSummary, fileSize int64) RaceListItem {
	if summary == nil {
		return RaceListItem{}
	}
	frameCount := 0
	if summary.Replay != nil {
		frameCount = len(summary.Replay.Frames)
	}
	return RaceListItem{
		ID:              summary.ID,
		SavedAtLocal:    summary.SavedAtLocal,
		TrackName:       summary.Track.TrackName,
		SessionType:     summary.Session.SessionType,
		PlayerName:      summary.Player.Name,
		FinalPosition:   summary.Player.FinalPosition,
		FileSizeBytes:   fileSize,
		DataStorageMode: rtconfig.NormalizeDataStorageMode(summary.DataStorageMode),
		HasReplay:       frameCount > 0,
		FrameCount:      frameCount,
	}
}

func scanRaceListItem(path, fallbackID string, fileSize int64) (RaceListItem, error) {
	f, err := os.Open(path)
	if err != nil {
		return RaceListItem{}, err
	}
	defer f.Close()

	dec := json.NewDecoder(f)
	tok, err := dec.Token()
	if err != nil {
		return RaceListItem{}, err
	}
	delim, ok := tok.(json.Delim)
	if !ok || delim != '{' {
		return RaceListItem{}, fmt.Errorf("invalid race summary JSON object")
	}

	item := RaceListItem{
		ID:            fallbackID,
		FileSizeBytes: fileSize,
	}

	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return RaceListItem{}, err
		}
		key, ok := keyTok.(string)
		if !ok {
			return RaceListItem{}, fmt.Errorf("invalid race summary key token")
		}

		switch key {
		case "id":
			if err := dec.Decode(&item.ID); err != nil {
				return RaceListItem{}, err
			}
		case "savedAtLocal":
			if err := dec.Decode(&item.SavedAtLocal); err != nil {
				return RaceListItem{}, err
			}
		case "dataStorageMode":
			if err := dec.Decode(&item.DataStorageMode); err != nil {
				return RaceListItem{}, err
			}
		case "track":
			var track struct {
				TrackName string `json:"trackName"`
			}
			if err := dec.Decode(&track); err != nil {
				return RaceListItem{}, err
			}
			item.TrackName = track.TrackName
		case "session":
			var session struct {
				SessionType string `json:"sessionType"`
			}
			if err := dec.Decode(&session); err != nil {
				return RaceListItem{}, err
			}
			item.SessionType = session.SessionType
		case "player":
			var player struct {
				Name          string `json:"name"`
				FinalPosition int    `json:"finalPosition"`
			}
			if err := dec.Decode(&player); err != nil {
				return RaceListItem{}, err
			}
			item.PlayerName = player.Name
			item.FinalPosition = player.FinalPosition
		case "replay":
			hasReplay, frameCount, err := scanReplayMeta(dec)
			if err != nil {
				return RaceListItem{}, err
			}
			item.HasReplay = hasReplay
			item.FrameCount = frameCount
		default:
			if err := skipJSONValue(dec); err != nil {
				return RaceListItem{}, err
			}
		}
	}

	if _, err := dec.Token(); err != nil {
		return RaceListItem{}, err
	}

	item.DataStorageMode = rtconfig.NormalizeDataStorageMode(item.DataStorageMode)
	if item.ID == "" {
		item.ID = fallbackID
	}
	return item, nil
}

func scanReplayMeta(dec *json.Decoder) (bool, int, error) {
	tok, err := dec.Token()
	if err != nil {
		return false, 0, err
	}
	if tok == nil {
		return false, 0, nil
	}

	delim, ok := tok.(json.Delim)
	if !ok {
		return false, 0, nil
	}
	if delim != '{' {
		if err := skipTokenValue(dec, tok); err != nil {
			return false, 0, err
		}
		return false, 0, nil
	}

	frameCount := 0
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return false, 0, err
		}
		key, ok := keyTok.(string)
		if !ok {
			return false, 0, fmt.Errorf("invalid replay key token")
		}

		if key == "frames" {
			count, err := countJSONArrayValues(dec)
			if err != nil {
				return false, 0, err
			}
			frameCount = count
			continue
		}
		if err := skipJSONValue(dec); err != nil {
			return false, 0, err
		}
	}

	if _, err := dec.Token(); err != nil {
		return false, 0, err
	}
	return frameCount > 0, frameCount, nil
}

func countJSONArrayValues(dec *json.Decoder) (int, error) {
	tok, err := dec.Token()
	if err != nil {
		return 0, err
	}
	if tok == nil {
		return 0, nil
	}

	delim, ok := tok.(json.Delim)
	if !ok {
		return 0, nil
	}
	if delim != '[' {
		if err := skipTokenValue(dec, tok); err != nil {
			return 0, err
		}
		return 0, nil
	}

	count := 0
	for dec.More() {
		count++
		if err := skipJSONValue(dec); err != nil {
			return 0, err
		}
	}

	if _, err := dec.Token(); err != nil {
		return 0, err
	}
	return count, nil
}

func skipJSONValue(dec *json.Decoder) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	return skipTokenValue(dec, tok)
}

func skipTokenValue(dec *json.Decoder, tok json.Token) error {
	delim, ok := tok.(json.Delim)
	if !ok {
		return nil
	}

	switch delim {
	case '{':
		for dec.More() {
			if _, err := dec.Token(); err != nil {
				return err
			}
			if err := skipJSONValue(dec); err != nil {
				return err
			}
		}
		_, err := dec.Token()
		return err
	case '[':
		for dec.More() {
			if err := skipJSONValue(dec); err != nil {
				return err
			}
		}
		_, err := dec.Token()
		return err
	default:
		return nil
	}
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
