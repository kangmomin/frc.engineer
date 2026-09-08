package analysis

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// Both API forms use the lap recording's attempt boundaries. Stream-local frame
// maps cannot distinguish a replayed frame after a flashback.
func readSafeComparisonInputs(dir string, completed map[int]LapSummary) ([]comparisonFrame, float64, map[uint32]comparisonTelemetry, map[uint32]comparisonMotion, error) {
	ctx := context.Background()
	timeline, err := readLapTimeline(ctx, dir, -1)
	if err != nil {
		return nil, 0, nil, nil, err
	}
	var frames []comparisonFrame
	var maxDist float64
	var matchers []*attemptMatcher
	recording := indexLapRecording(timeline)
	for _, lap := range summarizeLapFrames(timeline) {
		if _, ok := completed[lap.LapNum]; !ok {
			continue
		}
		m := newAttemptMatcher(timeline, lap, recording)
		if !m.usable() {
			continue
		}
		matchers = append(matchers, m)
		for i := lap.startOrdinal; i < lap.endOrdinal; i++ {
			f := timeline[i]
			if f.distance == nil {
				continue
			}
			if *f.distance > maxDist {
				maxDist = *f.distance
			}
			frames = append(frames, comparisonFrame{frame: uint32(i), lapNum: lap.LapNum, lapDist: *f.distance})
		}
	}
	tels := map[uint32]comparisonTelemetry{}
	motions := map[uint32]comparisonMotion{}
	for _, stream := range []string{"telemetry", "motion"} {
		identity, err := inspectSourceIdentity(ctx, filepath.Join(dir, stream+".jsonl"), -1, true)
		if err != nil {
			if stream == "motion" && errors.Is(err, os.ErrNotExist) {
				motions = nil
				continue
			}
			return nil, 0, nil, nil, err
		}

		seen := map[uint32]bool{}
		err = scanSnapshot(ctx, filepath.Join(dir, stream+".jsonl"), -1, func(line []byte) error {
			r, ok := decodeNative(line, stream)
			if !ok {
				return nil
			}
			for _, m := range matchers {
				method, ok := identity.identify(m, r.id)
				if !ok {
					continue
				}
				index := m.anchor(r.id, method)
				if index < 0 {
					continue
				}
				key := uint32(index)
				if seen[key] {
					if stream == "telemetry" {
						delete(tels, key)
					} else {
						delete(motions, key)
					}
					continue
				}
				seen[key] = true
				c := r.car
				if stream == "telemetry" {
					if bounded(c.Speed, 0, 65535) == nil || bounded(c.Throttle, 0, 1) == nil || bounded(c.Steer, -1, 1) == nil || bounded(c.Brake, 0, 1) == nil {
						continue
					}
					tels[key] = comparisonTelemetry{uint16(*c.Speed), float32(*c.Throttle), float32(*c.Steer), float32(*c.Brake)}
				} else {
					motions[key] = comparisonMotion{c.VelX, c.VelZ, c.Yaw}
				}
			}
			return nil
		})
		if err != nil {
			return nil, 0, nil, nil, err
		}
	}
	return frames, maxDist, tels, motions, nil
}
