import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../../types/telemetry';
import { evaluateDriverTryState } from './tryStatus';

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0,
    name: 'Driver',
    teamId: 0,
    aiControlled: false,
    position: 1,
    currentLapNum: 3,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 80_500,
    bestLapTime: 80_000,
    tireCompound: 'soft',
    tireAge: 0,
    tireWear: [0, 0, 0, 0],
    tireSurfaceTemp: [0, 0, 0, 0],
    tireInnerTemp: [0, 0, 0, 0],
    brakeTemp: [0, 0, 0, 0],
    brakeBias: 0,
    diffOnThrottle: 0,
    diffOffThrottle: 0,
    fuelInTank: 0,
    fuelRemainingLaps: 0,
    fuelMix: 0,
    ersStoreEnergy: 0,
    ersDeployMode: 0,
    ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0,
    ersEstimatePct: 0,
    ersEstimateReady: false,
    ersActualPct: 55,
    ersActualReady: true,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 1,
    resultStatus: 2,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
    sector1TimeMs: 26_950,
    sector2TimeMs: 0,
    currentSector: 1,
    ...overrides,
  };
}

describe('evaluateDriverTryState', () => {
  it('marks a flying lap with strong push signals as TRY', () => {
    const state = evaluateDriverTryState(
      makeDriver({
        drsActivated: true,
        ersDeployMode: 2,
        ersDeployedThisLap: 380_000,
        ersHarvestedThisLap: 110_000,
      }),
      { s1: 27_080, s2: 28_300, s3: 25_600 },
    );

    expect(state.label).toBe('TRY');
    expect(state.summary).toContain('Flying');
    expect(state.summary).toContain('S1 -0.130');
  });

  it('marks an out lap as BUILD instead of TRY', () => {
    const state = evaluateDriverTryState(
      makeDriver({
        driverStatus: 3,
        ersDeployMode: 2,
        sector1TimeMs: 0,
        sector2TimeMs: 0,
      }),
      { s1: 0, s2: 0, s3: 0 },
    );

    expect(state.label).toBe('BUILD');
    expect(state.summary).toContain('Out lap');
  });

  it('marks invalid laps as COOL even when other signals exist', () => {
    const state = evaluateDriverTryState(
      makeDriver({
        lapInvalid: true,
        drsActivated: true,
        ersDeployMode: 3,
      }),
      { s1: 27_100, s2: 28_250, s3: 25_700 },
    );

    expect(state.label).toBe('COOL');
    expect(state.summary).toBe('Lap invalid');
  });

  it('marks double-competitive sector pace as TRY without DRS', () => {
    const state = evaluateDriverTryState(
      makeDriver({
        driverStatus: 4,
        sector1TimeMs: 27_020,
        sector2TimeMs: 28_180,
        currentSector: 2,
        ersDeployMode: 1,
      }),
      { s1: 27_100, s2: 28_300, s3: 25_700 },
    );

    expect(state.label).toBe('TRY');
    expect(state.sectorDelta1Ms).toBe(-80);
    expect(state.sectorDelta2Ms).toBe(-120);
  });
});
