package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func TestSweepAdvancesPastPermanentRejectionsAfterRestart(t *testing.T) {
	dir := t.TempDir()
	logger := testUploadLogger()
	rs, err := races.NewFileStorage(dir, logger)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= sweepMaxPerRun; i++ {
		summary := newTestSummary(uint64(i+1), 1)
		summary.ID = fmt.Sprintf("capture_%03d", i)
		if _, err := rs.Save(summary); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	attempts := make(map[string]int)
	allowRetry := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request uploadRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		mu.Lock()
		attempts[request.SourceRaceID]++
		reject := request.SourceRaceID != "capture_000" && !allowRetry
		mu.Unlock()
		if reject {
			http.Error(w, "invalid capture", http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(uploadResult{RaceID: "platform-" + request.SourceRaceID})
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	u := newUploadState(dir, logger)
	u.sweep(ctx, server.URL, "test", rs.Load)
	sc, err := u.readSidecar("capture_020")
	if err != nil || sc == nil || sc.RejectedAt == "" || sc.SealedAt == "" || sc.UploadedAt != "" {
		t.Fatalf("rejection was not durably sealed: %+v / %v", sc, err)
	}
	u = newUploadState(dir, logger)
	u.sweep(ctx, server.URL, "test", rs.Load)
	mu.Lock()
	validAttempts, rejectedAttempts := attempts["capture_000"], attempts["capture_020"]
	allowRetry = true
	mu.Unlock()
	if validAttempts != 1 || rejectedAttempts != 1 {
		t.Fatalf("backlog starved or rejection retried: valid=%d rejected=%d", validAttempts, rejectedAttempts)
	}
	// The explicit API remains able to retry the same sealed content.
	if _, _, err := u.uploadSealed(ctx, server.URL, "test", "capture_020", rs.Load); err != nil {
		t.Fatal(err)
	}
	sc, err = u.readSidecar("capture_020")
	if err != nil || sc.UploadedAt == "" || sc.RejectedAt != "" {
		t.Fatalf("manual retry state: %+v / %v", sc, err)
	}
}

func TestTransientUploadFailuresRemainRetryable(t *testing.T) {
	for _, status := range []int{0, 401, 403, 408, 409, 429, 500, 503} {
		if permanentUploadRejection(status) {
			t.Fatalf("status %d must remain retryable", status)
		}
	}
	for _, status := range []int{400, 413, 415, 422} {
		if !permanentUploadRejection(status) {
			t.Fatalf("status %d must not starve later captures", status)
		}
	}
}

func TestUploadSealedUsesFinalSnapshotAfterCheckpointWasRead(t *testing.T) {
	dir := t.TempDir()
	logger := testUploadLogger()
	rs, err := races.NewFileStorage(dir, logger)
	if err != nil {
		t.Fatal(err)
	}
	u := newUploadState(dir, logger)
	checkpoint := newTestSummary(42, 1)
	checkpoint.Detail.FinalizeTrigger = "idle-timeout"
	id, err := u.saveWithStableID(rs, 42, checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	// Manual/sweep eligibility checks may already have read the old checkpoint.
	old, err := rs.Load(id)
	if err != nil || len(old.Detail.Laps) != 1 {
		t.Fatalf("checkpoint = %+v, error = %v", old, err)
	}
	final := newTestSummary(42, 1, 2)
	final.Detail.FinalizeTrigger = "SEND"
	if finalID, err := u.saveWithStableID(rs, 42, final); err != nil || finalID != id {
		t.Fatalf("final ID = %q, error = %v", finalID, err)
	}
	received := make(chan uploadRequest, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req uploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		received <- req
		json.NewEncoder(w).Encode(uploadResult{RaceID: "platform-race"})
	}))
	defer server.Close()
	if _, _, err := u.uploadSealed(context.Background(), server.URL, "test", id, rs.Load); err != nil {
		t.Fatal(err)
	}
	req := <-received
	if req.SourceRaceID != id || len(req.Laps) != 2 || req.Detail.FinalizeTrigger != "SEND" {
		t.Fatalf("uploaded stale checkpoint: %+v", req)
	}
	result, _, err := u.uploadSealed(context.Background(), server.URL, "test", id, rs.Load)
	if err != nil || !result.Duplicate {
		t.Fatalf("repeat = %+v, error = %v", result, err)
	}
	select {
	case <-received:
		t.Fatal("already uploaded final snapshot sent again")
	default:
	}
}

func TestUploadSealedFreezesSnapshotAndDoesNotBlockSaveOnNetwork(t *testing.T) {
	dir := t.TempDir()
	logger := testUploadLogger()
	rs, err := races.NewFileStorage(dir, logger)
	if err != nil {
		t.Fatal(err)
	}
	u := newUploadState(dir, logger)
	id, err := u.saveWithStableID(rs, 42, newTestSummary(42, 1))
	if err != nil {
		t.Fatal(err)
	}
	firstBody := make(chan []byte, 1)
	nextBody := make(chan []byte, 2)
	releaseResponse := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		select {
		case <-releaseResponse:
			nextBody <- body
			json.NewEncoder(w).Encode(uploadResult{RaceID: "platform-race"})
		default:
			firstBody <- body
			<-releaseResponse
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(server.Close)
	// Ensure a failing assertion cannot leave the server handler blocked.
	t.Cleanup(func() {
		select {
		case <-releaseResponse:
		default:
			close(releaseResponse)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	uploadDone := make(chan error, 1)
	go func() {
		_, _, err := u.uploadSealed(ctx, server.URL, "test", id, rs.Load)
		uploadDone <- err
	}()
	var original []byte
	select {
	case original = <-firstBody:
	case <-ctx.Done():
		t.Fatal("initial upload did not reach server")
	}
	final := newTestSummary(42, 1, 2)
	saveDone := make(chan error, 1)
	go func() {
		_, err := u.saveWithStableID(rs, 42, final)
		saveDone <- err
	}()
	select {
	case err := <-saveDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		close(releaseResponse)
		t.Fatal("network upload blocked the final save")
	}
	if final.ID == id {
		close(releaseResponse)
		t.Fatal("final save reused the sealed checkpoint ID")
	}
	close(releaseResponse)
	if err := <-uploadDone; err == nil {
		t.Fatal("initial 503 upload should fail")
	}
	if _, _, err := u.uploadSealed(ctx, server.URL, "test", id, rs.Load); err != nil {
		t.Fatal(err)
	}
	if retry := <-nextBody; !bytes.Equal(original, retry) {
		t.Fatal("retry changed the sealed checkpoint payload")
	}
	if _, _, err := u.uploadSealed(ctx, server.URL, "test", final.ID, rs.Load); err != nil {
		t.Fatal(err)
	}
	var uploadedFinal uploadRequest
	if err := json.Unmarshal(<-nextBody, &uploadedFinal); err != nil {
		t.Fatal(err)
	}
	if uploadedFinal.SourceRaceID != final.ID || len(uploadedFinal.Laps) != 2 {
		t.Fatalf("final snapshot lost: %+v", uploadedFinal)
	}
}

func TestSweepDefersCheckpointRefreshedDuringEarlierUpload(t *testing.T) {
	dir := t.TempDir()
	logger := testUploadLogger()
	rs, err := races.NewFileStorage(dir, logger)
	if err != nil {
		t.Fatal(err)
	}
	u := newUploadState(dir, logger)
	for uid := uint64(41); uid <= 43; uid++ {
		summary := newTestSummary(uid, 1)
		summary.ID = fmt.Sprintf("20260905-120000_%d", uid)
		summary.Detail.FinalizeTrigger = "SEND"
		if uid == 42 {
			summary.Detail.FinalizeTrigger = "shutdown"
		}
		if _, err := u.saveWithStableID(rs, uid, summary); err != nil {
			t.Fatal(err)
		}
	}
	checkpointID := u.thisRun[42]
	old := time.Now().Add(-3 * time.Hour)
	if err := os.Chtimes(filepath.Join(dir, checkpointID+".json"), old, old); err != nil {
		t.Fatal(err)
	}
	firstID, lastID := u.thisRun[43], u.thisRun[41]
	received := make(chan string, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req uploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if req.SourceRaceID == firstID {
			// Sweep has enumerated the aged checkpoint, but a resumed session
			// saves another lap while the first candidate's HTTP request runs.
			resumed := newTestSummary(42, 1, 2)
			resumed.Detail.FinalizeTrigger = "idle-timeout"
			if id, err := u.saveWithStableID(rs, 42, resumed); err != nil || id != checkpointID {
				t.Errorf("resumed save ID = %q, error = %v", id, err)
			}
		}
		received <- req.SourceRaceID
		json.NewEncoder(w).Encode(uploadResult{RaceID: "platform-" + req.SourceRaceID})
	}))
	defer server.Close()
	u.sweep(context.Background(), server.URL, "test", rs.Load)
	if len(received) != 2 {
		t.Fatalf("sweep must defer the refreshed checkpoint and continue: %d uploads", len(received))
	}
	if first, last := <-received, <-received; first != firstID || last != lastID {
		t.Fatalf("uploaded unexpected candidates: %q, %q", first, last)
	}
	if sc, err := u.readSidecar(checkpointID); err != nil || sc != nil {
		t.Fatalf("live checkpoint must remain unsealed: %+v, error = %v", sc, err)
	}
}

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
	prev.Replay = &races.ReplayTimeline{FrameIntervalMS: 500, Frames: []races.ReplayFrame{{Timestamp: 1000}, {Timestamp: 1500}}}
	prevID, err := rs.Save(prev)
	if err != nil {
		t.Fatal(err)
	}

	// 재시작: 부팅 스캔이 파일을 채택하고, 새 실행분(랩 2만 관측)과 병합한다.
	u := newUploadState(dir, testUploadLogger())
	next := newTestSummary(42, 1, 2)
	next.Detail.Dynamics = next.Detail.Dynamics[1:] // 새 실행은 랩 2 다이내믹스만 관측
	next.Replay = &races.ReplayTimeline{FrameIntervalMS: 500, Frames: []races.ReplayFrame{{Timestamp: 2000}}}
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
	if merged.Replay == nil || len(merged.Replay.Frames) != 3 || merged.Replay.Frames[0].Timestamp != 1000 {
		t.Fatalf("restart discarded earlier replay frames: %+v", merged.Replay)
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
	if final.Replay == nil || len(final.Replay.Frames) != 3 || final.Replay.Frames[2].Timestamp != 2000 {
		t.Fatalf("repeated save discarded merged replay frames: %+v", final.Replay)
	}
}

func TestSaveWithStableIDSameProcessCheckpointDoesNotDoubleCumulativeProvenance(t *testing.T) {
	dir := t.TempDir()
	rs, err := races.NewFileStorage(dir, testUploadLogger())
	if err != nil {
		t.Fatal(err)
	}
	u := newUploadState(dir, testUploadLogger())
	build := func(normal bool) *races.RaceSummary {
		return &races.RaceSummary{
			SchemaVersion: races.RaceSummarySchemaVersion,
			SessionUID:    42,
			Detail: &races.RaceDetail{Events: []dto.RaceControlNotification{
				{Timestamp: 100, Message: "checkpoint"}, {Timestamp: 200, Message: "final"},
			}},
			PrivateCapture: &dto.RacePrivateCapture{RunID: "one-process", Provenance: dto.RaceCaptureProvenance{
				EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 4,
				CheckpointFinalize: !normal, NormalFinalize: normal,
			}},
		}
	}
	checkpoint := build(false)
	checkpoint.Detail.Events = checkpoint.Detail.Events[:1]
	id, err := u.saveWithStableID(rs, 42, checkpoint)
	if err != nil {
		t.Fatalf("checkpoint save: %v", err)
	}
	if _, err := u.saveWithStableID(rs, 42, build(true)); err != nil {
		t.Fatalf("normal final save: %v", err)
	}
	saved, err := rs.Load(id)
	if err != nil {
		t.Fatal(err)
	}
	if saved.PrivateCapture == nil {
		t.Fatal("private capture missing after same-process save")
	}
	provenance := saved.PrivateCapture.Provenance
	if provenance.EventsSeen != 150 || provenance.EventsBufferDropped != 4 || !provenance.NormalFinalize || provenance.CheckpointFinalize {
		t.Fatalf("same-process persisted provenance = %+v, want latest cumulative normal-final facts", provenance)
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
	summary.Player.ResultStatus = 3   // finished
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

// TestSummaryFinishPositionRequiresSettledPlayerResult pins the mid-race-exit
// gate: the game sends SEND when the player quits mid-race too, with the player
// still active and no Final Classification, so that live position must not be
// uploaded as a finishing position (history/20261102-finish-position-validation.md).
func TestSummaryFinishPositionRequiresSettledPlayerResult(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   bool
	}{
		{"unknown/legacy", 0, false},
		{"inactive", 1, false},
		{"active (mid-race exit)", 2, false},
		{"finished", 3, true},
		{"dnf", 4, true},
		{"dsq", 5, true},
		{"not classified", 6, true},
		{"retired", 7, true},
		{"out of range", 8, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			summary := newTestSummary(42, 1, 2)
			summary.Session.SessionType = "Race"
			summary.Player.FinalPosition = 8
			summary.Player.ResultStatus = tc.status
			summary.Detail.FinalizeTrigger = "SEND"

			pos, ok := summaryFinishPosition(summary)
			if ok != tc.want {
				t.Fatalf("status %d: ok = %v, want %v", tc.status, ok, tc.want)
			}
			if ok && pos != 8 {
				t.Fatalf("status %d: position = %d, want 8", tc.status, pos)
			}
		})
	}
}
