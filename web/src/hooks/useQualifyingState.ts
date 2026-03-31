import { useEffect, useRef, useState } from 'react';
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

const COMPETITIVE_MARGIN_MS = 2_000;
const MAX_BACK_TO_BACK_PUSH_LAPS = 2;

const INITIAL_STATE: QualifyingState = {
  phase: 'UNKNOWN',
  attemptNumber: 0,
  consecutivePushLaps: 0,
  invalidatedAtSector: null,
  bestValidFlyingLapMs: null,
};

// ── Snapshot for edge detection ──

interface Frame {
  pitStatus: number;
  currentLapNum: number;
  currentSector: number;
  lapInvalid: boolean;
  lastLapTime: number;
  bestLapTime: number;
}

function extractFrame(driver: DriverInfo): Frame {
  return {
    pitStatus: driver.pitStatus,
    currentLapNum: driver.currentLapNum,
    currentSector: driver.currentSector,
    lapInvalid: false, // will be patched from dashboard telemetry
    lastLapTime: driver.lastLapTime,
    bestLapTime: driver.bestLapTime,
  };
}

// ── Transition logic ──

function nextStateAfterFlyingLap(state: QualifyingState, frame: Frame): QualifyingPhase {
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

function processFrame(
  prev: Frame | null,
  curr: Frame,
  state: QualifyingState,
): QualifyingState {
  if (!prev) return state;

  let next = { ...state };

  // Session reset detection (lap number rewind)
  if (curr.currentLapNum < prev.currentLapNum - 1) {
    return { ...INITIAL_STATE };
  }

  // ── Pit transitions ──
  const wasPitting = prev.pitStatus !== 0;
  const isPitting = curr.pitStatus !== 0;

  if (!wasPitting && isPitting) {
    // Entered pit
    next.phase = 'PIT';
    next.consecutivePushLaps = 0;
    next.invalidatedAtSector = null;
    return next;
  }

  if (wasPitting && !isPitting) {
    // Exited pit → OUT lap
    next.phase = 'OUT';
    next.attemptNumber += 1;
    next.consecutivePushLaps = 0;
    next.invalidatedAtSector = null;
    return next;
  }

  // If in pit, stay in pit
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
        // Bootstrap: first lap boundary — assume OUT→FLYING
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

// ── Hook ──

export function useQualifyingState(
  driver: DriverInfo | null,
  lapInvalid: boolean,
  isQualifying: boolean,
): QualifyingState {
  const [state, setState] = useState<QualifyingState>(INITIAL_STATE);
  const prevFrameRef = useRef<Frame | null>(null);

  useEffect(() => {
    if (!isQualifying || !driver) {
      prevFrameRef.current = null;
      setState(INITIAL_STATE);
      return;
    }

    const curr: Frame = { ...extractFrame(driver), lapInvalid };

    setState((prev) => {
      const next = processFrame(prevFrameRef.current, curr, prev);
      prevFrameRef.current = curr;
      return next;
    });
  }, [driver, lapInvalid, isQualifying]);

  return state;
}
