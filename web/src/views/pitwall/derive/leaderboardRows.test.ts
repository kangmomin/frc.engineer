import { describe, expect, it } from 'vitest';
import type { CarDamage, DriverInfo, SessionInfo } from '../../../types/telemetry';
import {
  codeFromName,
  damageTone,
  deriveLeaderboardRows,
  deriveSectorCells,
  derivePenaltyBadge,
  driverHasDrs,
  getDamageSummaryItems,
  getDriverRowTone,
  getDrsTone,
  getPitStatusTone,
} from './leaderboardRows';

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

// ── codeFromName ──

describe('codeFromName', () => {
  it('takes last token, uppercased, sliced to 3 chars', () => {
    expect(codeFromName('Lewis Hamilton')).toBe('HAM');
  });
  it('single-word name slices to 3 chars', () => {
    expect(codeFromName('Verstappen')).toBe('VER');
  });
  it('empty name falls back to P{index}', () => {
    expect(codeFromName('', 7)).toBe('P7');
  });
  it('empty name with no index falls back to placeholder', () => {
    expect(codeFromName('')).toBe('---');
  });
});

// ── getDamageSummaryItems / damageTone ──

describe('getDamageSummaryItems', () => {
  it('maps FL/FR/RW directly and OTH as max(floor,diffuser,sidepod)', () => {
    const d = makeDriver({ damage: makeDamage({ frontLeftWing: 5, frontRightWing: 8, rearWing: 3, floor: 12, diffuser: 40, sidepod: 6 }) });
    expect(getDamageSummaryItems(d)).toEqual([
      { label: 'FL', value: 5 },
      { label: 'FR', value: 8 },
      { label: 'RW', value: 3 },
      { label: 'OTH', value: 40 },
    ]);
  });
  it('defaults to 0 when damage is undefined', () => {
    expect(getDamageSummaryItems(null)).toEqual([
      { label: 'FL', value: 0 },
      { label: 'FR', value: 0 },
      { label: 'RW', value: 0 },
      { label: 'OTH', value: 0 },
    ]);
  });
});

describe('damageTone', () => {
  it('wing part uses WING threshold(10)', () => {
    expect(damageTone(0, 'FL')).toBe('var(--text-muted)');
    expect(damageTone(5, 'FL')).toBe('var(--accent-soft)');
    expect(damageTone(10, 'FL')).toBe('var(--accent-red)');
  });
  it('body part(OTH) uses BODY threshold(20)', () => {
    expect(damageTone(15, 'OTH')).toBe('var(--accent-soft)');
    expect(damageTone(20, 'OTH')).toBe('var(--accent-red)');
  });
});

// ── DRS ──

describe('driverHasDrs / getDrsTone', () => {
  it('2025: drsActivated true → active', () => {
    const d = makeDriver({ drsActivated: true });
    expect(driverHasDrs(d, false)).toBe(true);
    expect(getDrsTone(d, false)).toBe('drsActive');
  });
  it('2025: within 1s of car in front → armed', () => {
    const d = makeDriver({ drsActivated: false, deltaToCarInFront: 800 });
    expect(getDrsTone(d, false)).toBe('drsArmed');
  });
  it('2025: no delta data → inactive', () => {
    const d = makeDriver({ drsActivated: false });
    expect(getDrsTone(d, false)).toBe('drsInactive');
  });
  it('2026: overtakeActive true → active regardless of drsActivated', () => {
    const d = makeDriver({ overtakeActive: true, drsActivated: false });
    expect(getDrsTone(d, true)).toBe('drsActive');
  });
  it('2026: overtakeAvailable true (not active) → armed', () => {
    const d = makeDriver({ overtakeActive: false, overtakeAvailable: true });
    expect(getDrsTone(d, true)).toBe('drsArmed');
  });
});

// ── Pit ──

describe('getPitStatusTone', () => {
  it('pitStatus > 0 → pitActive', () => {
    expect(getPitStatusTone(makeDriver({ pitStatus: 1 }))).toBe('pitActive');
  });
  it('pitStatus === 0 → pitInactive', () => {
    expect(getPitStatusTone(makeDriver({ pitStatus: 0 }))).toBe('pitInactive');
  });
});

// ── Row tone priority ──

describe('getDriverRowTone', () => {
  it('player row takes priority over leader/team', () => {
    const player = makeDriver({ index: 1, position: 1, teamId: 5 });
    const driver = makeDriver({ index: 1, position: 1, teamId: 5 });
    expect(getDriverRowTone(driver, player)).toBe('playerRow');
  });
  it('leader row takes priority over team row when not player', () => {
    const player = makeDriver({ index: 1, position: 3, teamId: 5 });
    const leaderTeammate = makeDriver({ index: 2, position: 1, teamId: 5 });
    expect(getDriverRowTone(leaderTeammate, player)).toBe('leaderRow');
  });
  it('team row when same teamId, not leader, not player', () => {
    const player = makeDriver({ index: 1, position: 3, teamId: 5 });
    const teammate = makeDriver({ index: 2, position: 4, teamId: 5 });
    expect(getDriverRowTone(teammate, player)).toBe('teamRow');
  });
  it('empty when no relation and no player', () => {
    const driver = makeDriver({ index: 2, position: 4, teamId: 5 });
    expect(getDriverRowTone(driver, null)).toBe('');
  });
});

