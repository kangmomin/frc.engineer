import { describe, expect, it } from 'vitest';
import type { DriverInfo, SessionInfo } from '../types/telemetry';
import {
  driverCanArmDrs,
  formatGapToLeader,
  formatInterval,
  getRaceStatus,
} from './raceDisplay';

// ── Helpers ──

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0,
    name: 'Test Driver',
    teamId: 0,
    aiControlled: false,
    position: 2,
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
    ...overrides,
  };
}

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

// ── Tests ──

describe('getRaceStatus', () => {
  it('returns info/— when there is no session', () => {
    expect(getRaceStatus(null)).toEqual({ label: '—', tone: 'info' });
  });

  it('formation outranks a red-flag marshal zone', () => {
    const session = makeSession({
      safetyCar: 'formation',
      marshalZones: [{ start: 0, flag: 4 }],
    });
    expect(getRaceStatus(session).tone).toBe('formation');
  });

  it('red flag when any marshal zone flag is 4', () => {
    const session = makeSession({ safetyCar: 'none', marshalZones: [{ start: 0.1, flag: 4 }] });
    expect(getRaceStatus(session).tone).toBe('red');
  });

  it('safety car (full)', () => {
    expect(getRaceStatus(makeSession({ safetyCar: 'full' })).tone).toBe('safety');
  });

  it('vsc for any virtual* value', () => {
    expect(getRaceStatus(makeSession({ safetyCar: 'virtual' })).tone).toBe('vsc');
    expect(getRaceStatus(makeSession({ safetyCar: 'virtual_ending' })).tone).toBe('vsc');
  });

  it('green otherwise', () => {
    expect(getRaceStatus(makeSession({ safetyCar: 'none' })).tone).toBe('green');
  });
});

describe('formatInterval', () => {
  it('leader shows —', () => {
    expect(formatInterval(makeDriver(), true)).toBe('—');
  });

  it('pit shows PIT regardless of gap', () => {
    expect(formatInterval(makeDriver({ pitStatus: 1, deltaToCarInFront: 500 }), false)).toBe('PIT');
  });

  it('undefined gap shows —', () => {
    expect(formatInterval(makeDriver({ deltaToCarInFront: undefined }), false)).toBe('—');
  });

  it('non-positive gap shows —', () => {
    expect(formatInterval(makeDriver({ deltaToCarInFront: 0 }), false)).toBe('—');
  });

  it('formats a positive gap to one decimal', () => {
    expect(formatInterval(makeDriver({ deltaToCarInFront: 1234 }), false)).toBe('+1.2');
  });
});

describe('formatGapToLeader', () => {
  it('leader shows LEADER', () => {
    expect(formatGapToLeader(makeDriver(), true)).toBe('LEADER');
  });

  it('undefined delta shows —', () => {
    expect(formatGapToLeader(makeDriver({ deltaToRaceLeader: undefined }), false)).toBe('—');
  });

  it('formats the gap to one decimal', () => {
    expect(formatGapToLeader(makeDriver({ deltaToRaceLeader: 5678 }), false)).toBe('+5.7');
  });
});

describe('driverCanArmDrs', () => {
  it('2025: true at exactly the 1000ms threshold', () => {
    expect(driverCanArmDrs(makeDriver({ deltaToCarInFront: 1000 }), false)).toBe(true);
  });

  it('2025: false above the 1000ms threshold', () => {
    expect(driverCanArmDrs(makeDriver({ deltaToCarInFront: 1001 }), false)).toBe(false);
  });

  it('2025: false when the gap is undefined', () => {
    expect(driverCanArmDrs(makeDriver({ deltaToCarInFront: undefined }), false)).toBe(false);
  });

  it('2026: follows the overtakeAvailable flag, ignoring gap', () => {
    expect(driverCanArmDrs(makeDriver({ overtakeAvailable: true, deltaToCarInFront: 5000 }), true)).toBe(true);
    expect(driverCanArmDrs(makeDriver({ overtakeAvailable: false, deltaToCarInFront: 10 }), true)).toBe(false);
    expect(driverCanArmDrs(makeDriver({ deltaToCarInFront: 10 }), true)).toBe(false);
  });
});
