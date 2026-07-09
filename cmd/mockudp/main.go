package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"math/rand"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
)

//go:embed all:recordings
var embeddedRecordings embed.FS

// Simulates F1 25 UDP telemetry for testing

const (
	PacketIDMotion        = 0
	PacketIDSession       = 1
	PacketIDLapData       = 2
	PacketIDEvent         = 3
	PacketIDParticipants  = 4
	PacketIDCarTelemetry  = 6
	PacketIDCarStatus     = 7
	PacketIDCarTelemetry2 = 16
	MaxCars               = 24 // 배열 용량 (2025 모드는 앞 22대만 사용)
	PacketHeaderSize      = 29
	SessionPacketSize     = 685
	recordingPageSize     = 12
)

// simFormat selects the simulated UDP wire format (2025 = F1 25, 2026 = Season Pack).
var simFormat uint16 = 2025

func simIs2026() bool { return simFormat == 2026 }

// simSpec returns the wire layout for the selected format — 파서와 같은
// packets.FormatSpec을 공유해 크기 테이블 이중 유지보수를 피한다.
func simSpec() packets.FormatSpec {
	spec, ok := packets.SpecFor(simFormat)
	if !ok {
		spec, _ = packets.SpecFor(packets.PacketFormat2025)
	}
	return spec
}

func simNumCars() int          { return simSpec().NumCars }
func simParticipantSize() int  { return simSpec().ParticipantSize }
func simCarStatusSize() int    { return simSpec().CarStatusSize }
func simCarTelemetrySize() int { return simSpec().CarTelemetrySize }
func simCarMotionSize() int    { return simSpec().CarMotionSize }

// simWireTrackID maps the app-canonical track id onto the simulated wire enum
// (파서의 CanonicalTrackID와 같은 테이블을 역방향으로 사용).
func simWireTrackID(canonical uint8) uint8 {
	return uint8(packets.WireTrackID(simFormat, int8(canonical)))
}

var mockudpVersion = "v3.30.0"

func main() {
	addr := flag.String("addr", "127.0.0.1:20777", "UDP target address")
	hz := flag.Int("hz", 60, "Packets per second")
	laps := flag.Int("laps", 3, "Number of laps to simulate")
	replay := flag.String("replay", "", "Path to raw.bin file to replay (skip menu)")
	speed := flag.Float64("speed", 1.0, "Replay speed multiplier")
	loopFlag := flag.Bool("loop", false, "Loop replay continuously")
	record := flag.String("record", "", "Record simulation to raw.bin file")
	format := flag.Int("format", 2025, "UDP packet format: 2025 (F1 25) or 2026 (Season Pack)")
	flag.Parse()

	switch *format {
	case 2025, 2026:
		simFormat = uint16(*format)
	default:
		log.Fatalf("unsupported -format %d (use 2025 or 2026)", *format)
	}

	conn, err := net.Dial("udp", *addr)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	// Direct replay mode (no menu)
	if *replay != "" {
		data, err := os.ReadFile(*replay)
		if err != nil {
			log.Fatalf("Failed to read %s: %v", *replay, err)
		}
		ctx, cancel := interruptContext()
		runReplayFromBytes(ctx, conn, filepath.Base(*replay), data, *speed, *loopFlag)
		cancel()
		return
	}

	// Direct record mode
	if *record != "" {
		runSimulationWithRecord(conn, *record, *laps, *hz)
		return
	}

	// Interactive menu
	runInteractiveMenu(conn, *addr, *hz, *laps, *speed, *loopFlag)
}

func runInteractiveMenu(conn net.Conn, addr string, hz, laps int, speed float64, loop bool) {
	scanner := bufio.NewScanner(os.Stdin)
	page := 0

	for {
		// Collect available recordings
		recordings, cleanup := listRecordings()
		pageItems, currentPage, totalPages := paginateRecordings(recordings, page, recordingPageSize)
		page = currentPage

		fmt.Println()
		fmt.Println("╔══════════════════════════════════════════╗")
		fmt.Printf("║    FRC Mock UDP Sender %-18s║\n", mockudpVersion)
		fmt.Printf("║       Target: %-26s ║\n", addr)
		fmt.Println("╚══════════════════════════════════════════╝")
		fmt.Println("  1. Simulate (synthetic data)")
		if len(pageItems) > 0 {
			fmt.Println("     ── name | session | track | length | size ──")
		}

		// 보이는 페이지 항목만 meta()로 스캔(캐시됨) — race/track/length/size 표시.
		for i, rec := range pageItems {
			size := fmt.Sprintf("%.1fMB", float64(rec.size)/(1024*1024))
			fmt.Printf("  %d. %s\n", i+2, formatRecordingRow(rec.name, rec.meta(), size))
		}

		fmt.Printf("  S. Speed (current: %.1fx)\n", speed)
		fmt.Printf("  L. Loop  (current: %v)\n", loop)
		fmt.Println("  0. Exit")

		if cleanup.deletedCount > 0 {
			fmt.Printf("Cleaned %d recordings under 30MB (%.1f MB freed)\n", cleanup.deletedCount, float64(cleanup.deletedBytes)/(1024*1024))
		}
		if totalPages > 1 {
			fmt.Printf("Page %d/%d | showing %d recordings on this page\n", currentPage+1, totalPages, len(pageItems))
			if currentPage+1 < totalPages {
				fmt.Println("N. Next page")
			}
			if currentPage > 0 {
				fmt.Println("P. Previous page")
			}
		}
		fmt.Print("Select: ")

		if !scanner.Scan() {
			return
		}
		choice := strings.TrimSpace(strings.ToLower(scanner.Text()))

		if choice == "0" {
			fmt.Println("Bye!")
			return
		}

		if choice == "n" {
			if currentPage+1 < totalPages {
				page = currentPage + 1
			} else {
				fmt.Println("Already on the last page.")
			}
			continue
		}

		if choice == "p" {
			if currentPage > 0 {
				page = currentPage - 1
			} else {
				fmt.Println("Already on the first page.")
			}
			continue
		}

		if choice == "s" {
			fmt.Printf("Speed (current: %.1fx): ", speed)
			if scanner.Scan() {
				var v float64
				if _, err := fmt.Sscanf(strings.TrimSpace(scanner.Text()), "%f", &v); err == nil && v > 0 {
					speed = v
					fmt.Printf("Speed set to %.1fx\n", speed)
				} else {
					fmt.Println("Invalid speed.")
				}
			}
			continue
		}

		if choice == "l" {
			loop = !loop
			fmt.Printf("Loop: %v\n", loop)
			continue
		}

		if choice == "1" {
			fmt.Printf("Simulating %d laps at %d Hz... (Ctrl+C to stop)\n", laps, hz)
			ctx, cancel := interruptContext()
			runSimulation(ctx, conn, laps, hz)
			cancel()
			continue
		}

		idx := 0
		if _, err := fmt.Sscanf(choice, "%d", &idx); err != nil || idx < 2 || idx > len(pageItems)+1 {
			fmt.Println("Invalid selection.")
			continue
		}

		rec := pageItems[idx-2]
		fmt.Printf("Loading replay: %s\n", rec.name)
		data, err := rec.loadData()
		if err != nil {
			fmt.Printf("Failed to load %s: %v\n", rec.name, err)
			continue
		}
		fmt.Printf("Replaying: %s (%.1f MB) at %.1fx (Ctrl+C to stop)\n", rec.name, float64(rec.size)/(1024*1024), speed)
		ctx, cancel := interruptContext()
		runReplayFromBytes(ctx, conn, rec.name, data, speed, loop)
		cancel()
	}
}

type recordingEntry struct {
	name         string
	size         int64
	path         string
	embeddedPath string
	paths        []string // 여러 raw.bin을 순서대로 이어붙여 재생 (test-sets 시나리오 병합용)
}

const minRecordingSize = 30 * 1024 * 1024 // 30 MB

type cleanupSummary struct {
	deletedCount int
	deletedBytes int64
}

