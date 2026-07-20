import { describe, expect, it } from 'vitest';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import { INITIAL_STATE, type QualifyingState } from '../../../hooks/useQualifyingState';
import type { TrackGap } from '../../../hooks/useTrackGaps';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import type { SectorAcc } from '../useSectorAccumulator';
import { deriveMyLap } from './myLap';

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 2,
    name: 'Player',
    teamId: 0,
    aiControlled: false,
    position: 3,
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
    sector2TimeMs: 0,
    currentSector: 0,
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

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    weather: 'clear',
    trackTemp: 30,
    airTemp: 20,
    safetyCar: 'none',
    sessionType: 'Q1',
    totalLaps: 0,
    trackId: 1,
    trackName: 'Test',
    trackLength: 5000,
    ...overrides,
  };
}

function makeQualiState(overrides: Partial<QualifyingState> = {}): QualifyingState {
  return { ...INITIAL_STATE, phase: 'FLYING', attemptNumber: 2, consecutivePushLaps: 1, ...overrides };
}

const EMPTY_GAP: TrackGap = { gapAheadM: null, gapBehindM: null, aheadDriver: null, behindDriver: null };

describe('deriveMyLap — no player (spectating)', () => {
  it('degrades to dashes without crashing', () => {
    const vm = deriveMyLap(null, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.hasPlayer).toBe(false);
    expect(vm.bestText).toBe('—');
    expect(vm.aheadSummary).toBe('No car ahead');
    expect(vm.behindSummary).toBe('No car behind');
  });
});

describe('deriveMyLap — phase/attempt passthrough', () => {
  it('reflects useQualifyingState phase/attempt/push-streak as-is', () => {
    const player = makeDriver();
    const qs = makeQualiState({ phase: 'COOLDOWN', attemptNumber: 4, consecutivePushLaps: 0 });
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), qs);
    expect(vm.phaseLabel).toBe('COOLDOWN');
    expect(vm.attemptNumber).toBe(4);
    expect(vm.consecutivePushLaps).toBe(0);
  });
});

describe('deriveMyLap — best + live partial delta (no "Projected" fabrication)', () => {
  it('shows dash delta when no sector delta signal is available', () => {
    const player = makeDriver();
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('—');
    expect(vm.deltaColor).toBe('var(--text-muted)');
  });

  it('faster-than-baseline sector delta renders as a negative "-" value in the faster tone', () => {
    const player = makeDriver({ index: 5 });
    const tryMap = new Map<number, DriverTryState>([
      [5, { label: 'TRY', tone: 'attack', summary: 'S1 -0.200', score: 3, sectorDelta1Ms: -200, sectorDelta2Ms: null }],
    ]);
    const vm = deriveMyLap(player, [], undefined, tryMap, EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('-0.200');
    expect(vm.deltaColor).toBe('var(--delta-faster)');
  });

  it('slower-than-baseline combined sector deltas sum and render with the slower tone', () => {
    const player = makeDriver({ index: 5 });
    const tryMap = new Map<number, DriverTryState>([
      [5, { label: 'COOL', tone: 'standby', summary: 'S1 +0.100 | S2 +0.050', score: -1, sectorDelta1Ms: 100, sectorDelta2Ms: 50 }],
    ]);
    const vm = deriveMyLap(player, [], undefined, tryMap, EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('+0.150');
    expect(vm.deltaColor).toBe('var(--delta-slower)');
  });
});

describe('deriveMyLap — sector display (persist trio, S3 from rollover backcalc)', () => {
  it('renders no sector times when the display trio is empty (0 = 미표시)', () => {
    const player = makeDriver();
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState(), { s1: 0, s2: 0, s3: 0 });
    expect(vm.s1Text).toBe('—');
    expect(vm.s2Text).toBe('—');
    expect(vm.s3Text).toBe('—');
  });

  it('renders the held trio — including a reconstructed S3 numeric (unlike the old ●●●/dash)', () => {
    const player = makeDriver();
    const acc: SectorAcc = { bestS1: 30_000, bestS2: 31_000, bestS3: 28_000 };
    const vm = deriveMyLap(player, [], acc, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState(), { s1: 30_123, s2: 31_500, s3: 28_900 });
    expect(vm.s1Text).toBe('30.123');
    expect(vm.s2Text).toBe('31.500');
    expect(vm.s3Text).toBe('28.900');
    expect(vm.s3Text).toMatch(/\d/);
  });

  it('paints S3 purple when it matches/beats the personal best', () => {
    const player = makeDriver();
    const acc: SectorAcc = { bestS1: 0, bestS2: 0, bestS3: 28_900 };
    const vm = deriveMyLap(player, [], acc, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState(), { s1: 0, s2: 0, s3: 28_900 });
    expect(vm.s3Color).toBe('var(--sector-purple)');
  });
});

describe('deriveMyLap — ahead/behind meters', () => {
  it('formats sub-1000m gaps as meters and passes through try summaries + driver codes', () => {
    const player = makeDriver();
    const ahead = makeDriver({ index: 7, name: 'Ahead Driver' });
    const behind = makeDriver({ index: 9, name: 'Behind Driver' });
    const trackGap: TrackGap = { gapAheadM: 120, gapBehindM: 800, aheadDriver: ahead, behindDriver: behind };
    const tryMap = new Map<number, DriverTryState>([
      [7, { label: 'TRY', tone: 'attack', summary: 'Flying', score: 4, sectorDelta1Ms: null, sectorDelta2Ms: null }],
      [9, { label: 'COOL', tone: 'standby', summary: 'In lap', score: -1, sectorDelta1Ms: null, sectorDelta2Ms: null }],
    ]);
    const codes = new Map([[7, 'AHD'], [9, 'BHD']]);
    const vm = deriveMyLap(player, [], undefined, tryMap, trackGap, makeSession(), codes, makeQualiState());

    expect(vm.aheadCode).toBe('AHD');
    expect(vm.aheadGapText).toBe('120m');
    expect(vm.aheadGapColor).toBe('var(--accent-lime)'); // <150 close
    expect(vm.aheadSummary).toBe('Flying');

    expect(vm.behindCode).toBe('BHD');
    expect(vm.behindGapText).toBe('800m');
    expect(vm.behindSummary).toBe('In lap');
  });

  it('no car ahead/behind renders dash + explicit copy, not a crash', () => {
    const player = makeDriver();
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.aheadCode).toBe('—');
    expect(vm.aheadGapText).toBe('—');
    expect(vm.aheadSummary).toBe('No car ahead');
  });

  it('on-track player keeps track mode (threat fallback must not fire)', () => {
    const player = makeDriver({ pitStatus: 0, lapDistance: 1200 });
    const other = makeDriver({ index: 4, position: 12, resultStatus: 2 });
    const vm = deriveMyLap(player, [player, other], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.aroundMode).toBe('track');
    expect(vm.aheadPos).toBe('');
  });
});

