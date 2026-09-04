package telemetry

import (
	"errors"
	"io"
	"log/slog"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

var errTestSave = errors.New("test save failure")

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRaceSummarySavedOncePerSession(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	saveCount := 0
	p.SetRaceSummarySaveCallback(func(sessionUID uint64, counts RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, _ *dto.RaceDetailInput) error {
		saveCount++
		if sessionUID == 0 {
			t.Fatal("sessionUID should be non-zero")
		}
		_ = counts
		return nil
	})
	p.SetRaceSummaryRecording(true)

	// Save once for first session.
	p.saveRaceSummaryForEvent(1001, "SEND")
	p.saveRaceSummaryForEvent(1001, "CHQF")
	if saveCount != 1 {
		t.Fatalf("save count = %d, want 1", saveCount)
	}

	// New session should allow a new save.
	p.observeSessionUID(1002)
	p.saveRaceSummaryForEvent(1002, "SEND")
	if saveCount != 2 {
		t.Fatalf("save count = %d, want 2", saveCount)
	}
}

func TestRaceSummaryRespectsDisabledFlag(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	saveCount := 0
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, _ *dto.RaceDetailInput) error {
		saveCount++
		return nil
	})
	p.SetRaceSummaryRecording(false)

	p.saveRaceSummaryForEvent(2001, "SEND")
	if saveCount != 0 {
		t.Fatalf("save count = %d, want 0", saveCount)
	}
}

// TestCheckpointModeDemotesChequeredFlag: checkpoint 모드에서 CHQF/RCWN은 세션을
// 잠그지 않는 체크포인트 저장이고, SEND만 정식(final) 저장으로 세션을 닫는다.
func TestCheckpointModeDemotesChequeredFlag(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)
	p.SetCheckpointSaves(true)

	var triggers []string
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, detail *dto.RaceDetailInput) error {
		triggers = append(triggers, detail.FinalizeTrigger)
		return nil
	})
	p.SetRaceSummaryRecording(true)

	p.saveRaceSummaryForEvent(4001, "CHQF") // checkpoint — 세션 열린 채 저장
	p.saveRaceSummaryForEvent(4001, "SEND") // final — 저장 후 세션 잠금
	p.saveRaceSummaryForEvent(4001, "SEND") // no-op
	if len(triggers) != 2 || triggers[0] != "CHQF" || triggers[1] != "SEND" {
		t.Fatalf("triggers = %v, want [CHQF SEND]", triggers)
	}
}

func TestRaceSummaryFinalizeProvenanceDistinguishesCheckpoint(t *testing.T) {
	logger := testLogger()
	p := NewProcessor(udp.NewParser(logger), websocket.NewHub(8, logger), 0, logger, nil)
	p.SetCheckpointSaves(true)
	var provenance []dto.RaceCaptureProvenance
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, detail *dto.RaceDetailInput) error {
		if detail == nil || detail.PrivateCapture == nil {
			t.Fatal("save detail must carry private capture provenance")
		}
		provenance = append(provenance, detail.PrivateCapture.Provenance)
		return nil
	})
	p.SetRaceSummaryRecording(true)

	p.saveRaceSummaryForEvent(4_101, "CHQF")
	p.saveRaceSummaryForEvent(4_101, "SEND")
	if len(provenance) != 2 {
		t.Fatalf("provenance saves = %d, want 2", len(provenance))
	}
	if !provenance[0].CheckpointFinalize || provenance[0].NormalFinalize {
		t.Fatalf("CHQF provenance = %+v, want checkpoint only", provenance[0])
	}
	if provenance[1].CheckpointFinalize || !provenance[1].NormalFinalize {
		t.Fatalf("SEND provenance = %+v, want normal final only", provenance[1])
	}
}

// TestFinalSaveFailureSetsPending: final 저장 실패는 finalSavePending에 트리거를
// 보존하고(이후 idle 재시도가 final로 실행), 성공 시 정리된다.
func TestFinalSaveFailureSetsPending(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	fail := true
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, _ *dto.RaceDetailInput) error {
		if fail {
			return errTestSave
		}
		return nil
	})
	p.SetRaceSummaryRecording(true)

	if ok := p.saveRaceSummary(5001, "SEND", true); ok {
		t.Fatal("failing save should return false")
	}
	p.raceSummaryMu.Lock()
	pending, saved := p.finalSavePending, p.raceSummarySaved
	p.raceSummaryMu.Unlock()
	if pending != "SEND" || saved {
		t.Fatalf("pending=%q saved=%v, want SEND/false", pending, saved)
	}

	fail = false
	if ok := p.saveRaceSummary(5001, "SEND", true); !ok {
		t.Fatal("retry save should succeed")
	}
	p.raceSummaryMu.Lock()
	pending, saved = p.finalSavePending, p.raceSummarySaved
	p.raceSummaryMu.Unlock()
	if pending != "" || !saved {
		t.Fatalf("pending=%q saved=%v after success, want \"\"/true", pending, saved)
	}
}