func (r recordingEntry) loadData() ([]byte, error) {
	if len(r.paths) > 0 {
		// size 합계로 미리 할당해 재할당을 피한다.
		buf := make([]byte, 0, r.size)
		for _, p := range r.paths {
			b, err := os.ReadFile(p)
			if err != nil {
				return nil, fmt.Errorf("read %s: %w", p, err)
			}
			buf = append(buf, b...)
		}
		return buf, nil
	}
	if r.path != "" {
		return os.ReadFile(r.path)
	}
	if r.embeddedPath != "" {
		return embeddedRecordings.ReadFile(r.embeddedPath)
	}
	return nil, fmt.Errorf("recording %q has no readable source", r.name)
}

func listRecordings() ([]recordingEntry, cleanupSummary) {
	var entries []recordingEntry
	seen := make(map[string]struct{})
	cleanup := cleanupSmallRecordings(
		[]string{"recordings", filepath.Join("cmd", "mockudp", "recordings")},
		[]string{"data/packets", "../data/packets"},
		minRecordingSize,
	)

	for _, root := range []string{"recordings", filepath.Join("cmd", "mockudp", "recordings")} {
		entries = append(entries, collectDiskRecordings(root, seen)...)
	}

	fs.WalkDir(embeddedRecordings, "recordings", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".bin") {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() <= minRecordingSize {
			return nil
		}
		name := strings.TrimPrefix(path, "recordings/")
		name = strings.TrimSuffix(name, ".bin")
		if _, ok := seen[name]; ok {
			return nil
		}
		seen[name] = struct{}{}
		entries = append(entries, recordingEntry{
			name:         name,
			size:         info.Size(),
			embeddedPath: path,
		})
		return nil
	})

	for _, base := range []string{"data/packets", "../data/packets"} {
		dirs, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			rawPath := filepath.Join(base, d.Name(), "raw.bin")
			info, err := os.Stat(rawPath)
			if err != nil || info.Size() <= minRecordingSize {
				continue
			}
			name := d.Name()
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			entries = append(entries, recordingEntry{
				name: name,
				size: info.Size(),
				path: rawPath,
			})
		}
	}

	// test-sets/ 큐레이션 시나리오 (각 시나리오의 캡처들을 병합한 단일 항목).
	// cleanupSmallRecordings 루트에는 test-sets를 넣지 않으므로 tail이 삭제되지 않는다.
	entries = append(entries, collectTestSetScenarios([]string{"test-sets", "../test-sets", "../../test-sets"}, seen)...)

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].size == entries[j].size {
			return entries[i].name < entries[j].name
		}
		return entries[i].size > entries[j].size
	})
	return entries, cleanup
}

// collectTestSetScenarios surfaces the curated test-sets/ captures as merged replay entries.
// 레이아웃: test-sets/<scenario>/<capture>/raw.bin — 한 시나리오의 캡처들(main + tail)을
// 이름 오름차순(=시간순)으로 이어붙여 tail 전용 SEND/최종순위 패킷까지 포함시킨다.
// 30MB 필터는 건너뛴다(tail은 설계상 작음). [Assumption] 시나리오 디렉토리 1개 = 한 세션의 캡처들.
func collectTestSetScenarios(roots []string, seen map[string]struct{}) []recordingEntry {
	var entries []recordingEntry
	for _, root := range roots {
		scenarios, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, s := range scenarios {
			if !s.IsDir() {
				continue
			}
			key := "testset::" + s.Name() // 일반 recording 이름과 충돌하지 않도록 네임스페이스
			if _, ok := seen[key]; ok {
				continue
			}
			scenarioDir := filepath.Join(root, s.Name())
			captures, err := os.ReadDir(scenarioDir)
			if err != nil {
				continue
			}
			names := make([]string, 0, len(captures))
			for _, c := range captures {
				if c.IsDir() {
					names = append(names, c.Name())
				}
			}
			sort.Strings(names) // 캡처 dir명 오름차순 = 시간순 (main 먼저, tail 나중)

			var paths []string
			var total int64
			for _, n := range names {
				rawPath := filepath.Join(scenarioDir, n, "raw.bin")
				info, err := os.Stat(rawPath)
				if err != nil {
					continue // raw.bin 없는 캡처는 관대하게 건너뜀
				}
				paths = append(paths, rawPath)
				total += info.Size()
			}
			if len(paths) == 0 {
				continue // 재생 가능한 캡처가 없는 시나리오는 스킵
			}
			seen[key] = struct{}{}
			entries = append(entries, recordingEntry{
				name:  s.Name(), // 시나리오명 (메뉴 표시 라벨 + meta 앞에 노출)
				size:  total,
				paths: paths,
			})
		}
	}
	return entries
}

func collectDiskRecordings(root string, seen map[string]struct{}) []recordingEntry {
	var entries []recordingEntry
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(path), ".bin") {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() <= minRecordingSize {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		name := strings.TrimSuffix(filepath.ToSlash(rel), ".bin")
		if _, ok := seen[name]; ok {
			return nil
		}
		seen[name] = struct{}{}
		entries = append(entries, recordingEntry{
			name: name,
			size: info.Size(),
			path: path,
		})
		return nil
	})
	return entries
}

func cleanupSmallRecordings(recordingRoots, packetRoots []string, maxSize int64) cleanupSummary {
	var summary cleanupSummary
	seenPaths := make(map[string]struct{})

	removeFile := func(path string, size int64) {
		resolved, err := filepath.Abs(path)
		if err == nil {
			if _, ok := seenPaths[resolved]; ok {
				return
			}
			seenPaths[resolved] = struct{}{}
		}
		if err := os.Remove(path); err == nil {
			summary.deletedCount++
			summary.deletedBytes += size
		}
	}

	for _, root := range recordingRoots {
		filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(path), ".bin") {
				return nil
			}
			info, err := d.Info()
			if err != nil || info.Size() > maxSize {
				return nil
			}
			removeFile(path, info.Size())
			return nil
		})
	}

	for _, base := range packetRoots {
		dirs, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			rawPath := filepath.Join(base, d.Name(), "raw.bin")
			info, err := os.Stat(rawPath)
			if err != nil || info.Size() > maxSize {
				continue
			}
			removeFile(rawPath, info.Size())
			_ = os.Remove(filepath.Dir(rawPath))
		}
	}

	return summary
}

func paginateRecordings(entries []recordingEntry, page, pageSize int) ([]recordingEntry, int, int) {
	if pageSize <= 0 {
		pageSize = recordingPageSize
	}
	totalPages := 1
	if len(entries) > 0 {
		totalPages = (len(entries) + pageSize - 1) / pageSize
	}
	if page < 0 {
		page = 0
	}
	if page >= totalPages {
		page = totalPages - 1
	}
	start := page * pageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := start + pageSize
	if end > len(entries) {
		end = len(entries)
	}
	return entries[start:end], page, totalPages
}

// recordingMeta는 메뉴에서 레코딩을 미리 식별하기 위한 스캔 결과다.
type recordingMeta struct {
	sessionType string  // "Race"/"Q3"/… (미상 "?")
	trackName   string  // 트랙 표시명 (미상 "")
	durSec      float32 // 캡처된 sessionTime span(초)
	hasDur      bool
}

// recordingMetaCache는 fingerprint(경로|크기|수정시각)별 메타를 프로세스 수명 동안 캐시한다.
// listRecordings가 메뉴 redraw마다 호출되므로, 캐시가 없으면 매 redraw 전량 재스캔이 된다.
// 메뉴는 단일 goroutine이라 별도 동기화는 불필요.
var recordingMetaCache = map[string]recordingMeta{}

// metaAccum은 여러 파일(test-sets 병합)에 걸쳐 세션 타입/트랙/sessionTime span을 누적한다.
type metaAccum struct {
	sessionType string
	trackName   string
	haveType    bool
	minT, maxT  float32
	haveSpan    bool
}

func isPlausibleSessionTime(t float32) bool {
	f := float64(t)
	return !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 && f < 100000
}

