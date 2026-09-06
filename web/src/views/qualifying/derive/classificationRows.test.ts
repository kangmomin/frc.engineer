import { describe, expect, it } from 'vitest';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import type { DriverInfo } from '../../../types/telemetry';
import { deriveDriverCodes } from '../../../utils/driverCodes';
import type { SectorAcc } from '../useSectorAccumulator';
import { deriveClassificationRows } from './classificationRows';
import { deriveQualiSegment } from './qualiSegment';

function makeDriver(index: number, overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index,
    name: `Driver ${index}`,
    teamId: 0,
    aiControlled: false,
    position: index + 1,
    currentLapNum: 5,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 91_000,
    bestLapTime: 90_500,
    tireCompound: 'soft',
    tireAge: 3,
    tireWear: [],
    tireSurfaceTemp: [],
    tireInnerTemp: [],
    brakeTemp: [],
    brakeBias: 55,
    diffOnThrottle: 50,
    diffOffThrottle: 50,
    fuelInTank: 10,
    fuelRemainingLaps: 5,
    fuelMix: 2,
    ersStoreEnergy: 2_000_000,
    ersDeployMode: 1,
    ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0,
    ersEstimatePct: 80,
    ersEstimateReady: true,
    ersActualPct: 80,
    ersActualReady: true,
    sector1TimeMs: 30_000,
    sector2TimeMs: 32_000,
    currentSector: 2,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 1,
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: 1200,
    pitStopTimer: 0,
    ...overrides,
  };
}

function makeTryState(overrides: Partial<DriverTryState> = {}): DriverTryState {
  return {
    label: 'TRY',
    tone: 'attack',
    summary: 'S1 -0.120',
    score: 5,
    sectorDelta1Ms: -120,
    sectorDelta2Ms: null,
    ...overrides,
  };
}

const EMPTY_ACC: SectorAcc = { bestS1: 0, bestS2: 0, bestS3: 0 };

describe('deriveClassificationRows — pos/leader/player/drop coloring', () => {
  it('leader is purple, player is cyan, drop-zone is red, else muted', () => {
    const drivers = [makeDriver(0, { position: 1, bestLapTime: 90_000 }), makeDriver(1, { position: 2, bestLapTime: 91_000 })];
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 }); // safeCount=15, both inside safe zone here
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, drivers[1], 90_000, deriveDriverCodes(drivers));

    expect(rows[0].posColor).toBe('var(--sector-purple)'); // leader
    expect(rows[1].posColor).toBe('var(--accent)'); // player (index 1)
    expect(rows[0].isDrop).toBe(false);
  });

  it('player in the drop zone still gets accent posColor — drop cue moves to the border/cutoff line, not the text (a11y #7)', () => {
    // Q1 safeCount=15 — build 16 drivers so position 16 (index 15) is the first drop, and make
    // that driver the player.
    const drivers = Array.from({ length: 16 }, (_, i) => makeDriver(i, { position: i + 1, bestLapTime: 90_000 + i * 100 }));
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const player = drivers[15];
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, player, 90_000, deriveDriverCodes(drivers));

    expect(rows[15].isDrop).toBe(true);
    expect(rows[15].posColor).toBe('var(--accent)'); // player wins over drop for text color (contrast)
    expect(rows[15].accentColor).toBe('var(--accent-red)'); // left border still signals the drop
  });

  it('marks rows below safeCount as drop (red) and flags the first-out row as cutoff mark', () => {
    // Q1 safeCount=15 — build 16 drivers so position 16 is the first drop.
    const drivers = Array.from({ length: 16 }, (_, i) => makeDriver(i, { position: i + 1, bestLapTime: 90_000 + i * 100 }));
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, null, 90_000, deriveDriverCodes(drivers));

    expect(rows[14].isDrop).toBe(false); // P15 safe
    expect(rows[15].isDrop).toBe(true); // P16 dropped
    expect(rows[15].isCutoffMark).toBe(true); // first drop row carries the cutoff marker
    expect(rows[14].isCutoffMark).toBe(false);
  });

  it('Q3 (no cutoff) never marks drop/cutoff regardless of position', () => {
    const drivers = Array.from({ length: 10 }, (_, i) => makeDriver(i, { position: i + 1, bestLapTime: 90_000 + i * 50 }));
    const segment = deriveQualiSegment('Q3', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, null, 90_000, deriveDriverCodes(drivers));
    expect(rows.every((r) => !r.isDrop && !r.isCutoffMark)).toBe(true);
  });
});

