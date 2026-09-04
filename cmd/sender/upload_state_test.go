package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func testUploadLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestIsFinalClassTrigger(t *testing.T) {
	finals := []string{"", "SEND", "session-switch"}
	for _, tr := range finals {
		if !isFinalClassTrigger(tr) {
			t.Fatalf("%q should be final-class", tr)
		}
	}
	checkpoints := []string{"CHQF", "RCWN", "idle-timeout", "shutdown"}
	for _, tr := range checkpoints {
		if isFinalClassTrigger(tr) {
			t.Fatalf("%q should be checkpoint-class", tr)
		}
	}
}

func TestSidecarRoundtrip(t *testing.T) {
	dir := t.TempDir()
	u := newUploadState(dir, testUploadLogger())

	if sc, err := u.readSidecar("nope"); err != nil || sc != nil {
		t.Fatalf("missing sidecar = %v/%v, want nil/nil", sc, err)
	}
	in := &uploadSidecar{SealedAt: time.Now().Format(time.RFC3339), Trigger: "idle-timeout"}
	if err := u.writeSidecarDurable("race1", in); err != nil {
		t.Fatalf("write: %v", err)
	}
	out, err := u.readSidecar("race1")
	if err != nil || out == nil || out.Trigger != "idle-timeout" || out.UploadedAt != "" {
		t.Fatalf("roundtrip = %+v/%v", out, err)
	}
}

func TestNewUploadStateIndexesNewestPerSession(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"20260101_000000_monza_42.json",
		"20260102_000000_monza_42.json", // 같은 세션의 더 새로운 파일
		"20260103_000000_monza_notanuid.json",
		"20260104_000000_spa_77.meta.json", // 메타는 무시
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	u := newUploadState(dir, testUploadLogger())
	if got := u.bootIDs[42]; got != "20260102_000000_monza_42" {
		t.Fatalf("bootIDs[42] = %q, want newest", got)
	}
	if len(u.bootIDs) != 1 {
		t.Fatalf("bootIDs len = %d, want 1", len(u.bootIDs))
	}
}

func newTestSummary(uid uint64, lapNums ...int) *races.RaceSummary {
	s := &races.RaceSummary{
		SessionUID: uid,
		Track:      races.TrackInfo{TrackID: 10, TrackName: "Italy (Monza)"},
		Detail:     &races.RaceDetail{},
	}
	for _, n := range lapNums {
		s.Detail.Laps = append(s.Detail.Laps, dto.LapTimingDTO{LapNumber: n, LapMs: 90000, Valid: true})
		s.Detail.Dynamics = append(s.Detail.Dynamics, dto.DynamicsLapDTO{LapNum: n})
	}
	return s
}

func TestSaveWithStableIDReusesAndMintsOnSeal(t *testing.T) {
	dir := t.TempDir()
	rs, err := races.NewFileStorage(dir, testUploadLogger())
	if err != nil {
		t.Fatal(err)
	}
	u := newUploadState(dir, testUploadLogger())

	id1, err := u.saveWithStableID(rs, 42, newTestSummary(42, 1))
	if err != nil || id1 == "" {
		t.Fatalf("first save: %q/%v", id1, err)
	}
	// 같은 세션 재저장 → 같은 ID를 덮어쓴다.
	id2, err := u.saveWithStableID(rs, 42, newTestSummary(42, 1, 2))
	if err != nil || id2 != id1 {
		t.Fatalf("second save id = %q, want %q", id2, id1)
	}

	// seal 후에는 새 ID가 발급된다 (같은 초에 저장돼도 sealed 파일을 덮지 않는다).
	if err := u.writeSidecarDurable(id1, &uploadSidecar{SealedAt: "now"}); err != nil {
		t.Fatal(err)
	}
	id3, err := u.saveWithStableID(rs, 42, newTestSummary(42, 1, 2, 3))
	if err != nil || id3 == "" || id3 == id1 {
		t.Fatalf("post-seal save id = %q (sealed %q), want fresh id", id3, id1)
	}
	// sealed 파일 내용은 그대로 (2랩 버전).
	sealed, err := rs.Load(id1)
	if err != nil || len(sealed.Detail.Laps) != 2 {
		t.Fatalf("sealed file laps = %d/%v, want 2 (immutable)", len(sealed.Detail.Laps), err)
	}
}

