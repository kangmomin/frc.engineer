import { describe, expect, it } from 'vitest';
import { loadReplayTrack, type ReplayTrackReference } from '../../constants/replayTracks';
import { outlineFor, pointAtDistance, resolveReplayTrack } from './analysisTrack';

const reference: ReplayTrackReference = { trackId: 5, gameFormat: 'F1 26', trackLength: 100, points: [[1, 0, 0], [25, 24, 0], [50, 24, 25], [75, 0, 25], [99, 0, 2]] };

describe('replay track resolution', () => {
  it('loads the audited historic fallback only for its exact game and layout', async () => {
    const asset = await loadReplayTrack(5, 'F1 26');
    const resolved = resolveReplayTrack(null, asset, 5, 'F1 26');
    expect(resolved.source).toBe('reference');
    expect(resolved.landmarks.map(({ label }) => label)).toContain('T1');
    expect(resolved.landmarks[0].label).toBe('S/F');
    expect(await loadReplayTrack(5, 'F1 25')).toBeNull();
    expect(await loadReplayTrack(39, 'F1 26')).toBeNull();
    expect(resolveReplayTrack(null, asset, 39, 'F1 26').outline).toBeNull();
    expect(resolveReplayTrack(null, asset, 5, 'F1 25').outline).toBeNull();
  });

  it('preserves captured geometry and withholds corner labels on a mismatched capture', () => {
    const captured = outlineFor([[1000, 1000], [1500, 1200]])!;
    const result = resolveReplayTrack(captured, reference, 5, 'F1 26');
    expect(result.source).toBe('recorded');
    expect(result.outline).toEqual(captured);
    expect(result.landmarks).toEqual([]);
    expect(resolveReplayTrack(outlineFor(reference.points.map(([, x, z]) => [x, z])), reference, 5, 'F1 26').landmarks.length).toBeGreaterThan(1);
  });

  it('rejects unusable geometry while preserving legitimate zero coordinates', () => {
    expect(outlineFor([])).toBeNull();
    expect(outlineFor([[0, 0], [0, 0]])).toBeNull();
    expect(outlineFor([[NaN, 0], [0, 1]])).toBeNull();
    expect(outlineFor([[0, 0], [0, 1]])).not.toBeNull();
    expect(resolveReplayTrack(null, { ...reference, points: [[0, 0, 0], [2, 1, 1], [1, 2, 2]] }, 5, 'F1 26').source).toBe('unavailable');
  });

  it('rejects an unrelated coordinate origin but retains runoff and missing samples', () => {
    const frame = (x: number): import('../data/raceAnalysisTypes').IncidentFrame => ({ tMs: 0, telemetryUnavailable: null, cars: [[x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], null] });
    expect(resolveReplayTrack(null, reference, 5, 'F1 26', [frame(1000)]).source).toBe('unavailable');
    expect(resolveReplayTrack(null, reference, 5, 'F1 26', [frame(80)]).source).toBe('reference');
    expect(resolveReplayTrack(null, reference, 5, 'F1 26', [{ ...frame(0), cars: [null] }]).source).toBe('reference');
    const translated = outlineFor(reference.points.map(([, x, z]) => [x + 49, z]))!;
    const result = resolveReplayTrack(translated, reference, 5, 'F1 26', [frame(1000)]);
    expect(result.source).toBe('recorded');
    expect(result.landmarks).toEqual([]);
  });

  it('interpolates using measured lap distance, wrapping across the start line', () => {
    expect(pointAtDistance(reference, 25)).toEqual([24, 0]);
    expect(pointAtDistance(reference, 37.5)).toEqual([24, 12.5]);
    expect(pointAtDistance(reference, 0)).toEqual([0, 1]);
    expect(pointAtDistance(reference, -1)).toEqual(pointAtDistance(reference, 99));
    expect(pointAtDistance(reference, 100)).toEqual(pointAtDistance(reference, 0));
  });
});