// scan은 길이 프리픽스 스트림을 1회 통과하며 sessionTime span과 (첫 Session 패킷의)
// 세션 타입/트랙을 누적한다. payload는 io.Seeker면 Seek로, 아니면 discard-copy로 건너뛴다.
func (a *metaAccum) scan(r io.Reader) {
	seeker, canSeek := r.(io.Seeker)
	var (
		lenBuf [4]byte
		head   [42]byte // sessionTime@15:19, Session 필드@32..41 커버
	)
	for {
		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			break
		}
		pktLen := binary.LittleEndian.Uint32(lenBuf[:])
		if pktLen == 0 || pktLen > 65535 {
			break
		}
		n := int(pktLen)
		if n > len(head) {
			n = len(head)
		}
		if _, err := io.ReadFull(r, head[:n]); err != nil {
			break
		}
		// sessionTime(float32 LE @15) — 모든 패킷 헤더에 존재.
		if n >= 19 {
			t := math.Float32frombits(binary.LittleEndian.Uint32(head[15:19]))
			if isPlausibleSessionTime(t) {
				if !a.haveSpan || t < a.minT {
					a.minT = t
				}
				if !a.haveSpan || t > a.maxT {
					a.maxT = t
				}
				a.haveSpan = true
			}
		}
		// 첫 Session 패킷(PacketID@6 == 1) → 세션 타입 + 트랙.
		if !a.haveType && n > 36 && head[6] == PacketIDSession {
			a.sessionType = sessionTypeLabel(head[35]) // sessionTypeOffset = 29+6
			format := binary.LittleEndian.Uint16(head[0:2])
			// 미상 트랙("Unknown")은 빈 값으로 두어 표시에서 생략한다.
			if name := tracks.TrackName(packets.CanonicalTrackID(format, int8(head[36]))); name != "Unknown" {
				a.trackName = name
			}
			a.haveType = true
		}
		if rest := int64(pktLen) - int64(n); rest > 0 {
			if canSeek {
				if _, err := seeker.Seek(rest, io.SeekCurrent); err != nil {
					break
				}
			} else if _, err := io.CopyN(io.Discard, r, rest); err != nil {
				break
			}
		}
	}
}

func (a *metaAccum) result() recordingMeta {
	m := recordingMeta{sessionType: a.sessionType, trackName: a.trackName}
	// 실제 span(maxT > minT)일 때만 길이 확정. 전 패킷 sessionTime이 동일(예: 전부 0,
	// 세션 클럭 미시작)이면 길이 미상("--:--")으로 둔다.
	if a.haveSpan && a.maxT > a.minT {
		m.durSec = a.maxT - a.minT
		m.hasDur = true
	}
	return m
}

// scanRecordingMeta는 단일 리더를 스캔한다(유닛 테스트/단일 소스용).
func scanRecordingMeta(r io.Reader) recordingMeta {
	var a metaAccum
	a.scan(r)
	return a.result()
}

// meta는 fingerprint 캐시를 거쳐 레코딩 메타를 반환한다(보이는 페이지 항목만 lazy 계산).
func (r recordingEntry) meta() recordingMeta {
	key := r.metaKey()
	if m, ok := recordingMetaCache[key]; ok {
		return m
	}
	m := r.computeMeta()
	recordingMetaCache[key] = m
	return m
}

func fingerprint(path string) string {
	if info, err := os.Stat(path); err == nil {
		return fmt.Sprintf("%s|%d:%d", path, info.Size(), info.ModTime().UnixNano())
	}
	return path + "|?"
}

func (r recordingEntry) metaKey() string {
	switch {
	case len(r.paths) > 0:
		parts := make([]string, len(r.paths))
		for i, p := range r.paths {
			parts[i] = fingerprint(p)
		}
		return "paths:" + strings.Join(parts, ";")
	case r.path != "":
		return "path:" + fingerprint(r.path)
	case r.embeddedPath != "":
		return fmt.Sprintf("embed:%s|%d", r.embeddedPath, r.size)
	default:
		return fmt.Sprintf("size:%d", r.size)
	}
}

func (r recordingEntry) computeMeta() recordingMeta {
	var a metaAccum
	switch {
	case len(r.paths) > 0:
		for _, p := range r.paths {
			f, err := os.Open(p)
			if err != nil {
				continue
			}
			a.scan(f)
			f.Close()
		}
	case r.path != "":
		f, err := os.Open(r.path)
		if err != nil {
			return recordingMeta{}
		}
		defer f.Close()
		a.scan(f)
	case r.embeddedPath != "":
		f, err := embeddedRecordings.Open(r.embeddedPath)
		if err != nil {
			return recordingMeta{}
		}
		defer f.Close()
		a.scan(f)
	}
	return a.result()
}

// formatDuration은 캡처 길이를 mm:ss(1시간 이상은 h:mm:ss), 미상은 "--:--"로 표기한다.
func formatDuration(m recordingMeta) string {
	if !m.hasDur {
		return "--:--"
	}
	total := int(m.durSec + 0.5)
	if h := total / 3600; h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, (total%3600)/60, total%60)
	}
	return fmt.Sprintf("%d:%02d", total/60, total%60)
}

func truncateLabel(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	if n <= 1 {
		return string(rs[:n])
	}
	return string(rs[:n-1]) + "…"
}

// formatRecordingRow는 메뉴 한 줄을 "name | type | track | mm:ss | size"로 조립한다.
// 미상(빈/"?") 필드는 생략해 잡음을 줄인다.
func formatRecordingRow(name string, m recordingMeta, size string) string {
	parts := []string{truncateLabel(name, 24)}
	if m.sessionType != "" && m.sessionType != "?" {
		parts = append(parts, m.sessionType)
	}
	if m.trackName != "" {
		parts = append(parts, truncateLabel(m.trackName, 18))
	}
	parts = append(parts, formatDuration(m), size)
	return strings.Join(parts, " | ")
}

func sessionTypeLabel(v byte) string {
	switch v {
	case 1:
		return "P1"
	case 2:
		return "P2"
	case 3:
		return "P3"
	case 4:
		return "Short P"
	case 5:
		return "Q1"
	case 6:
		return "Q2"
	case 7:
		return "Q3"
	case 8:
		return "Short Q"
	case 9:
		return "OSQ"
	case 10:
		return "SS1"
	case 11:
		return "SS2"
	case 12:
		return "SS3"
	case 13:
		return "Short SS"
	case 14:
		return "OSSS"
	case 15:
		return "Race"
	case 16:
		return "Race2"
	case 17:
		return "Race3"
	case 18:
		return "TT"
	default:
		return "?"
	}
}

func runSimulation(ctx context.Context, conn net.Conn, laps, hz int) {
	if hz <= 0 {
		hz = 60
	}
	if laps <= 0 {
		laps = 3
	}
	fmt.Printf("Sending mock F1 25 telemetry at %d Hz\n", hz)

	sim := NewSimulator(laps, hz)
	ticker := time.NewTicker(time.Second / time.Duration(hz))
	defer ticker.Stop()

	frameID := uint32(0)
	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nSimulation interrupted.")
			return
		case <-ticker.C:
		}

		if sim.Done() {
			fmt.Println("\nSimulation complete!")
			return
		}

		if frameID == 0 || frameID%uint32(hz) == 0 {
			send(conn, sim.BuildSessionPacket(frameID))
			send(conn, sim.BuildParticipantsPacket(frameID))
			send(conn, sim.BuildCarStatusPacket(frameID))
		}

		send(conn, sim.BuildMotionPacket(frameID))
		send(conn, sim.BuildTelemetryPacket(frameID))
		if simIs2026() {
			send(conn, sim.BuildCarTelemetry2Packet(frameID))
		}
		send(conn, sim.BuildLapDataPacket(frameID))
		sim.Tick()

		for _, evt := range sim.DrainPendingEvents() {
			send(conn, sim.BuildPenaltyEventPacket(frameID, evt))
		}

		frameID++
		if frameID%uint32(hz) == 0 {
			fmt.Printf("\rLap %d | Distance: %.0fm | Speed: %d km/h | Gear: %d | RPM: %d    ",
				sim.CurrentLap, sim.LapDistance, sim.Speed, sim.Gear, sim.RPM)
		}
	}
}