// ── Penalty badge ──

describe('derivePenaltyBadge', () => {
  it('stop-go takes top priority', () => {
    const d = makeDriver({ numUnservedStopGoPenalties: 1, numUnservedDriveThroughs: 1, penalties: 5, totalWarnings: 2 });
    expect(derivePenaltyBadge(d).label).toBe('SG');
  });
  it('drive-through next', () => {
    const d = makeDriver({ numUnservedDriveThroughs: 1, penalties: 5, totalWarnings: 2 });
    expect(derivePenaltyBadge(d).label).toBe('DT');
  });
  it('time penalty next', () => {
    const d = makeDriver({ penalties: 5, totalWarnings: 2 });
    expect(derivePenaltyBadge(d).label).toBe('+5');
  });
  it('warning last', () => {
    const d = makeDriver({ totalWarnings: 2 });
    expect(derivePenaltyBadge(d).label).toBe('2W');
  });
  it('none → dash', () => {
    expect(derivePenaltyBadge(makeDriver()).label).toBe('—');
  });
});

// ── Sector cells ──

describe('deriveSectorCells', () => {
  it('S1 shows "·" while still in sector 1', () => {
    const d = makeDriver({ currentSector: 1, sector1TimeMs: 0 });
    expect(deriveSectorCells(d, null).s1.text).toBe('·');
  });
  it('S1 shows formatted time once currentSector advances past 1', () => {
    const d = makeDriver({ currentSector: 2, sector1TimeMs: 28123 });
    expect(deriveSectorCells(d, null).s1.text).toBe('28.123');
  });
  it('S2 requires currentSector >= 3', () => {
    const d = makeDriver({ currentSector: 2, sector2TimeMs: 30000 });
    expect(deriveSectorCells(d, null).s2.text).toBe('·');
  });
  it('S3 derives from lastLap - s1 - s2 when positive', () => {
    const d = makeDriver({ lastLapTime: 90000, sector1TimeMs: 28000, sector2TimeMs: 32000 });
    expect(deriveSectorCells(d, null).s3.text).toBe('30.000');
  });
  it('S3 degrades to dash when subtraction is non-positive', () => {
    const d = makeDriver({ lastLapTime: 90000, sector1TimeMs: 50000, sector2TimeMs: 50000 });
    expect(deriveSectorCells(d, null).s3.text).toBe('—');
  });
  it('yellow flag zone overrides personal-best tone', () => {
    const d = makeDriver({ currentSector: 2, sector1TimeMs: 28000, bestSector1Ms: 27000 });
    const session = makeSession({ marshalZones: [{ start: 0, flag: 3 }] });
    expect(deriveSectorCells(d, session).s1.color).toBe('#eab308');
  });
});

// ── Full row assembly ──

describe('deriveLeaderboardRows', () => {
  it('marks the fastest lap in the field with purple', () => {
    const a = makeDriver({ index: 0, position: 1, lastLapTime: 90000 });
    const b = makeDriver({ index: 1, position: 2, lastLapTime: 89000 });
    const rows = deriveLeaderboardRows([a, b], null, false, null);
    expect(rows[1].lastColor).toBe('var(--sector-purple)');
    expect(rows[0].lastColor).not.toBe('var(--sector-purple)');
  });
  it('player row shows YOU in the gap column', () => {
    const player = makeDriver({ index: 3, position: 2 });
    const rival = makeDriver({ index: 4, position: 1 });
    const rows = deriveLeaderboardRows([rival, player], player, false, null);
    const playerRow = rows.find((r) => r.index === 3)!;
    expect(playerRow.toYou).toBe('YOU');
    expect(playerRow.rowBg).toBe('rgba(0,229,255,.13)');
  });
  it('missing deltaToPlayer degrades to dash, not 0.000', () => {
    const player = makeDriver({ index: 3, position: 1 });
    const other = makeDriver({ index: 4, position: 2, deltaToPlayer: undefined });
    const rows = deriveLeaderboardRows([player, other], player, false, null);
    const otherRow = rows.find((r) => r.index === 4)!;
    expect(otherRow.toYou).toBe('—');
  });
  it('lastLap of 0 degrades to placeholder, not 0.000', () => {
    const d = makeDriver({ index: 0, position: 1, lastLapTime: 0 });
    const rows = deriveLeaderboardRows([d], null, false, null);
    expect(rows[0].lastLap).toBe('--:--.---');
  });
  it('vmax of 0 degrades to dash', () => {
    const d = makeDriver({ index: 0, position: 1, topSpeed: 0 });
    const rows = deriveLeaderboardRows([d], null, false, null);
    expect(rows[0].vmax).toBe('—');
  });
});
