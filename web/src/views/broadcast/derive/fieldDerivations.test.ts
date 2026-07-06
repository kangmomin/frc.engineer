import { describe, expect, it } from 'vitest';
import type { CarDamage, DriverInfo, SessionInfo } from '../../../types/telemetry';
import {
  classifyIssue,
  deriveDriverIssue,
  deriveFastestLap,
  deriveFieldStatus,
  deriveLapCounter,
  deriveRainRisk,
  isDamaged,
} from './fieldDerivations';

// ── Helpers ──

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0,
    name: 'Test Driver',
    teamId: 0,
    aiControlled: false,
    position: 1,
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

function makeDamage(overrides: Partial<CarDamage> = {}): CarDamage {
  return {
    frontLeftWing: 0,
    frontRightWing: 0,
    rearWing: 0,
    floor: 0,
    diffuser: 0,
    sidepod: 0,
    engine: 0,
    gearbox: 0,
    drsFault: false,
    ersFault: false,
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

describe('isDamaged', () => {
  it('false when damage is undefined', () => {
    expect(isDamaged(makeDriver())).toBe(false);
  });

  it('true when a wing is >= 10', () => {
    expect(isDamaged(makeDriver({ damage: makeDamage({ frontLeftWing: 10 }) }))).toBe(true);
  });

  it('false when wing damage is below the threshold', () => {
    expect(isDamaged(makeDriver({ damage: makeDamage({ frontLeftWing: 9 }) }))).toBe(false);
  });

  it('true when floor/diffuser/sidepod is >= 20', () => {
    expect(isDamaged(makeDriver({ damage: makeDamage({ floor: 20 }) }))).toBe(true);
    expect(isDamaged(makeDriver({ damage: makeDamage({ sidepod: 19 }) }))).toBe(false);
  });

  it('true when engine/gearbox is >= 30', () => {
    expect(isDamaged(makeDriver({ damage: makeDamage({ gearbox: 30 }) }))).toBe(true);
  });

  it('true when drsFault or ersFault is set regardless of numeric damage', () => {
    expect(isDamaged(makeDriver({ damage: makeDamage({ drsFault: true }) }))).toBe(true);
    expect(isDamaged(makeDriver({ damage: makeDamage({ ersFault: true }) }))).toBe(true);
  });
});

describe('deriveDriverIssue', () => {
  it('prioritises pit over penalty and damage', () => {
    const d = makeDriver({ pitStatus: 1, penalties: 1, damage: makeDamage({ engine: 50 }) });
    expect(deriveDriverIssue(d)).toBe('pit');
  });

  it('prioritises penalty over damage', () => {
    const d = makeDriver({ penalties: 1, damage: makeDamage({ engine: 50 }) });
    expect(deriveDriverIssue(d)).toBe('penalty');
  });

  it('treats unserved drive-through/stop-go as a penalty', () => {
    expect(deriveDriverIssue(makeDriver({ numUnservedDriveThroughs: 1 }))).toBe('penalty');
    expect(deriveDriverIssue(makeDriver({ numUnservedStopGoPenalties: 1 }))).toBe('penalty');
  });

  it('falls back to damage', () => {
    expect(deriveDriverIssue(makeDriver({ damage: makeDamage({ rearWing: 15 }) }))).toBe('damage');
  });

  it('null when clean', () => {
    expect(deriveDriverIssue(makeDriver())).toBeNull();
  });
});

describe('deriveFieldStatus', () => {
  it('aggregates pitted/inPit/damaged/tyre counts', () => {
    const drivers = [
      makeDriver({ index: 0, numPitStops: 1, pitStatus: 0, tireCompound: 'soft' }),
      makeDriver({ index: 1, numPitStops: 0, pitStatus: 1, tireCompound: 'medium' }),
      makeDriver({ index: 2, damage: makeDamage({ gearbox: 40 }), tireCompound: 'hard' }),
      makeDriver({ index: 3, tireCompound: 'not-a-real-compound' }),
    ];
    const status = deriveFieldStatus(drivers);
    expect(status.fieldSize).toBe(4);
    expect(status.pittedCount).toBe(1);
    expect(status.inPitNow).toBe(1);
    expect(status.damagedCount).toBe(1);
    expect(status.tyreCounts).toEqual({ S: 1, M: 1, H: 1, I: 0, W: 0, '?': 1 });
  });
});

describe('deriveFastestLap', () => {
  it('null when no driver has a valid best lap', () => {
    expect(deriveFastestLap([makeDriver({ bestLapTime: 0 })])).toBeNull();
  });

  it('returns the driver with the smallest positive bestLapTime', () => {
    const drivers = [
      makeDriver({ index: 0, bestLapTime: 90000 }),
      makeDriver({ index: 1, bestLapTime: 88500 }),
      makeDriver({ index: 2, bestLapTime: 0 }),
    ];
    expect(deriveFastestLap(drivers)).toEqual({ driverIndex: 1, timeMs: 88500 });
  });
});

describe('deriveLapCounter', () => {
  it('uses P1 currentLapNum and lapDistance/trackLength for progress', () => {
    const session = makeSession({ totalLaps: 50, trackLength: 5000 });
    const drivers = [
      makeDriver({ index: 0, position: 1, currentLapNum: 10, lapDistance: 2500 }),
      makeDriver({ index: 1, position: 2, currentLapNum: 9 }),
    ];
    const result = deriveLapCounter(drivers, session);
    expect(result.leaderLap).toBe(10);
    expect(result.displayLap).toBe(10);
    expect(result.totalLaps).toBe(50);
    expect(result.toGo).toBe(40);
    expect(result.progressPct).toBeCloseTo(19, 5);
  });

  it('falls back to the max currentLapNum when no driver is P1', () => {
    const drivers = [makeDriver({ index: 0, position: 0, currentLapNum: 3 })];
    const result = deriveLapCounter(drivers, makeSession({ totalLaps: 50 }));
    expect(result.leaderLap).toBe(3);
  });

  it('clamps toGo/progressPct at the finish even if currentLapNum overshoots totalLaps', () => {
    const session = makeSession({ totalLaps: 50, trackLength: 5000 });
    const drivers = [makeDriver({ index: 0, position: 1, currentLapNum: 51, lapDistance: 0 })];
    const result = deriveLapCounter(drivers, session);
    expect(result.leaderLap).toBe(51);
    expect(result.displayLap).toBe(51);
    expect(result.toGo).toBe(0);
    expect(result.progressPct).toBe(100);
  });
});

describe('classifyIssue', () => {
  it('flags drive-through/stop-go/penalty text as red', () => {
    expect(classifyIssue('Drive-through penalty for Car 1', 'warning')).toBe('red');
    expect(classifyIssue('Stop go penalty served', 'info')).toBe('red');
  });

  it('flags collision/contact text as soft', () => {
    expect(classifyIssue('Collision between car 1 and car 2', 'info')).toBe('soft');
  });

  it('flags track-limits/corner-cutting text as muted', () => {
    expect(classifyIssue('Track limits warning for Car 3', 'info')).toBe('muted');
  });

  it('falls back to severity when no keyword matches', () => {
    expect(classifyIssue('Session started', 'critical')).toBe('red');
    expect(classifyIssue('Session started', 'warning')).toBe('soft');
    expect(classifyIssue('Session started', 'info')).toBe('cyan');
  });
});

describe('deriveRainRisk', () => {
  it('null when there is no forecast', () => {
    expect(deriveRainRisk(makeSession({ weatherForecast: undefined }))).toBeNull();
  });

  it('picks the max rainPercentage among entries within 30 minutes', () => {
    const session = makeSession({
      weatherForecast: [
        { sessionType: 'Race', timeOffset: 5, weather: 'light_rain', trackTemp: 30, trackTempChange: 0, airTemp: 20, airTempChange: 0, rainPercentage: 40 },
        { sessionType: 'Race', timeOffset: 20, weather: 'heavy_rain', trackTemp: 30, trackTempChange: 0, airTemp: 20, airTempChange: 0, rainPercentage: 80 },
        { sessionType: 'Race', timeOffset: 45, weather: 'storm', trackTemp: 30, trackTempChange: 0, airTemp: 20, airTempChange: 0, rainPercentage: 100 },
      ],
    });
    expect(deriveRainRisk(session)).toEqual({ pct: 80, minutes: 20 });
  });
});