// runSimulationWithRecord runs simulation and writes packets to a raw.bin file.
func runSimulationWithRecord(conn net.Conn, outPath string, laps, hz int) {
	if hz <= 0 {
		hz = 60
	}
	if laps <= 0 {
		laps = 3
	}

	f, err := os.Create(outPath)
	if err != nil {
		log.Fatalf("Failed to create %s: %v", outPath, err)
	}
	defer f.Close()

	fmt.Printf("Recording simulation to %s (%d laps, %d Hz)\n", outPath, laps, hz)

	sim := NewSimulator(laps, hz)
	ticker := time.NewTicker(time.Second / time.Duration(hz))
	defer ticker.Stop()

	writePacket := func(pkt []byte) {
		// Write to raw.bin (length-prefixed)
		var lenBuf [4]byte
		binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(pkt)))
		f.Write(lenBuf[:])
		f.Write(pkt)
		// Also send via UDP
		send(conn, pkt)
	}

	frameID := uint32(0)
	for range ticker.C {
		if sim.Done() {
			fmt.Printf("\nRecording complete: %s\n", outPath)
			return
		}

		if frameID == 0 || frameID%uint32(hz) == 0 {
			writePacket(sim.BuildSessionPacket(frameID))
			writePacket(sim.BuildParticipantsPacket(frameID))
			writePacket(sim.BuildCarStatusPacket(frameID))
		}

		writePacket(sim.BuildMotionPacket(frameID))
		writePacket(sim.BuildTelemetryPacket(frameID))
		if simIs2026() {
			writePacket(sim.BuildCarTelemetry2Packet(frameID))
		}
		writePacket(sim.BuildLapDataPacket(frameID))
		sim.Tick()

		for _, evt := range sim.DrainPendingEvents() {
			writePacket(sim.BuildPenaltyEventPacket(frameID, evt))
		}

		frameID++
		if frameID%uint32(hz) == 0 {
			fmt.Printf("\rRecording Lap %d | %.0fm | %d km/h    ",
				sim.CurrentLap, sim.LapDistance, sim.Speed)
		}
	}
}

// interruptContext returns a context that is cancelled on SIGINT (Ctrl+C).
// The caller must call the returned cancel function to restore default signal handling.
func interruptContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	go func() {
		select {
		case <-sigCh:
			cancel()
		case <-ctx.Done():
		}
		signal.Stop(sigCh)
	}()
	return ctx, cancel
}

func send(conn net.Conn, pkt []byte) {
	if _, err := conn.Write(pkt); err != nil {
		log.Printf("send failed: %v", err)
	}
}

// runReplayFromBytes replays length-prefixed packets from an in-memory byte slice.
func runReplayFromBytes(ctx context.Context, conn net.Conn, name string, data []byte, speedMul float64, loop bool) {
	if speedMul <= 0 {
		speedMul = 1.0
	}
	for {
		fmt.Printf("Replaying %s (%.1f MB) at %.1fx speed\n", name, float64(len(data))/(1024*1024), speedMul)
		if err := replayFromReader(ctx, conn, bytes.NewReader(data), speedMul); err != nil {
			if ctx.Err() != nil {
				fmt.Println("\nReplay interrupted.")
				return
			}
			log.Printf("Replay error: %v", err)
			return
		}
		if !loop {
			return
		}
		if ctx.Err() != nil {
			return
		}
		fmt.Println("Looping...")
	}
}

func replayFromReader(ctx context.Context, conn net.Conn, r io.Reader, speedMul float64) error {
	var (
		lenBuf      [4]byte
		prevSession float32
		packetCount uint64
		bytesSent   uint64
		startTime   = time.Now()
	)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("read length: %w", err)
		}
		pktLen := binary.LittleEndian.Uint32(lenBuf[:])
		if pktLen == 0 || pktLen > 65535 {
			return fmt.Errorf("invalid packet length: %d", pktLen)
		}

		pkt := make([]byte, pktLen)
		if _, err := io.ReadFull(r, pkt); err != nil {
			return fmt.Errorf("read packet: %w", err)
		}

		// Timing from sessionTime in packet header (float32 LE at offset 15)
		if len(pkt) >= 19 {
			sessionTime := math.Float32frombits(binary.LittleEndian.Uint32(pkt[15:19]))
			if prevSession > 0 && sessionTime > prevSession {
				delay := time.Duration(float64(sessionTime-prevSession) / speedMul * float64(time.Second))
				if delay > 0 && delay < 2*time.Second {
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-time.After(delay):
					}
				}
			}
			prevSession = sessionTime
		}

		send(conn, pkt)
		packetCount++
		bytesSent += uint64(pktLen)

		if packetCount%1000 == 0 {
			elapsed := time.Since(startTime).Seconds()
			fmt.Printf("\r%d packets | %.1f MB | %.0f pkt/s    ",
				packetCount, float64(bytesSent)/(1024*1024), float64(packetCount)/elapsed)
		}
	}

	elapsed := time.Since(startTime).Seconds()
	fmt.Printf("\rDone: %d packets | %.1f MB | %.1fs    \n",
		packetCount, float64(bytesSent)/(1024*1024), elapsed)
	return nil
}

// Simulator simulates a car driving around a track
type Simulator struct {
	SessionUID    uint64
	PlayerCarIdx  uint8
	TotalLaps     int
	CurrentLap    uint8
	LapDistance   float32
	TotalDistance float32
	TrackLength   float32
	TrackID       int8
	TickRate      int

	// Telemetry
	Speed    uint16
	Throttle float32
	Brake    float32
	Steer    float32
	Gear     int8
	RPM      uint16
	DRS      uint8

	// Timing
	CurrentLapTimeMS uint32
	LastLapTimeMS    uint32
	BestLapTimeMS    uint32
	Sector           uint8
	LapInvalid       uint8
	Position         uint8

	// Warning/Penalty simulation
	TotalWarnings         uint8
	CornerCuttingWarnings uint8
	Penalties             uint8 // accumulated penalty seconds
	warningSchedule       []float32
	penaltySchedule       []penaltyEntry
	warningIdx            int
	penaltyIdx            int
	pendingEvents         []penaltyEventData

	// AI car penalty simulation
	aiPenaltyStates   map[int]*aiCarPenaltyState
	aiPenaltyTriggers []aiPenaltyTrigger
	aiTriggerIdx      int

	// AI car state (consistent simulation)
	aiCars [MaxCars]aiCarState

	// Internal
	tickCount    int
	sectorTimes  [3]uint32
	lapStartTime time.Time
}

// aiCarState tracks per-AI-car simulation state for consistent data
type aiCarState struct {
	lapDistance   float32
	totalDistance float32
	speed         uint16
	lapNum        uint8
	position      uint8
	sector        uint8
	lastLapTimeMS uint32
	bestLapTimeMS uint32
	sector1Ms     uint16
	sector2Ms     uint16
	basePace      float32 // base lap time factor (0.95-1.05)
}

// penaltyEntry defines a scheduled penalty trigger
type penaltyEntry struct {
	distance         float32
	penaltyType      uint8
	infringementType uint8
	timePenalty      uint8 // seconds (for time penalty)
}

// penaltyEventData holds data for a PENA event packet
type penaltyEventData struct {
	PenaltyType      uint8
	InfringementType uint8
	VehicleIdx       uint8
	OtherVehicleIdx  uint8
	Time             uint8
	LapNum           uint8
	PlacesGained     uint8
}

// aiCarPenaltyState tracks accumulated penalties/warnings for an AI car
type aiCarPenaltyState struct {
	totalWarnings         uint8
	cornerCuttingWarnings uint8
	penalties             uint8
}

// aiPenaltyTrigger defines a scheduled penalty/warning for an AI car
type aiPenaltyTrigger struct {
	triggerTick      int
	carIdx           uint8
	isWarning        bool // true = warning, false = penalty
	penaltyType      uint8
	infringementType uint8
	timePenalty      uint8 // seconds, only for penalties
}

func NewSimulator(laps int, hz int) *Simulator {
	// Build AI penalty/warning triggers spread across the session.
	// Each lap takes ~25s at simulated speed → total ticks ≈ laps * 25 * hz.
	totalTicks := laps * 25 * hz
	aiTriggers := buildAIPenaltySchedule(totalTicks, hz)

	sim := &Simulator{
		SessionUID:      rand.Uint64(),
		PlayerCarIdx:    0,
		TotalLaps:       laps,
		CurrentLap:      1,
		TrackLength:     5800,
		TrackID:         10, // Monza
		TickRate:        hz,
		Position:        1,
		lapStartTime:    time.Now(),
		warningSchedule: []float32{3000, 7500, 10000},
		penaltySchedule: []penaltyEntry{
			{distance: 10050, penaltyType: 4, infringementType: 7, timePenalty: 5},
		},
		aiPenaltyStates:   make(map[int]*aiCarPenaltyState),
		aiPenaltyTriggers: aiTriggers,
	}

	// Initialize AI cars with staggered positions and varied pace
	for i := 1; i < MaxCars; i++ {
		sim.aiCars[i] = aiCarState{
			lapNum:   1,
			position: uint8(i + 1),
			basePace: 0.96 + rand.Float32()*0.08, // 0.96-1.04x pace variation
		}
	}

	return sim
}

