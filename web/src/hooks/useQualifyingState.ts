import { useEffect, useReducer } from 'react';
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
  driverStatus?: number;
  pitStatus: number;
  currentLapNum: number;
  currentSector: number;
  lapInvalid: boolean;
  lastLapTime: number;
  bestLapTime: number;
}

function extractFrame(driver: DriverInfo, lapInvalid: boolean): Frame {
  return {
    driverStatus: driver.driverStatus ?? 0,
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
  if (curr.currentLapNum < prev.currentLapNum) {
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

interface HookState {
  key: string;
  value: QualifyingState;
  previous: Frame | null;
}

function initialFrameState(frame: Frame | null): QualifyingState {
  return { ...INITIAL_STATE, phase: frame?.pitStatus ? 'PIT' : frame?.driverStatus === 0 ? 'GARAGE' : 'UNKNOWN' };
}

function reducer(state: HookState, action: { key: string; current: Frame | null }): HookState {
  const reset = state.key !== action.key || !action.current || !state.previous ||
    action.current.currentLapNum < state.previous.currentLapNum;
  return {
    key: action.key,
    previous: action.current,
    value: reset ? initialFrameState(action.current) : processFrame(state.previous, action.current!, state.value),
  };
}

// ── Hook ──

export function useQualifyingState(
  driver: DriverInfo | null,
  lapInvalid: boolean,
  isQualifying: boolean,
  sessionKey: string,
): QualifyingState {
  const key = `${sessionKey}|${isQualifying}|${driver?.index ?? ''}|${driver?.name ?? ''}|${driver?.teamId ?? ''}`;
  const [state, dispatch] = useReducer(reducer, { key: '', value: INITIAL_STATE, previous: null });

  useEffect(() => {
    dispatch({ key, current: isQualifying && driver ? extractFrame(driver, lapInvalid) : null });
  }, [driver, lapInvalid, isQualifying, key]);

  // A new identity must never render the previous participant's attempt while
  // waiting for its effect to run.
  return state.key === key ? state.value : initialFrameState(isQualifying && driver ? extractFrame(driver, lapInvalid) : null);
}
