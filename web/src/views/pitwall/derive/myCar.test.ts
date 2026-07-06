import { describe, expect, it } from 'vitest';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { deriveMyCar, formatAheadGap, formatBattlePace, formatBehindGap } from './myCar';

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

describe('formatAheadGap', () => {
  it('formats positive deltaToCarInFront with a leading minus', () => {
    expect(formatAheadGap(makeDriver({ deltaToCarInFront: 3700 }))).toBe('-3.70s');
  });
  it('degrades to dash when missing or non-positive', () => {
    expect(formatAheadGap(makeDriver({ deltaToCarInFront: undefined }))).toBe('—');
    expect(formatAheadGap(makeDriver({ deltaToCarInFront: 0 }))).toBe('—');
  });
});

describe('formatBehindGap', () => {
  it('formats positive deltaToCarInFront with a leading plus', () => {
    expect(formatBehindGap(makeDriver({ deltaToCarInFront: 1200 }))).toBe('+1.20s');
  });
  it('degrades to dash when missing', () => {
    expect(formatBehindGap(null)).toBe('—');
  });
});

describe('formatBattlePace', () => {
  it('ahead side: player faster than rival is negative-signless with s suffix', () => {
    const player = makeDriver({ lastLapTime: 90000 });
    const rival = makeDriver({ lastLapTime: 91000 });
    expect(formatBattlePace(player, rival, 'ahead')).toBe('-1.00s');
  });
  it('degrades to dash when either lap time is 0', () => {
    const player = makeDriver({ lastLapTime: 0 });
    const rival = makeDriver({ lastLapTime: 91000 });
    expect(formatBattlePace(player, rival, 'ahead')).toBe('—');
  });
});

describe('deriveMyCar', () => {
  it('returns null when player is null', () => {
    expect(deriveMyCar(null, [], null)).toBeNull();
  });

  it('assembles ahead/behind codes and gaps from sorted field', () => {
    const ahead = makeDriver({ index: 0, name: 'Max Verstappen', position: 1, lastLapTime: 90000 });
    const player = makeDriver({ index: 1, name: 'Lewis Hamilton', position: 2, lastLapTime: 91000, deltaToCarInFront: 1500 });
    const behind = makeDriver({ index: 2, name: 'Charles Leclerc', position: 3, deltaToCarInFront: 800 });
    const vm = deriveMyCar(player, [ahead, player, behind], null);
    expect(vm?.position).toBe('P2');
    expect(vm?.aheadCode).toBe('VER');
    expect(vm?.gapAhead).toBe('-1.50s');
    expect(vm?.behindCode).toBe('LEC');
    expect(vm?.gapBehind).toBe('+0.80s');
  });

  it('leader (no ahead car) degrades delta tile to dash — deltaPersonalBest does not exist on DriverInfo', () => {
    const player = makeDriver({ index: 0, position: 1 });
    const behind = makeDriver({ index: 1, position: 2 });
    const vm = deriveMyCar(player, [player, behind], null);
    expect(vm?.aheadCode).toBe('—');
    expect(vm?.deltaText).toBe('—');
    expect(vm?.deltaColor).toBe('var(--text-secondary)');
  });

  it('last car in field has no behind car', () => {
    const ahead = makeDriver({ index: 0, position: 1 });
    const player = makeDriver({ index: 1, position: 2 });
    const vm = deriveMyCar(player, [ahead, player], null);
    expect(vm?.behindCode).toBe('—');
    expect(vm?.gapBehind).toBe('—');
  });

  it('pit window hidden when ideal/latest lap missing', () => {
    const player = makeDriver({ index: 0, position: 1 });
    const vm = deriveMyCar(player, [player], makeSession());
    expect(vm?.pitWindow).toBeNull();
  });

  it('pit window shows OPEN when current lap is within range', () => {
    const player = makeDriver({ index: 0, position: 1, currentLapNum: 25 });
    const session = makeSession({ pitStopWindowIdealLap: 24, pitStopWindowLatestLap: 28, pitStopRejoinPosition: 5 });
    const vm = deriveMyCar(player, [player], session);
    expect(vm?.pitWindow?.tone).toBe('open');
    expect(vm?.pitWindow?.title).toBe('PIT WINDOW OPEN');
    expect(vm?.pitWindow?.rejoinText).toBe('Rejoin → P5');
  });

  it('pit window shows UPCOMING before the ideal lap', () => {
    const player = makeDriver({ index: 0, position: 1, currentLapNum: 10 });
    const session = makeSession({ pitStopWindowIdealLap: 24, pitStopWindowLatestLap: 28 });
    const vm = deriveMyCar(player, [player], session);
    expect(vm?.pitWindow?.tone).toBe('upcoming');
  });

  it('pit window shows CLOSED after the latest lap', () => {
    const player = makeDriver({ index: 0, position: 1, currentLapNum: 30 });
    const session = makeSession({ pitStopWindowIdealLap: 24, pitStopWindowLatestLap: 28 });
    const vm = deriveMyCar(player, [player], session);
    expect(vm?.pitWindow?.tone).toBe('closed');
  });

  it('wear prefers tyreSetWear over averaged tireWear[]', () => {
    const player = makeDriver({ index: 0, position: 1, tyreSetWear: 42, tireWear: [10, 10, 10, 10] });
    const vm = deriveMyCar(player, [player], null);
    expect(vm?.wearText).toBe('42%');
  });

  it('wear falls back to averaged tireWear[] when tyreSetWear absent', () => {
    const player = makeDriver({ index: 0, position: 1, tireWear: [20, 20, 30, 30] });
    const vm = deriveMyCar(player, [player], null);
    expect(vm?.wearText).toBe('25%');
  });
});
