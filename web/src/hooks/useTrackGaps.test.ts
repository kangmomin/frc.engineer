import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../types/telemetry';
import { deriveTrackGaps } from './useTrackGaps';

function driver(index: number, lapDistance: number, values: Partial<DriverInfo> = {}): DriverInfo {
  return { index, lapDistance, pitStatus: 0, driverStatus: 1, resultStatus: 2, ...values } as DriverInfo;
}

describe('physical track neighbors', () => {
  it('uses circuit order independently of classification, best time and completed laps', () => {
    const player = driver(0, 2500, { position: 2, bestLapTime: 90_000, currentLapNum: 5 });
    const ahead = driver(1, 2650, { position: 24, bestLapTime: 0, currentLapNum: 1, driverStatus: 3 });
    const behind = driver(2, 2300, { position: 1, bestLapTime: 70_000, currentLapNum: 9 });
    const drivers = [ahead, player, behind];
    const gap = deriveTrackGaps(drivers, 5000, 0);
    expect(gap).toEqual({ available: true, aheadDriver: ahead, behindDriver: behind, gapAheadM: 150, gapBehindM: 200 });
    expect(drivers).toEqual([ahead, player, behind]);
  });

  it('wraps both directions over the line and normalizes before sorting', () => {
    const nearLine = driver(1, 4950);
    const afterLine = driver(2, 100);
    const gap = deriveTrackGaps([driver(0, -100, { driverStatus: 3 }), afterLine, nearLine], 5000, 0);
    expect(gap.aheadDriver).toBe(nearLine);
    expect(gap.gapAheadM).toBe(50);
    expect(gap.behindDriver).toBe(afterLine);
    expect(gap.gapBehindM).toBe(4800);

    const crossed = deriveTrackGaps([driver(0, 5010), driver(1, 20), nearLine], 5000, 0);
    expect(crossed.gapAheadM).toBe(10);
    expect(crossed.gapBehindM).toBe(60);
  });

  it.each<Partial<DriverInfo>>([
    { pitStatus: 1 }, { pitStatus: 2 }, { driverStatus: 0 }, { driverStatus: undefined },
    { resultStatus: 1 }, { resultStatus: 4 }, { resultStatus: 5 }, { resultStatus: 6 }, { resultStatus: 7 },
    { lapDistance: NaN }, { lapDistance: Infinity }, { lapDistance: undefined },
  ])('excludes a closer car that is unavailable or off the circuit: %j', (values) => {
    const valid = driver(1, 1200);
    const invalid = driver(2, 1010, values);
    const gap = deriveTrackGaps([driver(0, 1000), invalid, valid], 5000, 0);
    expect(gap.aheadDriver).toBe(valid);
    expect(gap.behindDriver).toBe(valid);
    expect(deriveTrackGaps([invalid, valid], 5000, 2).available).toBe(false);
  });

  it.each<Partial<DriverInfo>>([
    { driverStatus: 1 }, { driverStatus: 2 }, { driverStatus: 3 }, { driverStatus: 4 },
    { driverStatus: 2, resultStatus: 3 }, { resultStatus: 0 }, { resultStatus: undefined }, { lapInvalid: true },
  ])('retains a car physically on the circuit: %j', (values) => {
    const other = driver(1, 1100, values);
    expect(deriveTrackGaps([driver(0, 1000), other], 5000, 0).aheadDriver).toBe(other);
  });

  it('shows the same opponent in both directions when only two cars are on the circuit', () => {
    const other = driver(1, 1750);
    expect(deriveTrackGaps([driver(0, 1000), other], 5000, 0)).toEqual({
      available: true, aheadDriver: other, behindDriver: other, gapAheadM: 750, gapBehindM: 4250,
    });
  });

  it('distinguishes an empty circuit around the player from missing player/track data', () => {
    const player = driver(0, 1000);
    const solo = deriveTrackGaps([player, driver(1, 1010, { driverStatus: undefined })], 5000, 0);
    expect(solo).toEqual({ available: true, aheadDriver: null, behindDriver: null, gapAheadM: null, gapBehindM: null });
    expect(deriveTrackGaps([], 5000, 0).available).toBe(false);
    expect(deriveTrackGaps([player], 5000, 255).available).toBe(false);
    for (const length of [0, -1, NaN, Infinity]) {
      expect(deriveTrackGaps([player], length, 0).available).toBe(false);
    }
  });

  it('handles a 24-car field and changes the reference car without stale neighbors', () => {
    const drivers = Array.from({ length: 24 }, (_, i) => driver(i, i * 100, { position: 24 - i }));
    const first = deriveTrackGaps(drivers, 5000, 11);
    expect([first.aheadDriver?.index, first.behindDriver?.index]).toEqual([12, 10]);
    const last = deriveTrackGaps(drivers, 5000, 23);
    expect([last.aheadDriver?.index, last.behindDriver?.index]).toEqual([0, 22]);
    expect(last.gapAheadM).toBe(2700);
  });

  it('keeps coincident positions deterministic without inventing a nonzero gap', () => {
    const drivers = [driver(2, 100), driver(0, 100), driver(1, 100)];
    const gap = deriveTrackGaps(drivers, 5000, 1);
    expect([gap.aheadDriver?.index, gap.behindDriver?.index]).toEqual([2, 0]);
    expect([gap.gapAheadM, gap.gapBehindM]).toEqual([0, 0]);
  });
});