// buildAIPenaltySchedule creates penalty/warning events for AI drivers.
// Spreads warnings and penalties across 5-6 AI cars during the session.
func buildAIPenaltySchedule(totalTicks int, hz int) []aiPenaltyTrigger {
	type eventDef struct {
		carIdx           uint8
		fractionOfRace   float64 // when in the session (0.0-1.0) to trigger
		isWarning        bool
		penaltyType      uint8
		infringementType uint8
		timePenalty      uint8
	}

	events := []eventDef{
		// AI 03 (idx 2): warning early, another warning mid-race
		{carIdx: 2, fractionOfRace: 0.15, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 2, fractionOfRace: 0.55, isWarning: true, penaltyType: 5, infringementType: 7},
		// AI 06 (idx 5): warning then 5s penalty
		{carIdx: 5, fractionOfRace: 0.25, isWarning: true, penaltyType: 5, infringementType: 4},
		{carIdx: 5, fractionOfRace: 0.60, isWarning: false, penaltyType: 4, infringementType: 4, timePenalty: 5},
		// AI 10 (idx 9): 10s penalty mid-race (collision)
		{carIdx: 9, fractionOfRace: 0.40, isWarning: false, penaltyType: 4, infringementType: 0, timePenalty: 10},
		// AI 14 (idx 13): two warnings
		{carIdx: 13, fractionOfRace: 0.30, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 13, fractionOfRace: 0.70, isWarning: true, penaltyType: 5, infringementType: 2},
		// AI 18 (idx 17): warning + 5s penalty late
		{carIdx: 17, fractionOfRace: 0.50, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 17, fractionOfRace: 0.80, isWarning: false, penaltyType: 4, infringementType: 7, timePenalty: 5},
	}

	triggers := make([]aiPenaltyTrigger, 0, len(events))
	for _, e := range events {
		tick := int(float64(totalTicks) * e.fractionOfRace)
		triggers = append(triggers, aiPenaltyTrigger{
			triggerTick:      tick,
			carIdx:           e.carIdx,
			isWarning:        e.isWarning,
			penaltyType:      e.penaltyType,
			infringementType: e.infringementType,
			timePenalty:      e.timePenalty,
		})
	}
	return triggers
}

func (s *Simulator) Done() bool {
	return int(s.CurrentLap) > s.TotalLaps
}

func (s *Simulator) Tick() {
	s.tickCount++

	// Update lap time
	s.CurrentLapTimeMS = uint32(time.Since(s.lapStartTime).Milliseconds())

	// Simulate driving around the track
	progress := s.LapDistance / s.TrackLength

	// Speed varies based on track position (simulate corners and straights)
	baseSpeed := 200.0 + 100.0*math.Sin(float64(progress)*math.Pi*8)
	s.Speed = uint16(baseSpeed + rand.Float64()*10)

	// Throttle/brake based on speed changes
	if baseSpeed > 250 {
		s.Throttle = 0.9 + rand.Float32()*0.1
		s.Brake = 0
		s.DRS = 1
	} else if baseSpeed < 150 {
		s.Throttle = 0.3 + rand.Float32()*0.2
		s.Brake = 0.5 + rand.Float32()*0.3
		s.DRS = 0
	} else {
		s.Throttle = 0.6 + rand.Float32()*0.3
		s.Brake = rand.Float32() * 0.1
		s.DRS = 0
	}

	// Gear based on speed
	switch {
	case s.Speed > 300:
		s.Gear = 8
	case s.Speed > 260:
		s.Gear = 7
	case s.Speed > 220:
		s.Gear = 6
	case s.Speed > 180:
		s.Gear = 5
	case s.Speed > 140:
		s.Gear = 4
	case s.Speed > 100:
		s.Gear = 3
	case s.Speed > 60:
		s.Gear = 2
	default:
		s.Gear = 1
	}

	// RPM based on gear and speed
	s.RPM = uint16(8000 + rand.Intn(4000))

	// Steering
	s.Steer = float32(math.Sin(float64(s.tickCount)*0.1)) * 0.5

	// Update sector
	if progress < 0.33 {
		s.Sector = 0
	} else if progress < 0.66 {
		s.Sector = 1
	} else {
		s.Sector = 2
	}

	// Move forward using the configured tick rate.
	distancePerTick := float32(s.Speed) / 3.6 / float32(s.TickRate)
	s.LapDistance += distancePerTick
	s.TotalDistance += distancePerTick

	// Check warning triggers
	for s.warningIdx < len(s.warningSchedule) && s.TotalDistance >= s.warningSchedule[s.warningIdx] {
		s.TotalWarnings++
		s.CornerCuttingWarnings++
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      5, // Warning
			InfringementType: 7, // Corner cutting gained time
			VehicleIdx:       s.PlayerCarIdx,
			LapNum:           s.CurrentLap,
		})
		fmt.Printf("\n[WARNING %d] Corner cutting warning (total distance: %.0fm, lap %d)\n",
			s.TotalWarnings, s.TotalDistance, s.CurrentLap)
		s.warningIdx++
	}

	// Check penalty triggers
	for s.penaltyIdx < len(s.penaltySchedule) && s.TotalDistance >= s.penaltySchedule[s.penaltyIdx].distance {
		entry := s.penaltySchedule[s.penaltyIdx]
		s.Penalties += entry.timePenalty
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      entry.penaltyType,
			InfringementType: entry.infringementType,
			VehicleIdx:       s.PlayerCarIdx,
			Time:             entry.timePenalty,
			LapNum:           s.CurrentLap,
		})
		fmt.Printf("\n[PENALTY] %ds time penalty for corner cutting (total distance: %.0fm, lap %d)\n",
			entry.timePenalty, s.TotalDistance, s.CurrentLap)
		s.penaltyIdx++
	}

	// Check AI penalty triggers
	for s.aiTriggerIdx < len(s.aiPenaltyTriggers) && s.tickCount >= s.aiPenaltyTriggers[s.aiTriggerIdx].triggerTick {
		t := s.aiPenaltyTriggers[s.aiTriggerIdx]
		state, ok := s.aiPenaltyStates[int(t.carIdx)]
		if !ok {
			state = &aiCarPenaltyState{}
			s.aiPenaltyStates[int(t.carIdx)] = state
		}
		if t.isWarning {
			state.totalWarnings++
			state.cornerCuttingWarnings++
			fmt.Printf("\n[AI %02d WARNING %d] penaltyType=%d infringement=%d (tick %d)\n",
				t.carIdx+1, state.totalWarnings, t.penaltyType, t.infringementType, s.tickCount)
		} else {
			state.penalties += t.timePenalty
			fmt.Printf("\n[AI %02d PENALTY] %ds time penalty, penaltyType=%d infringement=%d (tick %d)\n",
				t.carIdx+1, t.timePenalty, t.penaltyType, t.infringementType, s.tickCount)
		}
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      t.penaltyType,
			InfringementType: t.infringementType,
			VehicleIdx:       t.carIdx,
			Time:             t.timePenalty,
			LapNum:           s.CurrentLap,
		})
		s.aiTriggerIdx++
	}

	// Update AI cars
	for i := 1; i < MaxCars; i++ {
		ai := &s.aiCars[i]
		aiSpeed := float32(180+rand.Intn(80)) * ai.basePace
		ai.speed = uint16(aiSpeed)
		distPerTick := aiSpeed / 3.6 / float32(s.TickRate)
		ai.lapDistance += distPerTick
		ai.totalDistance += distPerTick

		aiProgress := ai.lapDistance / s.TrackLength
		if aiProgress < 0.33 {
			ai.sector = 0
		} else if aiProgress < 0.66 {
			ai.sector = 1
			if ai.sector1Ms == 0 {
				ai.sector1Ms = uint16(25000+rand.Intn(3000)) * uint16(ai.basePace*100) / 100
			}
		} else {
			ai.sector = 2
			if ai.sector2Ms == 0 {
				ai.sector2Ms = uint16(28000+rand.Intn(3000)) * uint16(ai.basePace*100) / 100
			}
		}

		if ai.lapDistance >= s.TrackLength {
			lapTime := uint32(82000+rand.Intn(5000)) * uint32(ai.basePace*100) / 100
			ai.lastLapTimeMS = lapTime
			if ai.bestLapTimeMS == 0 || lapTime < ai.bestLapTimeMS {
				ai.bestLapTimeMS = lapTime
			}
			ai.lapNum++
			ai.lapDistance = 0
			ai.sector1Ms = 0
			ai.sector2Ms = 0
		}
	}

	// Sort AI positions by total distance (descending)
	type carDist struct {
		idx  int
		dist float32
	}
	dists := make([]carDist, 0, MaxCars)
	dists = append(dists, carDist{0, s.TotalDistance})
	for i := 1; i < MaxCars; i++ {
		dists = append(dists, carDist{i, s.aiCars[i].totalDistance})
	}
	sort.Slice(dists, func(a, b int) bool { return dists[a].dist > dists[b].dist })
	for pos, cd := range dists {
		if cd.idx == 0 {
			s.Position = uint8(pos + 1)
		} else {
			s.aiCars[cd.idx].position = uint8(pos + 1)
		}
	}

	// Check for lap completion
	if s.LapDistance >= s.TrackLength {
		s.LastLapTimeMS = s.CurrentLapTimeMS
		if s.BestLapTimeMS == 0 || s.LastLapTimeMS < s.BestLapTimeMS {
			s.BestLapTimeMS = s.LastLapTimeMS
		}
		s.CurrentLap++
		s.LapDistance = 0
		s.lapStartTime = time.Now()
		fmt.Printf("\n[LAP COMPLETE] Lap %d: %s (Best: %s)\n",
			s.CurrentLap-1,
			formatLapTime(s.LastLapTimeMS),
			formatLapTime(s.BestLapTimeMS))
	}
}

