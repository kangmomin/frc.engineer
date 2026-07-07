package races

import (
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"frc.engineer/internal/dto"
)

func TestFileStorageSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, slog.Default())
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	summary := &RaceSummary{
		SessionUID: 77,
		Track: TrackInfo{
			TrackName: "Bahrain GP",
		},
		Session: SessionSummary{
			SessionType: "Race",
		},
		Player: PlayerSummary{
			Name:          "Player",
			FinalPosition: 3,
		},
	}

	id, err := store.Save(summary)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if id == "" {
		t.Fatal("Save() returned empty id")
	}

	got, err := store.Load(id)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.ID != id {
		t.Fatalf("Load().ID = %q, want %q", got.ID, id)
	}
	if got.Track.TrackName != "Bahrain GP" {
		t.Fatalf("Load().Track.TrackName = %q, want Bahrain GP", got.Track.TrackName)
	}
}

func TestFileStorageSchemaVersionStampAndPreserve(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	// A fresh save with an unset version is stamped to the current version (writer
	// always stamps — a reader never has to guess).
	id, err := store.Save(&RaceSummary{
		SessionUID: 1,
		Track:      TrackInfo{TrackName: "Bahrain"},
		Session:    SessionSummary{SessionType: "Race"},
		Player:     PlayerSummary{Name: "P", FinalPosition: 1},
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	got, err := store.Load(id)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.SchemaVersion != RaceSummarySchemaVersion {
		t.Fatalf("stamped SchemaVersion = %d, want %d", got.SchemaVersion, RaceSummarySchemaVersion)
	}

	// A pre-versioning file on disk (no schemaVersion key) must load as 0 — the
	// reader preserves the stored value and never force-promotes it.
	legacyID := "20260101_000000_legacy_1"
	legacy := []byte(`{"id":"` + legacyID + `","sessionUID":2,"track":{"trackName":"Imola"},"player":{"name":"Old"}}`)
	if err := os.WriteFile(filepath.Join(dir, legacyID+".json"), legacy, 0o644); err != nil {
		t.Fatalf("write legacy file: %v", err)
	}
	loaded, err := store.Load(legacyID)
	if err != nil {
		t.Fatalf("Load(legacy) error = %v", err)
	}
	if loaded.SchemaVersion != 0 {
		t.Fatalf("legacy SchemaVersion = %d, want 0 (preserved, not promoted)", loaded.SchemaVersion)
	}
}

func TestFileStorageLoadRejectsUnsafeID(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	if _, err := store.Load("../escape"); err != ErrUnsafeID {
		t.Fatalf("Load() unsafe id error = %v, want %v", err, ErrUnsafeID)
	}
}

func TestFileStorageListSortedNewestFirst(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	oldID := "20260225_110000_bahrain_1"
	newID := "20260225_120000_monza_2"

	_, err = store.Save(&RaceSummary{
		ID:           oldID,
		SavedAtLocal: time.Now().Add(-time.Hour).Format("2006-01-02 15:04:05"),
		SessionUID:   1,
		Track:        TrackInfo{TrackName: "Bahrain"},
		Session:      SessionSummary{SessionType: "Race"},
		Player:       PlayerSummary{Name: "Old", FinalPosition: 5},
	})
	if err != nil {
		t.Fatalf("Save(old) error = %v", err)
	}

	_, err = store.Save(&RaceSummary{
		ID:           newID,
		SavedAtLocal: time.Now().Format("2006-01-02 15:04:05"),
		SessionUID:   2,
		Track:        TrackInfo{TrackName: "Monza"},
		Session:      SessionSummary{SessionType: "Race"},
		Player:       PlayerSummary{Name: "New", FinalPosition: 2},
	})
	if err != nil {
		t.Fatalf("Save(new) error = %v", err)
	}

	items, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("List() len = %d, want 2", len(items))
	}
	if items[0].ID != newID || items[1].ID != oldID {
		t.Fatalf("List() order = [%s, %s], want [%s, %s]", items[0].ID, items[1].ID, newID, oldID)
	}
	if items[0].FileSizeBytes <= 0 || items[1].FileSizeBytes <= 0 {
		t.Fatalf("List() expected positive file sizes, got [%d, %d]", items[0].FileSizeBytes, items[1].FileSizeBytes)
	}

	if _, err := os.Stat(filepath.Join(dir, newID+".json")); err != nil {
		t.Fatalf("saved file missing: %v", err)
	}
}

func TestFileStorageDelete(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	id, err := store.Save(&RaceSummary{
		ID:         "20260225_130000_losail_7",
		SessionUID: 7,
		Track:      TrackInfo{TrackName: "Losail"},
		Session:    SessionSummary{SessionType: "Race"},
		Player:     PlayerSummary{Name: "Driver", FinalPosition: 1},
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if err := store.Delete(id); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	if _, err := store.Load(id); !os.IsNotExist(err) {
		t.Fatalf("Load() after delete error = %v, want not exist", err)
	}
}

func TestFileStorageDeleteRejectsUnsafeID(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	if err := store.Delete("../escape"); err != ErrUnsafeID {
		t.Fatalf("Delete() unsafe id error = %v, want %v", err, ErrUnsafeID)
	}
}

func TestFileStorageListPopulatesBestLap(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	if _, err := store.Save(&RaceSummary{
		ID:           "20260301_120000_spa_9",
		SavedAtLocal: time.Now().Format("2006-01-02 15:04:05"),
		Track:        TrackInfo{TrackName: "Spa"},
		Session:      SessionSummary{SessionType: "Time Trial"},
		Player:       PlayerSummary{Name: "P", FinalPosition: 1, BestLapMS: 91234},
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	items, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("List() len = %d, want 1", len(items))
	}
	if items[0].BestLapMS != 91234 {
		t.Fatalf("List()[0].BestLapMS = %d, want 91234", items[0].BestLapMS)
	}
}

func TestFileStorageStaleMetaRescanned(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStorage(dir, nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	id, err := store.Save(&RaceSummary{
		ID:           "20260301_130000_imola_4",
		SavedAtLocal: time.Now().Format("2006-01-02 15:04:05"),
		Track:        TrackInfo{TrackName: "Imola"},
		Session:      SessionSummary{SessionType: "Time Trial"},
		Player:       PlayerSummary{Name: "P", FinalPosition: 2, BestLapMS: 74905},
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	// Simulate a pre-BestLapMS sidecar: no metaVersion, stale zero best lap.
	stale := []byte(`{"id":"` + id + `","trackName":"Imola","bestLapMs":0}`)
	if err := os.WriteFile(filepath.Join(dir, id+".meta.json"), stale, 0o644); err != nil {
		t.Fatalf("write stale meta: %v", err)
	}

	items, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("List() len = %d, want 1", len(items))
	}
	if items[0].BestLapMS != 74905 {
		t.Fatalf("stale meta not rescanned: BestLapMS = %d, want 74905", items[0].BestLapMS)
	}
}

func TestFileStorageWalkReplayEmitsMetaBeforeFrames(t *testing.T) {
	t.Parallel()

	store, err := NewFileStorage(t.TempDir(), nil)
	if err != nil {
		t.Fatalf("NewFileStorage() error = %v", err)
	}

	_, err = store.Save(&RaceSummary{
		ID: "race_walk_replay",
		Replay: &ReplayTimeline{
			FrameIntervalMS: 500,
			TrackMap: &dto.TrackMapDTO{
				MinX: 1,
				MaxX: 2,
			},
			Frames: []ReplayFrame{
				{Timestamp: 1000, Pitwall: &dto.PitwallState{PlayerIndex: 1}},
				{Timestamp: 1500, Pitwall: &dto.PitwallState{PlayerIndex: 2}},
			},
		},
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	order := make([]string, 0, 3)
	var meta ReplayStreamMeta
	frames := make([]ReplayFrame, 0, 2)

	err = store.WalkReplay(
		"race_walk_replay",
		func(nextMeta ReplayStreamMeta) error {
			order = append(order, "meta")
			meta = nextMeta
			return nil
		},
		func(frame ReplayFrame) error {
			order = append(order, "frame")
			frames = append(frames, frame)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("WalkReplay() error = %v", err)
	}

	if !reflect.DeepEqual(order, []string{"meta", "frame", "frame"}) {
		t.Fatalf("WalkReplay() order = %v, want meta before frames", order)
	}
	if meta.Type != "meta" {
		t.Fatalf("WalkReplay() meta.Type = %q, want meta", meta.Type)
	}
	if meta.FrameIntervalMS != 500 {
		t.Fatalf("WalkReplay() meta.FrameIntervalMS = %d, want 500", meta.FrameIntervalMS)
	}
	if meta.TrackMap == nil || meta.TrackMap.MinX != 1 || meta.TrackMap.MaxX != 2 {
		t.Fatalf("WalkReplay() meta.TrackMap = %#v, want populated track map", meta.TrackMap)
	}
	if len(frames) != 2 {
		t.Fatalf("WalkReplay() frame count = %d, want 2", len(frames))
	}
	if frames[0].Timestamp != 1000 || frames[1].Timestamp != 1500 {
		t.Fatalf("WalkReplay() frame timestamps = [%d %d], want [1000 1500]", frames[0].Timestamp, frames[1].Timestamp)
	}
}
