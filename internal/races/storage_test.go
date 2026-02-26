package races

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
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
