package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPaginateRecordings(t *testing.T) {
	entries := make([]recordingEntry, 25)
	for i := range entries {
		entries[i] = recordingEntry{name: "rec"}
	}

	pageItems, page, totalPages := paginateRecordings(entries, 2, 10)
	if page != 2 {
		t.Fatalf("page = %d, want 2", page)
	}
	if totalPages != 3 {
		t.Fatalf("totalPages = %d, want 3", totalPages)
	}
	if len(pageItems) != 5 {
		t.Fatalf("len(pageItems) = %d, want 5", len(pageItems))
	}
}

func TestCleanupSmallRecordingsRemovesSmallFiles(t *testing.T) {
	tmp := t.TempDir()

	recordingsRoot := filepath.Join(tmp, "recordings")
	packetRoot := filepath.Join(tmp, "data", "packets")
	if err := os.MkdirAll(recordingsRoot, 0o755); err != nil {
		t.Fatalf("mkdir recordings: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(packetRoot, "small"), 0o755); err != nil {
		t.Fatalf("mkdir packets/small: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(packetRoot, "large"), 0o755); err != nil {
		t.Fatalf("mkdir packets/large: %v", err)
	}

	smallRecording := filepath.Join(recordingsRoot, "small.bin")
	largeRecording := filepath.Join(recordingsRoot, "large.bin")
	smallPacket := filepath.Join(packetRoot, "small", "raw.bin")
	largePacket := filepath.Join(packetRoot, "large", "raw.bin")

	if err := os.WriteFile(smallRecording, make([]byte, 10), 0o644); err != nil {
		t.Fatalf("write small recording: %v", err)
	}
	if err := os.WriteFile(largeRecording, make([]byte, 40), 0o644); err != nil {
		t.Fatalf("write large recording: %v", err)
	}
	if err := os.WriteFile(smallPacket, make([]byte, 10), 0o644); err != nil {
		t.Fatalf("write small packet: %v", err)
	}
	if err := os.WriteFile(largePacket, make([]byte, 40), 0o644); err != nil {
		t.Fatalf("write large packet: %v", err)
	}

	summary := cleanupSmallRecordings([]string{recordingsRoot}, []string{packetRoot}, 30)
	if summary.deletedCount != 2 {
		t.Fatalf("deletedCount = %d, want 2", summary.deletedCount)
	}

	if _, err := os.Stat(smallRecording); !os.IsNotExist(err) {
		t.Fatalf("small recording still exists: %v", err)
	}
	if _, err := os.Stat(smallPacket); !os.IsNotExist(err) {
		t.Fatalf("small packet still exists: %v", err)
	}
	if _, err := os.Stat(largeRecording); err != nil {
		t.Fatalf("large recording missing: %v", err)
	}
	if _, err := os.Stat(largePacket); err != nil {
		t.Fatalf("large packet missing: %v", err)
	}
}
