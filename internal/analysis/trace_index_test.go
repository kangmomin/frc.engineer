package analysis

import (
	"fmt"
	"runtime"
	"testing"
	"time"
)

func recordingIndexFixture(lapCount, framesPerLap int) ([]parsedLapFrame, []LapSummary) {
	count := lapCount * framesPerLap
	frames := make([]parsedLapFrame, count+1)
	player := 0
	for i := range frames {
		frame := uint32(i + 1)
		at := float64(i) * .05
		elapsed := float64(i%framesPerLap) * 50
		distance := float64(i%framesPerLap) * 3
		recorded := time.Unix(1700000000, 0).Add(time.Duration(i) * 50 * time.Millisecond)
		frames[i] = parsedLapFrame{identity: captureIdentity{Player: &player, Frame: &frame, Overall: &frame, Time: &at}, recordedAt: recorded, lapNum: uint8(i/framesPerLap + 1), distance: &distance, elapsed: &elapsed}
	}
	laps := make([]LapSummary, lapCount)
	for i := range laps {
		laps[i] = LapSummary{LapNum: i + 1, startOrdinal: i * framesPerLap, endOrdinal: (i + 1) * framesPerLap}
	}
	return frames, laps
}

func TestCompletedLapMatchersShareRecordingIndex(t *testing.T) {
	// A 60-lap recording has 108,001 global frames, rather than 60 copies of them.
	frames, laps := recordingIndexFixture(60, 1800)
	recording := indexLapRecording(frames)
	if len(recording.frameCounts) != len(frames) {
		t.Fatalf("global entries %d, want %d", len(recording.frameCounts), len(frames))
	}
	entries := len(recording.frameCounts)
	for _, lap := range laps {
		matcher := newAttemptMatcher(frames, lap, recording)
		if matcher.recording != recording {
			t.Fatal("completed laps must share one recording index")
		}
		if len(matcher.overallIndex) != 1800 || len(matcher.frameIndex) != 1800 {
			t.Fatal("attempt index contains another lap's frames")
		}
		entries += len(matcher.overallIndex) + len(matcher.frameIndex)
		first := frames[lap.startOrdinal].identity
		method, ok := matcher.identify(first)
		if !ok || method != "overallFrame" || matcher.anchor(first, method) != lap.startOrdinal {
			t.Fatal("shared indexing changed identity matching")
		}
	}
	if entries != 3*len(frames)-2 {
		t.Fatalf("recording index storage grew beyond O(N): %d entries", entries)
	}
}

func BenchmarkCompletedLapRecordingIndex(b *testing.B) {
	// Keep N fixed while varying completed-lap count: both cases retain one N-entry
	// recording index and two sets of per-attempt entries totalling approximately 2N.
	const totalFrames = 108000
	for _, lapCount := range []int{15, 60} {
		b.Run(fmt.Sprintf("%d_laps", lapCount), func(b *testing.B) {
			frames, laps := recordingIndexFixture(lapCount, totalFrames/lapCount)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				recording := indexLapRecording(frames)
				matchers := make([]*attemptMatcher, 0, len(laps))
				for _, lap := range laps {
					matchers = append(matchers, newAttemptMatcher(frames, lap, recording))
				}
				runtime.KeepAlive(matchers)
			}
			b.ReportMetric(float64(len(frames)), "global-entries")
			b.ReportMetric(float64(totalFrames*2), "attempt-entries")
		})
	}
}