// TestSessionSwitchFinalizesPreviousSession: 새 세션 UID 관측 시, 완주 랩이 있는
// 미저장 이전 세션이 session-switch final로 저장된다.
func TestSessionSwitchFinalizesPreviousSession(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)
	p.SetCheckpointSaves(true)

	var savedUIDs []uint64
	var savedTriggers []string
	p.SetRaceSummarySaveCallback(func(uid uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, detail *dto.RaceDetailInput) error {
		savedUIDs = append(savedUIDs, uid)
		savedTriggers = append(savedTriggers, detail.FinalizeTrigger)
		return nil
	})
	p.SetRaceSummaryRecording(true)

	// 이전 세션 6001: 완주 랩 1개를 히스토리에 심는다 (player index 0).
	sh := &packets.PacketSessionHistoryData{CarIdx: 0, NumLaps: 1}
	sh.Header.SessionUID = 6001
	sh.LapHistoryData[0].LapTimeInMS = 90000
	p.PitwallManager().UpdateSessionHistory(sh)
	p.observeSessionUID(6001)

	p.maybeFinalizePreviousSession(6002)
	if len(savedUIDs) != 1 || savedUIDs[0] != 6001 || savedTriggers[0] != "session-switch" {
		t.Fatalf("saved %v %v, want [6001] [session-switch]", savedUIDs, savedTriggers)
	}

	// 저장 완료된 세션은 다음 전환에서 재저장되지 않는다.
	p.maybeFinalizePreviousSession(6003)
	if len(savedUIDs) != 1 {
		t.Fatalf("save count = %d after second switch, want 1", len(savedUIDs))
	}
}

// TestSessionSwitchSkipsWithoutCompletedLap: 완주 랩 없는 이전 세션은 전환 시
// 저장하지 않는다 (빈 요약 노이즈 방지).
func TestSessionSwitchSkipsWithoutCompletedLap(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)
	p.SetCheckpointSaves(true)

	saveCount := 0
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, _ []dto.RaceControlNotification, _ *dto.PitwallState, _ *dto.RaceDetailInput) error {
		saveCount++
		return nil
	})
	p.SetRaceSummaryRecording(true)

	p.observeSessionUID(7001)
	p.maybeFinalizePreviousSession(7002)
	if saveCount != 0 {
		t.Fatalf("save count = %d, want 0 (no completed lap)", saveCount)
	}
}

func TestRaceSummaryTimelineResetsPerSession(t *testing.T) {
	logger := testLogger()
	parser := udp.NewParser(logger)
	hub := websocket.NewHub(8, logger)
	p := NewProcessor(parser, hub, 0, logger, nil)

	var savedTimeline []dto.RaceControlNotification
	p.SetRaceSummarySaveCallback(func(_ uint64, _ RaceSummaryCounts, timeline []dto.RaceControlNotification, _ *dto.PitwallState, _ *dto.RaceDetailInput) error {
		savedTimeline = append([]dto.RaceControlNotification(nil), timeline...)
		return nil
	})
	p.SetRaceSummaryRecording(true)

	p.observeSessionUID(3001)
	p.recordRaceSummaryNotification(&dto.RaceControlNotification{
		ID:        "rc-1",
		Category:  "info",
		Message:   "Race Winner!",
		Severity:  "info",
		Timestamp: 1,
	})
	p.saveRaceSummaryForEvent(3001, "RCWN")
	if len(savedTimeline) != 1 {
		t.Fatalf("saved timeline len = %d, want 1", len(savedTimeline))
	}

	savedTimeline = nil
	p.observeSessionUID(3002)
	p.saveRaceSummaryForEvent(3002, "SEND")
	if len(savedTimeline) != 0 {
		t.Fatalf("saved timeline len = %d, want 0 after session reset", len(savedTimeline))
	}
}