describe('deriveClassificationRows — gap column (POLE for leader, dash for no lap)', () => {
  it('leader shows POLE in purple; others show +delta', () => {
    const drivers = [makeDriver(0, { bestLapTime: 90_000 }), makeDriver(1, { bestLapTime: 91_234 })];
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].gap).toBe('POLE');
    expect(rows[0].gapColor).toBe('var(--sector-purple)');
    expect(rows[1].gap).toBe('+1.234');
  });

  it('drivers with no recorded lap show dash, not 0.000/NaN', () => {
    const drivers = [makeDriver(0, { bestLapTime: 90_000 }), makeDriver(1, { bestLapTime: 0, lastLapTime: 0 })];
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, null, 90_000, deriveDriverCodes(drivers));
    expect(rows[1].gap).toBe('—');
    expect(rows[1].best).not.toContain('0.000');
  });

  it('a non-leader tied exactly with the leader shows "+0.000", not an empty string (comp m-6/scope L4)', () => {
    const drivers = [makeDriver(0, { bestLapTime: 90_000 }), makeDriver(1, { bestLapTime: 90_000 })];
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, segment, null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].gap).toBe('POLE');
    expect(rows[1].gap).toBe('+0.000');
  });
});

describe('deriveClassificationRows — sector purple highlight (overall best, no live S3 fabrication)', () => {
  it('a sector equal to the overall best is purple; others are default', () => {
    const drivers = [makeDriver(0), makeDriver(1)];
    const accMap = new Map<number, SectorAcc>([
      [0, { bestS1: 29_500, bestS2: 31_000, bestS3: 28_000 }],
      [1, { bestS1: 29_800, bestS2: 31_000, bestS3: 28_500 }],
    ]);
    const overallBest: SectorAcc = { bestS1: 29_500, bestS2: 31_000, bestS3: 28_000 };
    const segment = deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 });
    const rows = deriveClassificationRows(drivers, accMap, new Map(), overallBest, segment, null, 90_000, deriveDriverCodes(drivers));

    expect(rows[0].s1Color).toBe('var(--sector-purple)');
    expect(rows[0].s2Color).toBe('var(--sector-purple)');
    expect(rows[0].s3Color).toBe('var(--sector-purple)');
    expect(rows[1].s1Color).toBe('var(--text-primary)');
    expect(rows[1].s3Color).toBe('var(--text-primary)');
  });

  it('missing sector data (no accumulator entry) renders dash, not 0.000', () => {
    const drivers = [makeDriver(0)];
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 }), null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].s1).toBe('—');
    expect(rows[0].s2).toBe('—');
    expect(rows[0].s3).toBe('—');
  });
});

describe('deriveClassificationRows — Try/Status columns', () => {
  it('passes through tryMap label/tone and defaults to dash when absent', () => {
    const drivers = [makeDriver(0), makeDriver(1)];
    const tryMap = new Map([[0, makeTryState({ label: 'TRY', tone: 'attack' })]]);
    const rows = deriveClassificationRows(drivers, new Map(), tryMap, EMPTY_ACC, deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 }), null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].tryLabel).toBe('TRY');
    expect(rows[1].tryLabel).toBe('—');
  });

  it('status: PIT takes priority over driverStatus; else FLY/IN/OUT/GAR mapping', () => {
    const drivers = [
      makeDriver(0, { pitStatus: 1, driverStatus: 1 }),
      makeDriver(1, { pitStatus: 0, driverStatus: 1 }),
      makeDriver(2, { pitStatus: 0, driverStatus: 2 }),
      makeDriver(3, { pitStatus: 0, driverStatus: 3 }),
      makeDriver(4, { pitStatus: 0, driverStatus: 0 }),
    ];
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 }), null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].statusLabel).toBe('PIT');
    expect(rows[1].statusLabel).toBe('FLY');
    expect(rows[2].statusLabel).toBe('IN');
    expect(rows[3].statusLabel).toBe('OUT');
    expect(rows[4].statusLabel).toBe('GAR');
  });

  it('driverStatus omitempty-absent (undefined, GARAGE) normalizes to GAR, not dash (M1)', () => {
    const drivers = [makeDriver(0, { pitStatus: 0, driverStatus: undefined })];
    const rows = deriveClassificationRows(drivers, new Map(), new Map(), EMPTY_ACC, deriveQualiSegment('Q1', { formula: 0, qualifyingGridSize: 20 }), null, 90_000, deriveDriverCodes(drivers));
    expect(rows[0].statusLabel).toBe('GAR');
  });
});