func TestSaveWithStableIDMergesAdoptedFile(t *testing.T) {
	dir := t.TempDir()
	rs, err := races.NewFileStorage(dir, testUploadLogger())
	if err != nil {
		t.Fatal(err)
	}
	// 이전 실행이 남긴 파일: 랩 1의 다이내믹스 보유.
	prev := newTestSummary(42, 1)
	prevID, err := rs.Save(prev)
	if err != nil {
		t.Fatal(err)
	}

	// 재시작: 부팅 스캔이 파일을 채택하고, 새 실행분(랩 2만 관측)과 병합한다.
	u := newUploadState(dir, testUploadLogger())
	next := newTestSummary(42, 1, 2)
	next.Detail.Dynamics = next.Detail.Dynamics[1:] // 새 실행은 랩 2 다이내믹스만 관측
	savedID, err := u.saveWithStableID(rs, 42, next)
	if err != nil || savedID != prevID {
		t.Fatalf("adopted save id = %q/%v, want %q", savedID, err, prevID)
	}
	merged, err := rs.Load(savedID)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.Detail.Dynamics) != 2 {
		t.Fatalf("merged dynamics len = %d, want 2 (union with pre-restart data)", len(merged.Detail.Dynamics))
	}

	// 세 번째 저장(thisRun 경로): 이번 실행 관측분(랩 3)만 든 요약이 와도,
	// 파일에 이미 병합돼 있던 재시작 이전 다이내믹스(랩 1)를 잃지 않아야 한다.
	third := newTestSummary(42, 1, 2, 3)
	third.Detail.Dynamics = third.Detail.Dynamics[2:] // 이번 실행은 랩 3만 관측
	thirdID, err := u.saveWithStableID(rs, 42, third)
	if err != nil || thirdID != prevID {
		t.Fatalf("third save id = %q/%v, want %q", thirdID, err, prevID)
	}
	final, err := rs.Load(thirdID)
	if err != nil {
		t.Fatal(err)
	}
	if len(final.Detail.Dynamics) != 3 {
		t.Fatalf("final dynamics len = %d, want 3 (thisRun re-save must keep merged laps)", len(final.Detail.Dynamics))
	}
}

func TestBuildUploadRequestTrimsMergedEvents(t *testing.T) {
	// 병합 요약은 서버 캡(200)을 넘는 이벤트를 가질 수 있다(150 링버퍼 × 두 실행).
	// 매퍼는 최신 200개만 남겨야 하고, 초과분 때문에 업로드 전체가 400으로 죽으면 안 된다.
	s := newTestSummary(42, 1)
	for i := 0; i < uploadMaxDetailEvents+50; i++ {
		s.Detail.Events = append(s.Detail.Events, dto.RaceControlNotification{
			Timestamp: int64(i), Message: "evt", Category: "race", Severity: "info",
		})
	}
	req, ok := buildUploadRequest(s, testUploadLogger())
	if !ok || req.Detail == nil {
		t.Fatalf("buildUploadRequest = %v/%v, want detail-bearing request", req, ok)
	}
	if len(req.Detail.Events) != uploadMaxDetailEvents {
		t.Fatalf("events len = %d, want %d", len(req.Detail.Events), uploadMaxDetailEvents)
	}
	if got := req.Detail.Events[0].Timestamp; got != 50 {
		t.Fatalf("oldest kept event ts = %d, want 50 (newest-first trim)", got)
	}
}

func TestBuildUploadRequestMapsMySetupHistoryFields(t *testing.T) {
	summary := newTestSummary(42, 1, 2)
	summary.ID = "" // Save Files off: upload must still mint a source id.
	summary.SavedAtLocal = "2026-09-04 19:23:45"
	summary.Session.SessionType = "Race 2"
	summary.Player.FinalPosition = 24 // F1 26's 24-car grid is valid.
	summary.Detail.FinalizeTrigger = "SEND"

	req, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || req == nil {
		t.Fatal("buildUploadRequest did not produce a request")
	}
	if req.SourceRaceID == "" {
		t.Fatal("empty summary id must get a source race id before upload")
	}
	if summary.ID != "" {
		t.Fatal("upload-only source id must not mutate the in-memory summary")
	}
	wantRecordedAt, err := time.ParseInLocation("2006-01-02 15:04:05", summary.SavedAtLocal, time.Local)
	if err != nil {
		t.Fatal(err)
	}
	if req.RecordedAt == nil || !req.RecordedAt.Equal(wantRecordedAt) {
		t.Fatalf("recordedAt = %v, want %v", req.RecordedAt, wantRecordedAt)
	}
	if req.FinishPosition == nil || *req.FinishPosition != 24 {
		t.Fatalf("finishPosition = %v, want 24", req.FinishPosition)
	}
}

func TestBuildUploadRequestOmitsInvalidMySetupHistoryFields(t *testing.T) {
	summary := newTestSummary(42, 1)
	summary.SavedAtLocal = "not-a-local-timestamp"
	summary.Session.SessionType = "Race"
	summary.Player.FinalPosition = 1
	summary.Detail.FinalizeTrigger = "session-switch"

	req, ok := buildUploadRequest(summary, testUploadLogger())
	if !ok || req == nil {
		t.Fatal("buildUploadRequest did not produce a request")
	}
	if req.RecordedAt != nil || req.FinishPosition != nil {
		t.Fatalf("legacy/switch fields = %v/%v, want nil/nil", req.RecordedAt, req.FinishPosition)
	}
}
