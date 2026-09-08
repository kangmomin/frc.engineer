import { describe, expect, it } from 'vitest';
import type { IncidentReplay } from '../data/raceAnalysisTypes';
import {
  bodyScreenVector,
  createPlaybackState,
  decodeIncidentCar,
  frameIndexAt,
  localGridLinePositions,
  makeReplayMap,
  motionScreenVector,
  playbackActionForKey,
  playbackActionForFocusedRegion,
  relativeIncidentTimeMs,
  reducePlayback,
  sortedReplayFrames,
  teamIdentity,
  telemetryFreshness,
  INITIAL_REPLAY_CAMERA,
  zoomReplayCamera,
} from './analysisPlayback';

function replay(overrides: Partial<IncidentReplay> = {}): IncidentReplay {
  return {
    raceId: 'race-a', index: 0, schemaVersion: 2, sessionTimeMs: 1_000,
    windowStartMs: 0, frameIntervalMs: 50, lap: 4, collisions: [[1, 2]],
    participants: [
      { idx: 0, name: 'Player', teamId: 0, isPlayer: true, minDistM: 0.4 },
      { idx: 23, name: '', teamId: 255, isPlayer: false, minDistM: 1.2 },
    ],
    frames: [
      { tMs: 900, cars: [[1, 0, 2, 3, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1], [4, 0, 8, 0, 0, 0, 1, 0, 0, 120, 0, 1, -0.5, 3]], telemetryUnavailable: [] },
      { tMs: 1_100, cars: [[2, 0, 3, 3, 0, 4, Math.PI / 2, 0, 0, 0, 0, 0, 0, 1], null], telemetryUnavailable: [23] },
    ],
    completeness: { status: 'complete', reasons: [], capturedParticipantCount: 2, storedParticipantCount: 2, capturedFrameCount: 2, storedFrameCount: 2 },
    ...overrides,
  };
}

describe('analysis replay projection helpers', () => {
  it('decodes the fixed tuple without treating genuine zero input as absent', () => {
    const car = decodeIncidentCar(replay().frames[0].cars[0]);
    expect(car).toMatchObject({ x: 1, z: 2, speedKmh: 0, throttle: 0, brake: 0, steer: 0, gear: 1 });
    expect(decodeIncidentCar(null)).toBeNull();
  });

  it('keeps legacy duplicate timestamp source order and chooses the newest measured frame at or before playhead', () => {
    const frames = sortedReplayFrames([
      { tMs: 120, cars: [], telemetryUnavailable: null },
      { tMs: 100, cars: [], telemetryUnavailable: null },
      { tMs: 100, cars: [[9, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]], telemetryUnavailable: null },
    ]);
    expect(frames.map((frame) => frame.tMs)).toEqual([100, 100, 120]);
    expect(frameIndexAt(frames, 100)).toBe(1);
    expect(frameIndexAt(frames, 119)).toBe(1);
    expect(frameIndexAt(frames, 999)).toBe(2);
    expect(relativeIncidentTimeMs(950, 1_000)).toBe(-50);
  });

  it('uses the frozen X/-Z screen transform for yaw and physical velocity', () => {
    expect(bodyScreenVector(0)).toEqual({ x: 0, y: -1 });
    expect(bodyScreenVector(Math.PI / 2)).toEqual({ x: 1, y: 0 });
    expect(motionScreenVector(3, 4)).toEqual({ x: 0.6, y: -0.8 });
    expect(motionScreenVector(0, 0)).toBeNull();
  });

  it('uses actual outlines, otherwise an explicitly local metre grid instead of inventing a circuit', () => {
    const incident = replay();
    expect(makeReplayMap(incident, { points: [[0, 0], [20, 10]], bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 10 } }).kind).toBe('outline');
    const fallback = makeReplayMap(incident, null);
    expect(fallback.kind).toBe('local-grid');
    expect(fallback.label).toContain('metre');
  });

  it('keeps all incident positions inside outline-map bounds, including runoff beyond the centreline', () => {
    const incident = replay({
      frames: [{
        tMs: 1_000,
        cars: [[250, 0, -300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [-120, 0, 180, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]],
        telemetryUnavailable: [],
      }],
    });
    const map = makeReplayMap(incident, { points: [[0, 0], [20, 10]], bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 10 } });
    expect(map.kind).toBe('outline');
    expect(map.bounds.maxX).toBeGreaterThan(250);
    expect(map.bounds.minX).toBeLessThan(-120);
    expect(map.bounds.maxY).toBeGreaterThan(300);
    expect(map.bounds.minY).toBeLessThan(-180);
  });

  it('derives vertical grid lines from width and horizontal grid lines from height', () => {
    const lines = localGridLinePositions(1_000, 560, 42);
    expect(lines.vertical).toEqual([42, 156.5, 271, 385.5, 500, 614.5, 729, 843.5, 958]);
    expect(lines.horizontal).toEqual([42, 101.5, 161, 220.5, 280, 339.5, 399, 458.5, 518]);
  });

  it('keeps 0, 255, null, unknown and Car #23 identity distinct', () => {
    expect(teamIdentity(0).label).toBe('Mercedes');
    expect(teamIdentity(255).label).toBe('No team');
    expect(teamIdentity(null).label).toBe('Unknown');
    expect(teamIdentity(999).label).toBe('Team #999');
    expect(teamIdentity(23).color).toBeTruthy();
  });

  it('distinguishes v2 unavailable telemetry from true zero and from legacy freshness ambiguity', () => {
    const v2 = replay();
    expect(telemetryFreshness(v2.frames[0], 0)).toBe('fresh');
    expect(telemetryFreshness(v2.frames[1], 23)).toBe('unavailable');
    expect(telemetryFreshness({ ...v2.frames[0], telemetryUnavailable: null }, 0)).toBe('legacy-unknown');
  });
});