func formatLapTime(ms uint32) string {
	minutes := ms / 60000
	seconds := (ms % 60000) / 1000
	millis := ms % 1000
	return fmt.Sprintf("%d:%02d.%03d", minutes, seconds, millis)
}

func (s *Simulator) BuildSessionPacket(frameID uint32) []byte {
	buf := make([]byte, SessionPacketSize)
	s.writeHeader(buf, PacketIDSession, frameID)

	buf[29] = 0 // Weather: clear
	buf[30] = 38
	buf[31] = 24
	buf[32] = uint8(s.TotalLaps)
	binary.LittleEndian.PutUint16(buf[33:35], uint16(s.TrackLength))
	buf[35] = 15 // Race
	buf[36] = simWireTrackID(uint8(s.TrackID))
	buf[47] = 3 // NumMarshalZones
	writeMarshalZone(buf, 48, 0.00, 1)
	writeMarshalZone(buf, 53, 0.33, 1)
	writeMarshalZone(buf, 58, 0.66, 1)
	buf[153] = 0 // No safety car
	buf[155] = 2 // Forecast sample count
	writeForecast(buf, 156, 15, 0, 0, 38, 0, 24, 0, 0)
	writeForecast(buf, 164, 15, 5, 1, 39, 1, 25, 1, 5)

	idealLap := s.TotalLaps / 2
	if idealLap < 1 {
		idealLap = 1
	}
	latestLap := idealLap + 3
	if latestLap > s.TotalLaps {
		latestLap = s.TotalLaps
	}
	buf[682] = uint8(idealLap)
	buf[683] = uint8(latestLap)
	buf[684] = 1

	return buf
}

func (s *Simulator) BuildTelemetryPacket(frameID uint32) []byte {
	numCars := simNumCars()
	carSize := simCarTelemetrySize()
	packetSize := PacketHeaderSize + (numCars * carSize) + 3
	buf := make([]byte, packetSize)

	// Write header
	s.writeHeader(buf, PacketIDCarTelemetry, frameID)

	// Write car telemetry data for all cars
	offset := PacketHeaderSize
	for i := 0; i < numCars; i++ {
		s.writeCarTelemetry(buf[offset:], i == int(s.PlayerCarIdx), i)
		offset += carSize
	}

	// MFD panel index, secondary, suggested gear
	buf[offset] = 0
	buf[offset+1] = 255
	buf[offset+2] = byte(s.Gear)

	return buf
}

// BuildCarTelemetry2Packet builds the 2026-only Car Telemetry 2 packet (ID 16).
func (s *Simulator) BuildCarTelemetry2Packet(frameID uint32) []byte {
	numCars := simNumCars()
	buf := make([]byte, PacketHeaderSize+(numCars*10))
	s.writeHeader(buf, PacketIDCarTelemetry2, frameID)

	offset := PacketHeaderSize
	for i := 0; i < numCars; i++ {
		isPlayer := i == int(s.PlayerCarIdx)
		speed := s.Speed
		if !isPlayer && i < len(s.aiCars) {
			speed = s.aiCars[i].speed
		}
		straight := speed > 250 // 고속 직선 = X-mode
		overtakeActive := uint8(0)
		if isPlayer && s.DRS == 1 {
			// 플레이어 DRS 토글 시뮬레이션을 Overtake로 재활용
			overtakeActive = 1
		}
		buf[offset] = boolByte(straight) // ActiveAeroMode: 1=straight(X)
		buf[offset+1] = 1                // ActiveAeroAvailable
		binary.LittleEndian.PutUint16(buf[offset+2:], 120) // ActiveAeroActivationDistance
		buf[offset+4] = 1 // OvertakeAvailable
		buf[offset+5] = overtakeActive
		binary.LittleEndian.PutUint16(buf[offset+6:], 80) // OvertakeActivationDistance
		buf[offset+8] = 1                                 // Regulations2026
		buf[offset+9] = 0                                 // DrivingWrongWay
		offset += 10
	}

	return buf
}

func boolByte(b bool) uint8 {
	if b {
		return 1
	}
	return 0
}

func (s *Simulator) BuildMotionPacket(frameID uint32) []byte {
	numCars := simNumCars()
	carSize := simCarMotionSize()
	packetSize := PacketHeaderSize + (numCars * carSize)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDMotion, frameID)

	offset := PacketHeaderSize
	for i := 0; i < numCars; i++ {
		s.writeMotionData(buf[offset:], i)
		offset += carSize
	}

	return buf
}

func (s *Simulator) BuildLapDataPacket(frameID uint32) []byte {
	numCars := simNumCars()
	packetSize := PacketHeaderSize + (numCars * 57) + 2
	buf := make([]byte, packetSize)

	// Write header
	s.writeHeader(buf, PacketIDLapData, frameID)

	// Write lap data for all cars
	offset := PacketHeaderSize
	for i := 0; i < numCars; i++ {
		s.writeLapData(buf[offset:], i == int(s.PlayerCarIdx), i)
		offset += 57
	}

	// Time trial indices
	buf[offset] = 255
	buf[offset+1] = 255

	return buf
}

func (s *Simulator) BuildParticipantsPacket(frameID uint32) []byte {
	numCars := simNumCars()
	carSize := simParticipantSize()
	packetSize := PacketHeaderSize + 1 + (numCars * carSize)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDParticipants, frameID)
	buf[PacketHeaderSize] = uint8(numCars)

	offset := PacketHeaderSize + 1
	for i := 0; i < numCars; i++ {
		s.writeParticipantData(buf[offset:], i)
		offset += carSize
	}

	return buf
}

func (s *Simulator) BuildCarStatusPacket(frameID uint32) []byte {
	numCars := simNumCars()
	carSize := simCarStatusSize()
	packetSize := PacketHeaderSize + (numCars * carSize)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDCarStatus, frameID)

	offset := PacketHeaderSize
	for i := 0; i < numCars; i++ {
		s.writeCarStatus(buf[offset:], i == int(s.PlayerCarIdx), i)
		offset += carSize
	}

	return buf
}

// DrainPendingEvents returns and clears any pending warning/penalty events
func (s *Simulator) DrainPendingEvents() []penaltyEventData {
	events := s.pendingEvents
	s.pendingEvents = nil
	return events
}

