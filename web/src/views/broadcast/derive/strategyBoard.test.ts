import { describe, expect, it } from 'vitest';
import type { CrossoverPrediction, PitwallState, SessionInfo } from '../../../types/telemetry';
import { deriveStrategyBoard } from './strategyBoard';

// ── Helpers ──

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    weather: 'clear',
    trackTemp: 30,
    airTemp: 20,
    safetyCar: 'none',
    sessionType: 'Race',
    totalLaps: 50,
    trackId: 0,
    trackName: 'Test Track',
    trackLength: 5000,
    ...overrides,
  };
}

function makePitwallState(session: SessionInfo | null): PitwallState {
  return {
    session,
    drivers: [],
    positions: [],
    playerIndex: 0,
    ersEstimateEnabled: false,
    ersComparisonEnabled: false,
  };
}

function makeCrossover(overrides: Partial<CrossoverPrediction> = {}): CrossoverPrediction {
  return {
    available: true,
    dryGroup: 'soft',
    wetGroup: 'inter',
    currentDeltaMs: -1200,
    trendDeltaMsPerLap: -30,
    avgLapTimeMs: 90000,
    drySampleCount: 5,
    wetSampleCount: 5,
    historyDepth: 5,
    currentDryAvgMs: 89000,
    currentWetAvgMs: 90200,
    ...overrides,
  };
}

// ── Tests ──

describe('deriveStrategyBoard', () => {
  it('returns all-null when pitwallState is null', () => {
    expect(deriveStrategyBoard(null)).toEqual({
      rejoinPosition: null,
      windowIdealLap: null,
      windowLatestLap: null,
      crossover: null,
    });
  });

  it('returns all-null when the omitempty session fields are absent', () => {
    const state = makePitwallState(makeSession());
    expect(deriveStrategyBoard(state)).toEqual({
      rejoinPosition: null,
      windowIdealLap: null,
      windowLatestLap: null,
      crossover: null,
    });
  });

  it('maps present rejoin/pit-window fields', () => {
    const state = makePitwallState(
      makeSession({
        pitStopRejoinPosition: 7,
        pitStopWindowIdealLap: 22,
        pitStopWindowLatestLap: 28,
      }),
    );
    const result = deriveStrategyBoard(state);
    expect(result.rejoinPosition).toBe(7);
    expect(result.windowIdealLap).toBe(22);
    expect(result.windowLatestLap).toBe(28);
  });

  it('maps crossover only when available is true', () => {
    const unavailable = makePitwallState(
      makeSession({ crossoverPrediction: makeCrossover({ available: false }) }),
    );
    expect(deriveStrategyBoard(unavailable).crossover).toBeNull();

    const available = makePitwallState(
      makeSession({ crossoverPrediction: makeCrossover() }),
    );
    expect(deriveStrategyBoard(available).crossover).toEqual({
      dryGroup: 'soft',
      wetGroup: 'inter',
      deltaMs: -1200,
      trendMsPerLap: -30,
    });
  });
});
