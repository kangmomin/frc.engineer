import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../types/telemetry';
import { codeFromDriverName, deriveDriverCodes } from './driverCodes';

function makeDriver(index: number, name: string): DriverInfo {
  return {
    index,
    name,
    teamId: 0,
    aiControlled: false,
    position: index + 1,
    currentLapNum: 1,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 0,
    bestLapTime: 0,
    tireCompound: 'medium',
    tireAge: 0,
    tireWear: [],
    tireSurfaceTemp: [],
    tireInnerTemp: [],
    brakeTemp: [],
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
    sector1TimeMs: 0,
    sector2TimeMs: 0,
    currentSector: 0,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 0,
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
  };
}

describe('deriveDriverCodes', () => {
  it('uses the last name token, uppercased, first 3 chars (family name)', () => {
    const codes = deriveDriverCodes([makeDriver(0, 'Max Verstappen')]);
    expect(codes.get(0)).toBe('VER');
  });

  it('strips punctuation from single-token gamertag-style names', () => {
    const codes = deriveDriverCodes([makeDriver(0, 'xX-Sp33dy-Xx')]);
    expect(codes.get(0)).toBe('XXS');
  });

  it('dedups a base collision to base.slice(0,2) + occurrence number, ordered by index', () => {
    const codes = deriveDriverCodes([
      makeDriver(0, 'Max Verstappen'),
      makeDriver(1, 'Liam Verstappen'),
    ]);
    expect(codes.get(0)).toBe('VER');
    expect(codes.get(1)).toBe('VE2');
  });

  it('dedup order follows driver.index, not array order', () => {
    // index 1이 배열상 먼저 나오지만 index 0이 더 작으므로 base(VER)를 가져간다.
    const codes = deriveDriverCodes([
      makeDriver(1, 'Liam Verstappen'),
      makeDriver(0, 'Max Verstappen'),
    ]);
    expect(codes.get(0)).toBe('VER');
    expect(codes.get(1)).toBe('VE2');
  });

  it('falls back to C{index} (zero-padded) for empty/whitespace-only names', () => {
    const codes = deriveDriverCodes([makeDriver(3, '   ')]);
    expect(codes.get(3)).toBe('C03');
  });
});

describe('codeFromDriverName', () => {
  it('shares the same base-extraction as deriveDriverCodes (FIX-5 — no more divergent impls)', () => {
    expect(codeFromDriverName('Max Verstappen')).toBe('VER');
    expect(codeFromDriverName('xX-Sp33dy-Xx')).toBe('XXS');
  });

  it('does not dedup — every call is independent (no shared occurrence state)', () => {
    expect(codeFromDriverName('Max Verstappen')).toBe('VER');
    expect(codeFromDriverName('Liam Verstappen')).toBe('VER');
  });

  it('falls back to a dash for empty/whitespace-only names (no index available for C{index})', () => {
    expect(codeFromDriverName('   ')).toBe('—');
    expect(codeFromDriverName('')).toBe('—');
  });
});