// BuildPenaltyEventPacket builds a PENA event packet
func (s *Simulator) BuildPenaltyEventPacket(frameID uint32, evt penaltyEventData) []byte {
	// Header(29) + EventCode(4) + PenaltyEvent(7) = 40 bytes
	buf := make([]byte, 40)
	s.writeHeader(buf, PacketIDEvent, frameID)

	// Event code "PENA"
	copy(buf[29:33], "PENA")

	// PenaltyEvent data
	buf[33] = evt.PenaltyType
	buf[34] = evt.InfringementType
	buf[35] = evt.VehicleIdx
	buf[36] = evt.OtherVehicleIdx
	buf[37] = evt.Time
	buf[38] = evt.LapNum
	buf[39] = evt.PlacesGained

	return buf
}

func (s *Simulator) writeHeader(buf []byte, packetID uint8, frameID uint32) {
	binary.LittleEndian.PutUint16(buf[0:2], simFormat) // PacketFormat
	gameYear := uint8(25)
	if simIs2026() {
		gameYear = 26
	}
	buf[2] = gameYear // GameYear
	buf[3] = 1                                    // GameMajorVersion
	buf[4] = 0                                    // GameMinorVersion
	buf[5] = 1                                    // PacketVersion
	buf[6] = packetID                             // PacketID
	binary.LittleEndian.PutUint64(buf[7:15], s.SessionUID)
	binary.LittleEndian.PutUint32(buf[15:19], math.Float32bits(float32(s.tickCount)/float32(s.TickRate)))
	binary.LittleEndian.PutUint32(buf[19:23], frameID)
	binary.LittleEndian.PutUint32(buf[23:27], frameID)
	buf[27] = s.PlayerCarIdx
	buf[28] = 255 // No secondary player
}

func (s *Simulator) writeCarTelemetry(buf []byte, isPlayer bool, carIdx int) {
	offset := 0

	var speed uint16
	var throttle, brake, steer float32
	var gear int8
	var rpm uint16
	var drs uint8

	if isPlayer {
		speed = s.Speed
		throttle = s.Throttle
		brake = s.Brake
		steer = s.Steer
		gear = s.Gear
		rpm = s.RPM
		drs = s.DRS
	} else {
		// Other cars - use tracked AI state
		speed = s.aiCars[0].speed // placeholder; actual speed set below
		if carIdx > 0 && carIdx < MaxCars {
			speed = s.aiCars[carIdx].speed
		}
		if speed == 0 {
			speed = 200
		}
		throttle = 0.7 + rand.Float32()*0.3
		brake = 0
		if speed < 160 {
			brake = 0.3 + rand.Float32()*0.4
			throttle = 0.2
		}
		steer = (rand.Float32() - 0.5) * 0.5
		switch {
		case speed > 260:
			gear = 8
		case speed > 220:
			gear = 7
		case speed > 180:
			gear = 6
		case speed > 140:
			gear = 5
		default:
			gear = 4
		}
		rpm = uint16(8000 + rand.Intn(4000))
		drs = 0
	}

	binary.LittleEndian.PutUint16(buf[offset:], speed)
	offset += 2
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(throttle))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(steer))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(brake))
	offset += 4
	buf[offset] = 0 // Clutch
	offset++
	buf[offset] = byte(gear)
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], rpm)
	offset += 2
	buf[offset] = drs
	offset++
	buf[offset] = uint8(float32(rpm-8000) / 4000.0 * 100) // RevLightsPercent
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 0) // RevLightsBitValue
	offset += 2

	// Brakes temperature (4 x uint16)
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint16(buf[offset:], uint16(400+rand.Intn(200)))
		offset += 2
	}

	// Tyres surface temp (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = uint8(90 + rand.Intn(20))
		offset++
	}

	// Tyres inner temp (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = uint8(95 + rand.Intn(15))
		offset++
	}

	// Engine temp (2026: uint8로 축소)
	if simIs2026() {
		buf[offset] = uint8(100 + rand.Intn(20))
		offset++
	} else {
		binary.LittleEndian.PutUint16(buf[offset:], uint16(100+rand.Intn(20)))
		offset += 2
	}

	// Tyres pressure (4 x float32)
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(23.0+rand.Float32()*2))
		offset += 4
	}

	// Surface type (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = 0 // Tarmac
		offset++
	}
}

func (s *Simulator) writeLapData(buf []byte, isPlayer bool, carIdx int) {
	offset := 0

	var lastLap, currentLap uint32
	var lapDist, totalDist float32
	var position, lapNum, sector, lapInvalid uint8
	var deltaFront, deltaLeader int16

	if isPlayer {
		lastLap = s.LastLapTimeMS
		currentLap = s.CurrentLapTimeMS
		lapDist = s.LapDistance
		totalDist = s.TotalDistance
		position = s.Position
		lapNum = s.CurrentLap
		sector = s.Sector
		lapInvalid = s.LapInvalid
		deltaFront = 0
		deltaLeader = 0
	} else {
		ai := &s.aiCars[carIdx]
		lastLap = ai.lastLapTimeMS
		currentLap = 0
		lapDist = ai.lapDistance
		totalDist = ai.totalDistance
		position = ai.position
		lapNum = ai.lapNum
		sector = ai.sector
		lapInvalid = 0
		leaderDist := s.TotalDistance
		deltaLeader = int16((leaderDist - ai.totalDistance) / (float32(ai.speed) / 3.6) * 1000)
		deltaFront = int16(500 + rand.Intn(2000))
	}

	binary.LittleEndian.PutUint32(buf[offset:], lastLap)
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], currentLap)
	offset += 4
	var s1ms, s2ms uint16
	if isPlayer {
		// Player sector times from simulation progress
		progress := s.LapDistance / s.TrackLength
		if progress >= 0.33 {
			s1ms = uint16(26000 + rand.Intn(2000))
		}
		if progress >= 0.66 {
			s2ms = uint16(29000 + rand.Intn(2000))
		}
	} else {
		ai := &s.aiCars[carIdx]
		s1ms = ai.sector1Ms
		s2ms = ai.sector2Ms
	}
	binary.LittleEndian.PutUint16(buf[offset:], s1ms)
	offset += 2
	buf[offset] = 0 // Sector1TimeMinutes
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], s2ms)
	offset += 2
	buf[offset] = 0 // Sector2TimeMinutes
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(deltaFront))
	offset += 2
	buf[offset] = 0 // DeltaToCarInFrontMinutesPart
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(deltaLeader))
	offset += 2
	buf[offset] = 0 // DeltaToRaceLeaderMinutesPart
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(lapDist))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(totalDist))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0)) // SafetyCarDelta
	offset += 4
	buf[offset] = position
	offset++
	buf[offset] = lapNum
	offset++
	buf[offset] = 0 // PitStatus
	offset++
	buf[offset] = 0 // NumPitStops
	offset++
	buf[offset] = sector
	offset++
	buf[offset] = lapInvalid
	offset++
	var penVal, warnVal, ccWarnVal uint8
	if isPlayer {
		penVal = s.Penalties
		warnVal = s.TotalWarnings
		ccWarnVal = s.CornerCuttingWarnings
	} else if aiState, ok := s.aiPenaltyStates[carIdx]; ok {
		penVal = aiState.penalties
		warnVal = aiState.totalWarnings
		ccWarnVal = aiState.cornerCuttingWarnings
	}
	buf[offset] = penVal
	offset++ // Penalties
	buf[offset] = warnVal
	offset++ // TotalWarnings
	buf[offset] = ccWarnVal
	offset++
	buf[offset] = 0 // NumUnservedDriveThroughs
	offset++
	buf[offset] = 0 // NumUnservedStopGoPenalties
	offset++
	buf[offset] = position // GridPosition
	offset++
	buf[offset] = 1 // DriverStatus (on track)
	offset++
	buf[offset] = 0 // ResultStatus
	offset++
	buf[offset] = 0 // PitLaneTimerActive
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 0) // PitLaneTimeInLaneInMS
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0) // PitStopTimerInMS
	offset += 2
	buf[offset] = 0 // PitStopShouldServePen
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(float32(320+rand.Intn(20)))) // SpeedTrapFastestSpeed
	offset += 4
	buf[offset] = lapNum // SpeedTrapFastestLap
}