describe('deriveMyLap — threat watch fallback (player off-track)', () => {
  const attack: DriverTryState = { label: 'TRY', tone: 'attack', summary: 'Flying | ERS OVT', score: 5, sectorDelta1Ms: null, sectorDelta2Ms: null };
  const standby: DriverTryState = { label: 'COOL', tone: 'standby', summary: 'In lap', score: -1, sectorDelta1Ms: null, sectorDelta2Ms: null };

  it('switches slots to ranked threats with best-lap deltas when the player is garaged', () => {
    const player = makeDriver({ index: 2, position: 8, pitStatus: 1, lapDistance: -1, bestLapTime: 72_000 });
    const flyingThreat = makeDriver({ index: 4, position: 12, resultStatus: 2, bestLapTime: 72_500 });
    const coolThreat = makeDriver({ index: 6, position: 10, resultStatus: 2, bestLapTime: 73_000 });
    const leaderFlyer = makeDriver({ index: 1, position: 1, resultStatus: 2, bestLapTime: 70_000 });
    const tryMap = new Map<number, DriverTryState>([[4, attack], [6, standby], [1, attack]]);
    const codes = new Map([[4, 'FLY'], [6, 'COL'], [1, 'LEA']]);

    const vm = deriveMyLap(player, [leaderFlyer, player, coolThreat, flyingThreat], undefined, tryMap, EMPTY_GAP, makeSession(), codes, makeQualiState());

    expect(vm.aroundMode).toBe('threat');
    // 슬롯1: 포지션 위협(P12>P8) + attack. 갭은 거리(m)가 아니라 베스트랩 델타.
    expect(vm.aheadCode).toBe('FLY');
    expect(vm.aheadPos).toBe('P12');
    expect(vm.aheadGapText).toBe('+0.500');
    expect(vm.aheadSummary).toBe('Flying | ERS OVT');
    // 슬롯2: standby라도 포지션 위협(P10)이 비위협 attack(P1)보다 우선.
    expect(vm.behindCode).toBe('COL');
    expect(vm.behindPos).toBe('P10');
    expect(vm.behindGapText).toBe('+1.000');
  });

  it('degrades to track-mode dashes when the garaged player has no on-track candidates', () => {
    const player = makeDriver({ pitStatus: 1, lapDistance: -1 });
    const pittedOther = makeDriver({ index: 4, position: 12, pitStatus: 1, resultStatus: 2 });
    const vm = deriveMyLap(player, [player, pittedOther], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.aroundMode).toBe('track');
    expect(vm.aheadCode).toBe('—');
    expect(vm.aheadSummary).toBe('No car ahead');
  });
});

describe('deriveMyLap — next corner', () => {
  it('formats the next corner as "→ T{n}" when the track has corner data', () => {
    // Suzuka(trackId 12) T1 apex ≈ 12.2% — 100m(1.7%) 지점에서는 T1이 다음 코너다.
    const player = makeDriver({ lapDistance: 100 });
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession({ trackId: 12, trackLength: 5807 }), new Map(), makeQualiState());
    expect(vm.nextCornerText).toBe('→ T1');
  });

  it('returns null on tracks without corner data (default fixture trackId 1)', () => {
    const player = makeDriver();
    const vm = deriveMyLap(player, [], undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.nextCornerText).toBeNull();
  });

  it('returns null without a player (EMPTY_VM)', () => {
    const vm = deriveMyLap(null, [], undefined, new Map(), EMPTY_GAP, makeSession({ trackId: 12, trackLength: 5807 }), new Map(), makeQualiState());
    expect(vm.nextCornerText).toBeNull();
  });
});
