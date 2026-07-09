package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// makePacket builds one length-prefixed packet for scan tests. format@0:2, packetID@6,
// sessionTime(float32 LE)@15:19; Session packets also set sessionType@35, trackId@36.
func makePacket(pktLen int, format uint16, packetID byte, sessionTime float32, sessionType byte, trackID int8) []byte {
	payload := make([]byte, pktLen)
	binary.LittleEndian.PutUint16(payload[0:2], format)
	payload[6] = packetID
	binary.LittleEndian.PutUint32(payload[15:19], math.Float32bits(sessionTime))
	if packetID == PacketIDSession && pktLen > 36 {
		payload[35] = sessionType
		payload[36] = byte(trackID)
	}
	out := make([]byte, 4+pktLen)
	binary.LittleEndian.PutUint32(out[0:4], uint32(pktLen))
	copy(out[4:], payload)
	return out
}

func TestScanRecordingMeta(t *testing.T) {
	var buf bytes.Buffer
	// Session 패킷: format 2025, type 15(Race), wire trackId 12 → Japan, sessionTime 100.
	buf.Write(makePacket(50, 2025, PacketIDSession, 100.0, 15, 12))
	buf.Write(makePacket(30, 2025, PacketIDMotion, 130.0, 0, 0))
	buf.Write(makePacket(30, 2025, PacketIDMotion, 220.5, 0, 0))

	m := scanRecordingMeta(&buf) // bytes.Buffer는 non-seeker → CopyN fallback 경로
	if m.sessionType != "Race" {
		t.Fatalf("sessionType = %q, want Race", m.sessionType)
	}
	if m.trackName != "Japan" {
		t.Fatalf("trackName = %q, want Japan", m.trackName)
	}
	if !m.hasDur {
		t.Fatalf("hasDur = false, want true")
	}
	if d := float64(m.durSec); d < 120.4 || d > 120.6 { // span = 220.5 - 100
		t.Fatalf("durSec = %f, want ~120.5", d)
	}
}

func TestScanRecordingMetaEdgeCases(t *testing.T) {
	// 전 패킷 sessionTime 0(세션 클럭 미시작) → 길이 미상(hasDur=false).
	var allZero bytes.Buffer
	allZero.Write(makePacket(50, 2025, PacketIDSession, 0, 15, 12))
	allZero.Write(makePacket(30, 2025, PacketIDMotion, 0, 0, 0))
	if m := scanRecordingMeta(&allZero); m.hasDur {
		t.Fatalf("all-zero sessionTime: hasDur = true, want false (→ --:--)")
	}

	// 미상 트랙 id(mapping 없음) → trackName "" → 표시에서 생략(세션 타입은 여전히 추출).
	var unknownTrack bytes.Buffer
	unknownTrack.Write(makePacket(50, 2025, PacketIDSession, 5, 15, 99)) // 99 = unmapped
	unknownTrack.Write(makePacket(30, 2025, PacketIDMotion, 40, 0, 0))
	m := scanRecordingMeta(&unknownTrack)
	if m.trackName != "" {
		t.Fatalf("unknown track: trackName = %q, want empty", m.trackName)
	}
	if m.sessionType != "Race" {
		t.Fatalf("unknown track: sessionType = %q, want Race", m.sessionType)
	}
	if got := formatRecordingRow("rec", m, "50.0MB"); got != "rec | Race | 0:35 | 50.0MB" {
		t.Fatalf("row = %q, want 'rec | Race | 0:35 | 50.0MB' (track omitted)", got)
	}
}

func TestMetaAccumMultiFileSpan(t *testing.T) {
	// test-sets main+tail 병합처럼 두 스트림에 걸쳐 global sessionTime span을 누적.
	var main, tail bytes.Buffer
	main.Write(makePacket(50, 2025, PacketIDSession, 10.0, 6, 12)) // type 6 = Q2
	main.Write(makePacket(30, 2025, PacketIDMotion, 60.0, 0, 0))
	tail.Write(makePacket(30, 2025, PacketIDMotion, 300.0, 0, 0))

	var a metaAccum
	a.scan(&main)
	a.scan(&tail)
	got := a.result()
	if got.sessionType != "Q2" {
		t.Fatalf("sessionType = %q, want Q2", got.sessionType)
	}
	if d := float64(got.durSec); d < 289.9 || d > 290.1 { // global span = 300 - 10
		t.Fatalf("durSec = %f, want ~290", d)
	}
}

func TestFormatDurationAndRow(t *testing.T) {
	if got := formatDuration(recordingMeta{}); got != "--:--" {
		t.Fatalf("unknown dur = %q, want --:--", got)
	}
	if got := formatDuration(recordingMeta{durSec: 125, hasDur: true}); got != "2:05" {
		t.Fatalf("dur = %q, want 2:05", got)
	}
	if got := formatDuration(recordingMeta{durSec: 3725, hasDur: true}); got != "1:02:05" {
		t.Fatalf("dur = %q, want 1:02:05", got)
	}
	// 알려진 필드는 표기, 미상은 생략.
	row := formatRecordingRow("race-clean-start", recordingMeta{sessionType: "Race", trackName: "Bahrain", durSec: 361, hasDur: true}, "360.8MB")
	if row != "race-clean-start | Race | Bahrain | 6:01 | 360.8MB" {
		t.Fatalf("row = %q", row)
	}
	bare := formatRecordingRow("rec", recordingMeta{}, "40.0MB")
	if bare != "rec | --:-- | 40.0MB" {
		t.Fatalf("bare row = %q", bare)
	}
}

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