func (s *Simulator) writeMotionData(buf []byte, carIdx int) {
	progress := math.Mod(float64(s.LapDistance/s.TrackLength)+float64(carIdx)/MaxCars, 1.0)
	angle := progress * 2 * math.Pi

	radiusX := 950.0
	radiusZ := 650.0
	x := float32(radiusX * math.Cos(angle))
	z := float32(radiusZ * math.Sin(angle))
	speedMS := float64(s.Speed) / 3.6
	vx := float32(-speedMS * math.Sin(angle))
	vz := float32(speedMS * math.Cos(angle))
	yaw := float32(angle + math.Pi/2)

	offset := 0
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(x))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(z))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(vx))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(vz))
	offset += 4

	forwardX := int16(math.Sin(angle) * 32767)
	forwardZ := int16(math.Cos(angle) * 32767)
	rightX := int16(math.Cos(angle) * 32767)
	rightZ := int16(-math.Sin(angle) * 32767)

	binary.LittleEndian.PutUint16(buf[offset:], uint16(forwardX))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(forwardZ))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(rightX))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(rightZ))
	offset += 2
	gLat := math.Sin(angle) * 0.8
	if simIs2026() {
		// 2026: G-force int16 양자화 (×1000)
		binary.LittleEndian.PutUint16(buf[offset:], uint16(int16(gLat*1000)))
		offset += 2
		binary.LittleEndian.PutUint16(buf[offset:], uint16(int16(0.15*1000)))
		offset += 2
		binary.LittleEndian.PutUint16(buf[offset:], uint16(int16(0.05*1000)))
		offset += 2
	} else {
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(float32(gLat)))
		offset += 4
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.15))
		offset += 4
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.05))
		offset += 4
	}
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(yaw))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.01))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
}

// F1 grid: teamID (2025 enum 0-9, 11=Cadillac 의사값), 2 drivers per team.
// 2025 모드는 앞 22대만 사용. 2026 모드는 24대 + teamID를 '26 enum(476+)으로 변환.
var f1Grid = [MaxCars]struct {
	name   string
	teamID uint8
	number uint8
}{
	{"Hamilton", 1, 44}, {"Leclerc", 1, 16}, // Ferrari
	{"Verstappen", 2, 1}, {"Tsunoda", 2, 22}, // Red Bull
	{"Norris", 8, 4}, {"Piastri", 8, 81}, // McLaren
	{"Russell", 0, 63}, {"Antonelli", 0, 12}, // Mercedes
	{"Alonso", 4, 14}, {"Stroll", 4, 18}, // Aston Martin
	{"Gasly", 5, 10}, {"Doohan", 5, 7}, // Alpine
	{"Lawson", 6, 30}, {"Hadjar", 6, 20}, // RB
	{"Ocon", 7, 31}, {"Bearman", 7, 87}, // Haas
	{"Sainz", 3, 55}, {"Albon", 3, 23}, // Williams
	{"Hulkenberg", 9, 27}, {"Bortoleto", 9, 5}, // Sauber/Audi
	{"Bottas", 11, 77}, {"Perez", 11, 11}, // Cadillac (2026 전용; 2025 모드에선 미사용 인덱스)
	{"AI 23", 255, 98}, {"AI 24", 255, 99}, // Reserve (2026 모드 24번째까지)
}

// team2026 maps the pseudo-2025 grid teamIDs to the 2026 Season Pack team enum.
var team2026 = map[uint8]uint16{
	0: 476, 1: 477, 2: 478, 3: 479, 4: 480, 5: 481,
	6: 482, 7: 483, 8: 484, 9: 485, 11: 486,
}

func (s *Simulator) writeParticipantData(buf []byte, carIdx int) {
	offset := 0
	isPlayer := carIdx == int(s.PlayerCarIdx)
	entry := f1Grid[carIdx]

	teamID := uint16(entry.teamID)
	if simIs2026() {
		if mapped, ok := team2026[entry.teamID]; ok {
			teamID = mapped
		}
	}

	if isPlayer {
		buf[offset] = 0 // Human
	} else {
		buf[offset] = 1 // AI
	}
	offset++

	driverID := uint16(carIdx)
	if isPlayer {
		driverID = 255
	}

	if simIs2026() {
		// 2026: driverId/networkId/teamId uint16
		binary.LittleEndian.PutUint16(buf[offset:], driverID)
		offset += 2
		binary.LittleEndian.PutUint16(buf[offset:], uint16(carIdx)) // NetworkID
		offset += 2
		binary.LittleEndian.PutUint16(buf[offset:], teamID)
		offset += 2
	} else {
		buf[offset] = uint8(driverID)
		offset++
		buf[offset] = uint8(carIdx) // NetworkID
		offset++
		buf[offset] = uint8(teamID) // TeamID
		offset++
	}
	if isPlayer {
		buf[offset] = 1
	}
	offset++
	buf[offset] = entry.number // RaceNumber
	offset++
	buf[offset] = 9 // Nationality
	offset++

	copy(buf[offset:offset+32], []byte(entry.name))
	offset += 32

	buf[offset] = 1 // YourTelemetry public
	offset++
	buf[offset] = 1 // ShowOnlineNames
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(500+carIdx*10))
	offset += 2
	buf[offset] = 1 // Platform
	offset++
	buf[offset] = 2 // NumColours
	offset++

	colours := [4][3]uint8{
		{220, 20, 60},
		{255, 215, 0},
		{30, 144, 255},
		{245, 245, 245},
	}
	for _, colour := range colours {
		copy(buf[offset:offset+3], colour[:])
		offset += 3
	}
}

func (s *Simulator) writeCarStatus(buf []byte, isPlayer bool, carIdx int) {
	offset := 0
	fuelInTank := float32(18.5)
	fuelRemainingLaps := float32(maxInt(1, s.TotalLaps-int(s.CurrentLap)+1))
	ers := float32(3200000)
	compound := uint8(17) // medium
	tyreAge := uint8(maxInt(0, int(s.CurrentLap)-1))

	if !isPlayer {
		fuelInTank = 12 + rand.Float32()*15
		fuelRemainingLaps = 2 + rand.Float32()*20
		ers = 2000000 + rand.Float32()*1500000
		compounds := []uint8{16, 17, 18}
		compound = compounds[carIdx%len(compounds)]
		tyreAge = uint8(rand.Intn(maxInt(1, s.TotalLaps)))
	}

	buf[offset] = 1 // TractionControl
	offset++
	buf[offset] = 1 // ABS
	offset++
	buf[offset] = 1 // FuelMix standard
	offset++
	buf[offset] = 57 // FrontBrakeBias
	offset++
	buf[offset] = 0 // PitLimiterStatus
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(fuelInTank))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(32))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(fuelRemainingLaps))
	offset += 4
	binary.LittleEndian.PutUint16(buf[offset:], 15000)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 4000)
	offset += 2
	buf[offset] = 8 // MaxGears
	offset++
	buf[offset] = s.DRS
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 250)
	offset += 2
	buf[offset] = compound // ActualTyreCompound
	offset++
	buf[offset] = compound // VisualTyreCompound
	offset++
	buf[offset] = tyreAge
	offset++
	buf[offset] = 0 // VehicleFIAFlags
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(520000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(120000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(ers))
	offset += 4
	buf[offset] = 1 // ERSDeployMode
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(120000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(85000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(140000))
	offset += 4
	if simIs2026() {
		// ERSHarvestLimitPerLap (2026 신규 필드)
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(2_000_000))
		offset += 4
	}
	buf[offset] = 0 // NetworkPaused
}

func writeMarshalZone(buf []byte, offset int, start float32, flag int8) {
	binary.LittleEndian.PutUint32(buf[offset:offset+4], math.Float32bits(start))
	buf[offset+4] = byte(flag)
}

func writeForecast(buf []byte, offset int, sessionType uint8, timeOffset uint8, weather uint8, trackTemp int8, trackTrend int8, airTemp int8, airTrend int8, rain uint8) {
	buf[offset] = sessionType
	buf[offset+1] = timeOffset
	buf[offset+2] = weather
	buf[offset+3] = byte(trackTemp)
	buf[offset+4] = byte(trackTrend)
	buf[offset+5] = byte(airTemp)
	buf[offset+6] = byte(airTrend)
	buf[offset+7] = rain
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
