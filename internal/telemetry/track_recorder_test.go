package telemetry

import (
	"bytes"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
)

func TestTrackRecorderPreservesMapAcrossIncompleteBoundaries(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	oldLogger := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() { slog.SetDefault(oldLogger) })
	for _, test := range []struct {
		name      string
		nextUID   uint64
		nextTrack int8
		nextDist  float32
		nextLap   uint8
	}{
		{"flashback_same_uid", 1, 0, 3000, 1},
		{"session_change_new_uid_and_track", 2, 3, 2, 1},
		{"new_uid_same_track", 2, 0, 2, 3},
		{"track_change_same_uid", 1, 3, 2, 3},
		{"short_lap_wrap", 1, 0, 2, 3},
		{"lap_jump", 1, 0, 2, 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			store := tracks.NewTrackStore(dir)
			recorder := NewTrackRecorder(dir, store, logger)
			initial := make([]recordPoint, 501)
			for i := range initial {
				initial[i] = recordPoint{Dist: 2 + float32(i)*10, X: float32(i), Z: float32(i % 20)}
			}
			recorder.saveLap(0, "Australia", 5002, initial)
			path := filepath.Join(dir, tracks.TrackStorageKey(0)+"_recorded.txt")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			recorder.SetEnabled(true)
			manager := NewPitwallManager(NewStrategyManager(), store, recorder)
			header := packets.PacketHeader{SessionUID: 1, PacketFormat: 2026, PlayerCarIndex: 0}
			manager.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: 0, TrackLength: 5002, SessionType: 10})
			feed := func(h packets.PacketHeader, lap uint8, dist float32) {
				laps := &packets.PacketLapData{Header: h}
				laps.LapData[0] = packets.LapData{CurrentLapNum: lap, LapDistance: dist, CarPosition: 1}
				manager.UpdateLapData(laps)
				motion := &packets.PacketMotionData{Header: h}
				motion.CarMotionData[0].WorldPositionX = dist
				motion.CarMotionData[0].WorldPositionZ = dist / 5
				manager.UpdateMotion(motion, 0)
			}
			for i := 0; i <= 100; i++ {
				feed(header, 2, 2+float32(i)*5)
			}
			header.SessionUID = test.nextUID
			if test.nextUID != 1 || test.nextTrack != 0 {
				manager.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: test.nextTrack, TrackLength: 6000, SessionType: 10})
			}
			feed(header, test.nextLap, test.nextDist)
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			points := store.Get(0).Points
			if !bytes.Equal(before, after) || len(points) != 501 {
				t.Fatalf("incomplete lap replaced the existing map: %d points", len(points))
			}

		})
	}
}

func TestTrackRecorderSavesOnlyACompleteObservedLap(t *testing.T) {
	dir := t.TempDir()
	store := tracks.NewTrackStore(dir)
	recorder := NewTrackRecorder(dir, store, testLogger())
	recorder.SetEnabled(true)
	point := func(lap uint8, distance float32) {
		recorder.RecordPoint(1, 0, "Australia", 5002, distance, lap, distance, 0, distance/5, 0, 0)
	}
	for i := 0; i <= 500; i++ {
		point(1, 2+float32(i)*10)
	}
	// A +1 lap number in the middle of the track is not a finish-line wrap.
	point(2, 3000)
	if store.Get(0) != nil {
		t.Fatal("non-wrap boundary saved a map")
	}
	for i := 0; i <= 500; i++ {
		point(3, 2+float32(i)*10)
	}
	point(4, 2)
	if got := store.Get(0); got == nil || len(got.Points) != 501 {
		t.Fatalf("complete lap not saved: %+v", got)
	}
	if !recorder.IsEnabled() {
		t.Fatal("recording preference was cleared")
	}
}
