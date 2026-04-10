import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../../types/telemetry';
import { sortQualifyingDrivers } from './leaderboardOrder';

function makeDriver(overrides: Partial<DriverInfo>): DriverInfo {
  return {
    index: 0,
    name: 'Driver',
    teamId: 0,
    aiControlled: false,
    position: 0,
    currentLapNum: 0,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 0,
    bestLapTime: 0,
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
    ersActualPct: 0,
    ersActualReady: false,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 0,
    resultStatus: 2,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
    sector1TimeMs: 0,
    sector2TimeMs: 0,
    currentSector: 0,
    ...overrides,
  };
}

describe('sortQualifyingDrivers', () => {
  it('keeps knocked-out Q2 drivers at the bottom', () => {
    const sorted = sortQualifyingDrivers([
      makeDriver({ index: 0, position: 16, bestLapTime: 81_000 }),
      makeDriver({ index: 1, position: 15, bestLapTime: 82_500 }),
      makeDriver({ index: 2, position: 3, bestLapTime: 80_500 }),
    ], 'Q2');

    expect(sorted.map((driver) => driver.position)).toEqual([3, 15, 16]);
  });

  it('keeps knocked-out Q3 drivers at the bottom in position order', () => {
    const sorted = sortQualifyingDrivers([
      makeDriver({ index: 0, position: 12, bestLapTime: 80_100 }),
      makeDriver({ index: 1, position: 10, bestLapTime: 81_300 }),
      makeDriver({ index: 2, position: 17, bestLapTime: 79_900 }),
      makeDriver({ index: 3, position: 4, bestLapTime: 79_800 }),
    ], 'Q3');

    expect(sorted.map((driver) => driver.position)).toEqual([4, 10, 12, 17]);
  });

  it('pushes drivers with unknown best laps to the very bottom', () => {
    const sorted = sortQualifyingDrivers([
      makeDriver({ index: 0, position: 16, bestLapTime: 81_000 }),
      makeDriver({ index: 1, position: 8, bestLapTime: 0 }),
      makeDriver({ index: 2, position: 10, bestLapTime: 80_700 }),
      makeDriver({ index: 3, position: 17, bestLapTime: 79_900 }),
    ], 'Q2');

    expect(sorted.map((driver) => driver.position)).toEqual([10, 16, 17, 8]);
  });

  it('falls back to best-lap ordering outside knockout sessions', () => {
    const sorted = sortQualifyingDrivers([
      makeDriver({ index: 0, position: 5, bestLapTime: 82_100 }),
      makeDriver({ index: 1, position: 18, bestLapTime: 81_400 }),
      makeDriver({ index: 2, position: 2, bestLapTime: 80_900 }),
    ], 'Q1');

    expect(sorted.map((driver) => driver.position)).toEqual([2, 18, 5]);
  });
});
