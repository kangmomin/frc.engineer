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
    const vm = deriveMyLap(null, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
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
    const vm = deriveMyLap(player, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), qs);
    expect(vm.phaseLabel).toBe('COOLDOWN');
    expect(vm.attemptNumber).toBe(4);
    expect(vm.consecutivePushLaps).toBe(0);
  });
});

describe('deriveMyLap — best + live partial delta (no "Projected" fabrication)', () => {
  it('shows dash delta when no sector delta signal is available', () => {
    const player = makeDriver();
    const vm = deriveMyLap(player, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('—');
    expect(vm.deltaColor).toBe('var(--text-muted)');
  });

  it('faster-than-baseline sector delta renders as a negative "-" value in the faster tone', () => {
    const player = makeDriver({ index: 5 });
    const tryMap = new Map<number, DriverTryState>([
      [5, { label: 'TRY', tone: 'attack', summary: 'S1 -0.200', score: 3, sectorDelta1Ms: -200, sectorDelta2Ms: null }],
    ]);
    const vm = deriveMyLap(player, undefined, tryMap, EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('-0.200');
    expect(vm.deltaColor).toBe('var(--delta-faster)');
  });

  it('slower-than-baseline combined sector deltas sum and render with the slower tone', () => {
    const player = makeDriver({ index: 5 });
    const tryMap = new Map<number, DriverTryState>([
      [5, { label: 'COOL', tone: 'standby', summary: 'S1 +0.100 | S2 +0.050', score: -1, sectorDelta1Ms: 100, sectorDelta2Ms: 50 }],
    ]);
    const vm = deriveMyLap(player, undefined, tryMap, EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.deltaText).toBe('+0.150');
    expect(vm.deltaColor).toBe('var(--delta-slower)');
  });
});

describe('deriveMyLap — live sectors (0-based currentSector gating, no S3 reconstruction)', () => {
  it('S1 hidden before sector1 completes (currentSector 0)', () => {
    const player = makeDriver({ currentSector: 0, sector1TimeMs: 15_000 });
    const vm = deriveMyLap(player, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.s1Text).toBe('—');
  });

  it('S1 shown once currentSector >= 1', () => {
    const player = makeDriver({ currentSector: 1, sector1TimeMs: 30_123, sector2TimeMs: 0 });
    const acc: SectorAcc = { bestS1: 30_000, bestS2: 0, bestS3: 0 };
    const vm = deriveMyLap(player, acc, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.s1Text).toBe('30.123');
    expect(vm.s2Text).toBe('—');
  });

  it('S2 shown once currentSector >= 2; S3 never shows a reconstructed time — only in-progress dots or dash', () => {
    const player = makeDriver({ currentSector: 2, sector1TimeMs: 30_000, sector2TimeMs: 31_500 });
    const vm = deriveMyLap(player, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.s2Text).toBe('31.500');
    expect(vm.s3Text).toBe('•••');
    // S3 is never a formatted numeric string — the live wire has no such field (Spec §9 anti-fabrication).
    expect(vm.s3Text).not.toMatch(/\d/);
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
    const vm = deriveMyLap(player, undefined, tryMap, trackGap, makeSession(), codes, makeQualiState());

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
    const vm = deriveMyLap(player, undefined, new Map(), EMPTY_GAP, makeSession(), new Map(), makeQualiState());
    expect(vm.aheadCode).toBe('—');
    expect(vm.aheadGapText).toBe('—');
    expect(vm.aheadSummary).toBe('No car ahead');
  });
});
