import { useEffect, useReducer, useRef } from 'react';
import type { DriverInfo } from '../types/telemetry';

// ── Types ──

export type QualifyingPhase = 'GARAGE' | 'PIT' | 'UNKNOWN' | 'OUT' | 'FLYING' | 'COOLDOWN';

export interface QualifyingState {
  phase: QualifyingPhase;
  attemptNumber: number;
  consecutivePushLaps: number;
  invalidatedAtSector: number | null;
  bestValidFlyingLapMs: number | null;
}

// ── Constants ──

export const COMPETITIVE_MARGIN_MS = 2_000;
export const MAX_BACK_TO_BACK_PUSH_LAPS = 2;

export const INITIAL_STATE: QualifyingState = {
  phase: 'UNKNOWN',
  attemptNumber: 0,
  consecutivePushLaps: 0,
  invalidatedAtSector: null,
  bestValidFlyingLapMs: null,
};

// ── Snapshot for edge detection ──

export interface Frame {
  pitStatus: number;
  currentLapNum: number;
  currentSector: number;
  lapInvalid: boolean;
  lastLapTime: number;
  bestLapTime: number;
}

function extractFrame(driver: DriverInfo, lapInvalid: boolean): Frame {
  return {
    pitStatus: driver.pitStatus,
    currentLapNum: driver.currentLapNum,
    currentSector: driver.currentSector,
    lapInvalid,
    lastLapTime: driver.lastLapTime,
    bestLapTime: driver.bestLapTime,
  };
}

// ── Transition logic (pure functions, exported for testing) ──

export function nextStateAfterFlyingLap(state: QualifyingState, frame: Frame): QualifyingPhase {
  const reference = state.bestValidFlyingLapMs ?? (frame.bestLapTime > 0 ? frame.bestLapTime : null);

  // S2 or S3 invalid → COOLDOWN
  if (state.invalidatedAtSector !== null && state.invalidatedAtSector >= 1) {
    return 'COOLDOWN';
  }

  // S1 invalid → allow one retry, then force cooldown
  if (state.invalidatedAtSector === 0) {
    return state.consecutivePushLaps < MAX_BACK_TO_BACK_PUSH_LAPS ? 'FLYING' : 'COOLDOWN';
  }

  // Valid lap — check if competitive
  const lapIsValid = frame.lastLapTime > 0;
  const lapIsCompetitive =
    reference == null
      ? lapIsValid
      : lapIsValid && frame.lastLapTime <= reference + COMPETITIVE_MARGIN_MS;

  if (lapIsCompetitive) return 'COOLDOWN';

  // Slow valid lap — allow one retry
  return state.consecutivePushLaps < MAX_BACK_TO_BACK_PUSH_LAPS ? 'FLYING' : 'COOLDOWN';
}

export function processFrame(
  prev: Frame | null,
  curr: Frame,
  state: QualifyingState,
): QualifyingState {
  if (!prev) return state;

  const next = { ...state };

  // Session reset detection (lap number rewind)
  if (curr.currentLapNum < prev.currentLapNum - 1) {
    return { ...INITIAL_STATE };
  }

  // ── Pit transitions ──
  const wasPitting = prev.pitStatus !== 0;
  const isPitting = curr.pitStatus !== 0;

  if (!wasPitting && isPitting) {
    next.phase = 'PIT';
    next.consecutivePushLaps = 0;
    next.invalidatedAtSector = null;
    return next;
  }

  if (wasPitting && !isPitting) {
    next.phase = 'OUT';
    next.attemptNumber += 1;
    next.consecutivePushLaps = 0;
    next.invalidatedAtSector = null;
    return next;
  }

  if (isPitting) {
    if (next.phase !== 'PIT' && next.phase !== 'GARAGE') {
      next.phase = 'PIT';
    }
    return next;
  }

  // ── Invalidation detection (lapInvalid false → true) ──
  if (curr.lapInvalid && !prev.lapInvalid && next.phase === 'FLYING') {
    next.invalidatedAtSector = curr.currentSector;
  }

  // ── Lap boundary detection ──
  if (curr.currentLapNum !== prev.currentLapNum && curr.currentLapNum > prev.currentLapNum) {
    switch (next.phase) {
      case 'OUT':
        next.phase = 'FLYING';
        next.consecutivePushLaps = 1;
        next.invalidatedAtSector = null;
        break;

      case 'FLYING': {
        const nextPhase = nextStateAfterFlyingLap(next, curr);

        // Update best valid flying lap
        if (next.invalidatedAtSector === null && curr.lastLapTime > 0) {
          if (next.bestValidFlyingLapMs === null || curr.lastLapTime < next.bestValidFlyingLapMs) {
            next.bestValidFlyingLapMs = curr.lastLapTime;
          }
        }

        if (nextPhase === 'FLYING') {
          next.consecutivePushLaps += 1;
        } else {
          next.consecutivePushLaps = 0;
        }
        next.phase = nextPhase;
        next.invalidatedAtSector = null;
        break;
      }

      case 'COOLDOWN':
        next.phase = 'FLYING';
        next.consecutivePushLaps = 1;
        next.invalidatedAtSector = null;
        break;

      case 'UNKNOWN':
        next.phase = 'FLYING';
        next.consecutivePushLaps = 1;
        next.attemptNumber = 1;
        break;

      default:
        break;
    }
  }

  return next;
}

// ── Reducer ──

type Action =
  | { type: 'TICK'; prev: Frame | null; curr: Frame }
  | { type: 'RESET' };

function reducer(state: QualifyingState, action: Action): QualifyingState {
  switch (action.type) {
    case 'TICK':
      return processFrame(action.prev, action.curr, state);
    case 'RESET':
      return INITIAL_STATE;
  }
}

// ── Hook ──

export function useQualifyingState(
  driver: DriverInfo | null,
  lapInvalid: boolean,
  isQualifying: boolean,
): QualifyingState {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const prevFrameRef = useRef<Frame | null>(null);

  useEffect(() => {
    if (!isQualifying || !driver) {
      prevFrameRef.current = null;
      dispatch({ type: 'RESET' });
      return;
    }

    const curr = extractFrame(driver, lapInvalid);
    const prev = prevFrameRef.current;

    // Dispatch with captured prev — ref is NOT mutated inside reducer
    dispatch({ type: 'TICK', prev, curr });

    // Advance ref AFTER dispatch, outside the reducer
    prevFrameRef.current = curr;
  }, [driver, lapInvalid, isQualifying]);

  return state;
}
