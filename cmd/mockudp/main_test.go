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

func TestCollectTestSetScenariosMergesCaptures(t *testing.T) {
	tmp := t.TempDir()

	write := func(rel string, content string) {
		p := filepath.Join(tmp, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", rel, err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}

	// scenario-a: main + tail (tail 이름이 더 커서 정렬 시 main 먼저) + raw.bin 없는 캡처
	write("scenario-a/100_20260101_100000/raw.bin", "MAIN")
	write("scenario-a/100_20260101_110000/raw.bin", "TAIL")
	if err := os.MkdirAll(filepath.Join(tmp, "scenario-a", "100_20260101_120000"), 0o755); err != nil {
		t.Fatalf("mkdir norawbin: %v", err)
	}
	// scenario-empty: raw.bin 전무 → 스킵
	if err := os.MkdirAll(filepath.Join(tmp, "scenario-empty", "000_x"), 0o755); err != nil {
		t.Fatalf("mkdir empty: %v", err)
	}
	// 디렉토리가 아닌 항목 → 스킵
	write("notadir.txt", "x")

	seen := make(map[string]struct{})
	entries := collectTestSetScenarios([]string{filepath.Join(tmp)}, seen)

	if len(entries) != 1 {
		t.Fatalf("len(entries) = %d, want 1 (scenario-a only)", len(entries))
	}
	e := entries[0]
	if e.name != "scenario-a" {
		t.Fatalf("name = %q, want scenario-a", e.name)
	}
	if e.size != int64(len("MAIN")+len("TAIL")) {
		t.Fatalf("size = %d, want %d", e.size, len("MAIN")+len("TAIL"))
	}
	if len(e.paths) != 2 {
		t.Fatalf("len(paths) = %d, want 2", len(e.paths))
	}
	data, err := e.loadData()
	if err != nil {
		t.Fatalf("loadData: %v", err)
	}
	if string(data) != "MAINTAIL" {
		t.Fatalf("loadData = %q, want MAINTAIL (main→tail 순서)", string(data))
	}

	// 동일 seen 맵으로 같은 이름 시나리오가 다른 루트에 있어도 중복 추가되지 않음
	dup := collectTestSetScenarios([]string{filepath.Join(tmp)}, seen)
	if len(dup) != 0 {
		t.Fatalf("dedup 실패: 두 번째 스캔에서 %d개 반환", len(dup))
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