describe('measured timestamp playback reducer', () => {
  it('cannot play a clip whose frames all have the same timestamp', () => {
    expect(reducePlayback(createPlaybackState([100, 100]), { type: 'play' }).playing).toBe(false);
  });
  it('toggles and pauses without advancing the measured playhead', () => {
    let state = createPlaybackState([100, 200], 1);
    state = reducePlayback(state, { type: 'toggle' });
    expect(state.playing).toBe(true);
    state = reducePlayback(state, { type: 'pause' });
    expect(state).toMatchObject({ playheadMs: 100, playing: false });
    state = reducePlayback(state, { type: 'toggle' });
    expect(state.playing).toBe(true);
  });

  it('advances by RAF elapsed milliseconds and rate, clamps at end, and pauses there', () => {
    let state = createPlaybackState([900, 1_100], 1);
    state = reducePlayback(state, { type: 'play' });
    state = reducePlayback(state, { type: 'rate', rate: 2 });
    state = reducePlayback(state, { type: 'tick', elapsedMs: 50 });
    expect(state.playheadMs).toBe(1_000);
    state = reducePlayback(state, { type: 'tick', elapsedMs: 100 });
    expect(state).toMatchObject({ playheadMs: 1_100, playing: false });
  });

  it('uses measured frame times for step, slider seek, Home and End', () => {
    let state = createPlaybackState([900, 1_030, 1_100], 1);
    state = reducePlayback(state, { type: 'seek', playheadMs: 1_050 });
    state = reducePlayback(state, { type: 'previous-frame' });
    expect(state.playheadMs).toBe(1_030);
    state = reducePlayback(state, { type: 'next-frame' });
    expect(state.playheadMs).toBe(1_100);
    state = reducePlayback(state, { type: 'home' });
    expect(state.playheadMs).toBe(900);
    state = reducePlayback(state, { type: 'end' });
    expect(state).toMatchObject({ playheadMs: 1_100, playing: false });
  });

  it('maps only the replay-region keys to actions', () => {
    expect(playbackActionForKey(' ')).toEqual({ type: 'toggle' });
    expect(playbackActionForKey('Space')).toEqual({ type: 'toggle' });
    expect(playbackActionForKey('ArrowLeft')).toEqual({ type: 'previous-frame' });
    expect(playbackActionForKey('Home')).toEqual({ type: 'home' });
    expect(playbackActionForKey('Escape')).toBeNull();
    expect(playbackActionForFocusedRegion('ArrowRight', false)).toBeNull();
    expect(playbackActionForFocusedRegion('ArrowRight', true)).toEqual({ type: 'next-frame' });
  });
});

describe('replay camera', () => {
  it('keeps the cursor world point fixed and clamps extreme zoom factors', () => {
    const anchor = { x: 125, y: 80 };
    const camera = zoomReplayCamera(INITIAL_REPLAY_CAMERA, 2, anchor);
    expect(camera).toEqual({ zoom: 2, x: -125, y: -80 });
    expect(anchor.x * camera.zoom + camera.x).toBe(anchor.x);
    expect(anchor.y * camera.zoom + camera.y).toBe(anchor.y);
    expect(zoomReplayCamera(camera, 1e6, anchor).zoom).toBe(16);
    expect(zoomReplayCamera(camera, 1e-6, anchor).zoom).toBe(0.5);
    expect(zoomReplayCamera(camera, 0.5, anchor)).toEqual(INITIAL_REPLAY_CAMERA);
  });

  it('fits incident positions independently of a distant full-track outline', () => {
    const outline = { points: [[-10_000, -10_000], [10_000, 10_000]] as Array<[number, number]>, bounds: { minX: -10_000, maxX: 10_000, minZ: -10_000, maxZ: 10_000 } };
    const full = makeReplayMap(replay(), outline, 'track');
    const focused = makeReplayMap(replay(), outline, 'incident');
    expect(focused.kind).toBe('outline');
    expect(focused.bounds.maxX - focused.bounds.minX).toBeLessThan(100);
    expect(full.bounds.maxX - full.bounds.minX).toBeGreaterThan(20_000);
  });
});
