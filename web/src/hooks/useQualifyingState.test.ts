import { describe, expect, it } from 'vitest';
import {
  type Frame,
  type QualifyingState,
  INITIAL_STATE,
  MAX_BACK_TO_BACK_PUSH_LAPS,
  processFrame,
  nextStateAfterFlyingLap,
} from './useQualifyingState';

// ── Helpers ──

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    pitStatus: 0,
    currentLapNum: 1,
    currentSector: 0,
    lapInvalid: false,
    lastLapTime: 0,
    bestLapTime: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<QualifyingState> = {}): QualifyingState {
  return { ...INITIAL_STATE, ...overrides };
}

// ── Tests ──

describe('processFrame', () => {
  it('returns state unchanged when prev is null (first frame)', () => {
    const state = makeState();
    const result = processFrame(null, makeFrame(), state);
    expect(result).toBe(state);
  });

  describe('pit transitions', () => {
    it('transitions to PIT when pitStatus changes from 0 to non-0', () => {
      const prev = makeFrame({ pitStatus: 0 });
      const curr = makeFrame({ pitStatus: 2 });
      const state = makeState({ phase: 'FLYING', consecutivePushLaps: 1 });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('PIT');
      expect(result.consecutivePushLaps).toBe(0);
    });

    it('transitions to OUT when pitStatus changes from non-0 to 0', () => {
      const prev = makeFrame({ pitStatus: 2 });
      const curr = makeFrame({ pitStatus: 0 });
      const state = makeState({ phase: 'PIT', attemptNumber: 0 });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('OUT');
      expect(result.attemptNumber).toBe(1);
    });

    it('increments attemptNumber on each pit exit', () => {
      const prev = makeFrame({ pitStatus: 2 });
      const curr = makeFrame({ pitStatus: 0 });
      const state = makeState({ phase: 'PIT', attemptNumber: 2 });

      const result = processFrame(prev, curr, state);
      expect(result.attemptNumber).toBe(3);
    });

    it('transitions FLYING → PIT on mid-lap pit entry', () => {
      const prev = makeFrame({ pitStatus: 0 });
      const curr = makeFrame({ pitStatus: 1 });
      const state = makeState({ phase: 'FLYING', consecutivePushLaps: 1 });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('PIT');
    });
  });

  describe('OUT → FLYING on lap boundary', () => {
    it('transitions OUT → FLYING when lap number increases', () => {
      const prev = makeFrame({ currentLapNum: 2 });
      const curr = makeFrame({ currentLapNum: 3 });
      const state = makeState({ phase: 'OUT' });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('FLYING');
      expect(result.consecutivePushLaps).toBe(1);
    });
  });

  describe('invalidation detection', () => {
    it('records invalidatedAtSector when lapInvalid flips true during FLYING', () => {
      const prev = makeFrame({ lapInvalid: false, currentSector: 1 });
      const curr = makeFrame({ lapInvalid: true, currentSector: 1 });
      const state = makeState({ phase: 'FLYING' });

      const result = processFrame(prev, curr, state);
      expect(result.invalidatedAtSector).toBe(1);
    });

    it('does NOT record invalidation when not in FLYING phase', () => {
      const prev = makeFrame({ lapInvalid: false, currentSector: 1 });
      const curr = makeFrame({ lapInvalid: true, currentSector: 1 });
      const state = makeState({ phase: 'OUT' });

      const result = processFrame(prev, curr, state);
      expect(result.invalidatedAtSector).toBeNull();
    });
  });

  describe('S1 invalid → retry once, then COOLDOWN', () => {
    it('stays FLYING after S1 invalid with push streak < 2', () => {
      const prev = makeFrame({ currentLapNum: 3, lapInvalid: true, currentSector: 0 });
      const curr = makeFrame({ currentLapNum: 4, lastLapTime: 90000, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: 0,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('FLYING');
      expect(result.consecutivePushLaps).toBe(2);
    });

    it('forces COOLDOWN after S1 invalid when push streak >= 2', () => {
      const prev = makeFrame({ currentLapNum: 4 });
      const curr = makeFrame({ currentLapNum: 5, lastLapTime: 90000, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 2,
        invalidatedAtSector: 0,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
      expect(result.consecutivePushLaps).toBe(0);
    });
  });

  describe('S2/S3 invalid → COOLDOWN', () => {
    it('transitions to COOLDOWN after S2 invalidation', () => {
      const prev = makeFrame({ currentLapNum: 3 });
      const curr = makeFrame({ currentLapNum: 4, lastLapTime: 85000, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: 1,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
    });

    it('transitions to COOLDOWN after S3 invalidation', () => {
      const prev = makeFrame({ currentLapNum: 5 });
      const curr = makeFrame({ currentLapNum: 6, lastLapTime: 85000, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: 2,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
    });
  });

  describe('competitive lap → COOLDOWN', () => {
    it('transitions to COOLDOWN when lap is within 2s of best', () => {
      const prev = makeFrame({ currentLapNum: 3 });
      const curr = makeFrame({ currentLapNum: 4, lastLapTime: 81500, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: null,
        bestValidFlyingLapMs: 80000,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
    });

    it('transitions to COOLDOWN when lap IS the best', () => {
      const prev = makeFrame({ currentLapNum: 3 });
      const curr = makeFrame({ currentLapNum: 4, lastLapTime: 79500, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: null,
        bestValidFlyingLapMs: 80000,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
      expect(result.bestValidFlyingLapMs).toBe(79500);
    });
  });

  describe('COOLDOWN → FLYING on lap boundary', () => {
    it('transitions COOLDOWN → FLYING on next lap', () => {
      const prev = makeFrame({ currentLapNum: 5 });
      const curr = makeFrame({ currentLapNum: 6 });
      const state = makeState({ phase: 'COOLDOWN' });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('FLYING');
      expect(result.consecutivePushLaps).toBe(1);
    });
  });

  describe('push cap (MAX_BACK_TO_BACK_PUSH_LAPS)', () => {
    it('forces COOLDOWN after max consecutive push laps even with slow valid lap', () => {
      const prev = makeFrame({ currentLapNum: 5 });
      const curr = makeFrame({ currentLapNum: 6, lastLapTime: 95000, bestLapTime: 80000 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: MAX_BACK_TO_BACK_PUSH_LAPS,
        invalidatedAtSector: null,
        bestValidFlyingLapMs: 80000,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
    });
  });

  describe('session reset', () => {
    it('resets to INITIAL_STATE when lap number rewinds by more than 1', () => {
      const prev = makeFrame({ currentLapNum: 10 });
      const curr = makeFrame({ currentLapNum: 1 });
      const state = makeState({
        phase: 'FLYING',
        attemptNumber: 3,
        consecutivePushLaps: 2,
        bestValidFlyingLapMs: 80000,
      });

      const result = processFrame(prev, curr, state);
      expect(result).toEqual(INITIAL_STATE);
    });
  });

  describe('UNKNOWN bootstrap', () => {
    it('transitions UNKNOWN → FLYING on first lap boundary', () => {
      const prev = makeFrame({ currentLapNum: 1 });
      const curr = makeFrame({ currentLapNum: 2 });
      const state = makeState({ phase: 'UNKNOWN' });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('FLYING');
      expect(result.attemptNumber).toBe(1);
    });
  });

  describe('first valid lap with no reference best', () => {
    it('treats first valid lap as competitive → COOLDOWN', () => {
      const prev = makeFrame({ currentLapNum: 3 });
      const curr = makeFrame({ currentLapNum: 4, lastLapTime: 85000, bestLapTime: 0 });
      const state = makeState({
        phase: 'FLYING',
        consecutivePushLaps: 1,
        invalidatedAtSector: null,
        bestValidFlyingLapMs: null,
      });

      const result = processFrame(prev, curr, state);
      expect(result.phase).toBe('COOLDOWN');
    });
  });
});

describe('nextStateAfterFlyingLap', () => {
  it('uses bestValidFlyingLapMs over frame.bestLapTime', () => {
    const state = makeState({
      invalidatedAtSector: null,
      consecutivePushLaps: 1,
      bestValidFlyingLapMs: 80000,
    });
    const frame = makeFrame({ lastLapTime: 81500, bestLapTime: 90000 });

    // 81500 is within 80000 + 2000 → COOLDOWN
    expect(nextStateAfterFlyingLap(state, frame)).toBe('COOLDOWN');
  });

  it('falls back to frame.bestLapTime when no local best', () => {
    const state = makeState({
      invalidatedAtSector: null,
      consecutivePushLaps: 1,
      bestValidFlyingLapMs: null,
    });
    const frame = makeFrame({ lastLapTime: 81500, bestLapTime: 80000 });

    // 81500 <= 80000 + 2000 → COOLDOWN
    expect(nextStateAfterFlyingLap(state, frame)).toBe('COOLDOWN');
  });
});
