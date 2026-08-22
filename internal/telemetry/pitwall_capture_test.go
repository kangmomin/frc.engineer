package telemetry

import (
	"testing"

	"frc.engineer/internal/packets"
)

// TestCaptureStartLap: 세션 첫 LapData에서 헤더의 PlayerCarIndex 기준으로 캡처
// 시작 랩이 고정되고, 세션 전환 시 리셋 후 재기록된다.
func TestCaptureStartLap(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)

	ld := &packets.PacketLapData{}
	ld.Header.SessionUID = 1
	ld.Header.PlayerCarIndex = 2
	ld.LapData[2].CurrentLapNum = 5
	pm.UpdateLapData(ld)
	if got := pm.CaptureStartLap(); got != 5 {
		t.Fatalf("CaptureStartLap = %d, want 5", got)
	}

	// 같은 세션의 후속 랩은 시작 랩을 바꾸지 않는다.
	ld2 := &packets.PacketLapData{}
	ld2.Header.SessionUID = 1
	ld2.Header.PlayerCarIndex = 2
	ld2.LapData[2].CurrentLapNum = 6
	pm.UpdateLapData(ld2)
	if got := pm.CaptureStartLap(); got != 5 {
		t.Fatalf("CaptureStartLap after later lap = %d, want 5", got)
	}

	// 세션 전환: 리셋 후 새 세션의 현재 랩으로 재기록.
	ld3 := &packets.PacketLapData{}
	ld3.Header.SessionUID = 2
	ld3.Header.PlayerCarIndex = 2
	ld3.LapData[2].CurrentLapNum = 1
	pm.UpdateLapData(ld3)
	if got := pm.CaptureStartLap(); got != 1 {
		t.Fatalf("CaptureStartLap after session switch = %d, want 1", got)
	}
}

// TestPlayerHasCompletedLap: 히스토리의 LapTimeInMS>0 엔트리만 완주로 판정한다
// (NumLaps는 진행 중 랩을 포함하므로 그것만으로는 완주가 아니다).
func TestPlayerHasCompletedLap(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	if pm.PlayerHasCompletedLap() {
		t.Fatal("no history → false")
	}

	// 진행 중 랩만 있는 히스토리 (타임 0).
	sh := &packets.PacketSessionHistoryData{CarIdx: 0, NumLaps: 1}
	sh.Header.SessionUID = 1
	pm.UpdateSessionHistory(sh)
	if pm.PlayerHasCompletedLap() {
		t.Fatal("in-progress lap only → false")
	}

	// 완주 랩 등장.
	sh2 := &packets.PacketSessionHistoryData{CarIdx: 0, NumLaps: 2}
	sh2.Header.SessionUID = 1
	sh2.LapHistoryData[0].LapTimeInMS = 91000
	pm.UpdateSessionHistory(sh2)
	if !pm.PlayerHasCompletedLap() {
		t.Fatal("completed lap in history → true")
	}
}
