import { describe, expect, it } from 'vitest';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import type { DriverInfo } from '../../../types/telemetry';
import { deriveThreatCars } from './threatWatch';

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0,
    name: 'Driver',
    teamId: 0,
    aiControlled: true,
    position: 5,
    currentLapNum: 5,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 75_000,
    bestLapTime: 73_000,
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
    driverStatus: 1,
    resultStatus: 2,
    numPitStops: 0,
    lapDistance: 1000,
    pitStopTimer: 0,
    ...overrides,
  };
}

function tryState(tone: DriverTryState['tone']): DriverTryState {
  const label = tone === 'attack' ? 'TRY' : tone === 'watch' ? 'BUILD' : 'COOL';
  return { label, tone, summary: label, score: 0, sectorDelta1Ms: null, sectorDelta2Ms: null };
}

const player = makeDriver({ index: 21, position: 8, pitStatus: 1, lapDistance: -1, bestLapTime: 72_000 });

describe('deriveThreatCars — ranking', () => {
  it('positional threats (position > player) outrank non-positional cars regardless of tone', () => {
    const coolBehindMe = makeDriver({ index: 3, position: 10 });
    const attackAheadOfMe = makeDriver({ index: 1, position: 2 });
    const tryMap = new Map([[3, tryState('standby')], [1, tryState('attack')]]);

    const threats = deriveThreatCars([attackAheadOfMe, coolBehindMe], player, tryMap);
    expect(threats.map((t) => t.driver.index)).toEqual([3, 1]);
  });

  it('within the positional group: tone attack > watch > standby, then raw position asc, then index', () => {
    const standbyP9 = makeDriver({ index: 2, position: 9 });
    const attackP15 = makeDriver({ index: 5, position: 15 });
    const watchP12 = makeDriver({ index: 4, position: 12 });
    const attackP11 = makeDriver({ index: 7, position: 11 });
    const tryMap = new Map([
      [2, tryState('standby')],
      [5, tryState('attack')],
      [4, tryState('watch')],
      [7, tryState('attack')],
    ]);

    const threats = deriveThreatCars([standbyP9, attackP15, watchP12, attackP11], player, tryMap);
    // attack 그룹에서 position asc → P11이 P15보다 앞. 상위 2대만 반환.
    expect(threats.map((t) => t.driver.index)).toEqual([7, 5]);
  });
});

describe('deriveThreatCars — candidate filter', () => {
  it('excludes the player, pit cars, off-track cars, inactive (resultStatus undefined) and position 0', () => {
    const pitted = makeDriver({ index: 1, position: 9, pitStatus: 1 });
    const offTrack = makeDriver({ index: 2, position: 10, lapDistance: -1 });
    const inactive = makeDriver({ index: 3, position: 11, resultStatus: undefined });
    const noPosition = makeDriver({ index: 4, position: 0 });
    const valid = makeDriver({ index: 5, position: 12 });

    const threats = deriveThreatCars([player, pitted, offTrack, inactive, noPosition, valid], player, new Map());
    expect(threats.map((t) => t.driver.index)).toEqual([5]);
  });

  it('returns nothing when the player position is unknown (<=0) — mirrors backend gate', () => {
    const unknownPlayer = makeDriver({ index: 21, position: 0, pitStatus: 1 });
    const valid = makeDriver({ index: 5, position: 12 });
    expect(deriveThreatCars([valid], unknownPlayer, new Map())).toEqual([]);
  });
});

describe('deriveThreatCars — best-lap delta (no lastLapTime fallback)', () => {
  it('computes candidate best minus player best only when both bests are valid', () => {
    const withBest = makeDriver({ index: 5, position: 12, bestLapTime: 72_400 });
    const noBest = makeDriver({ index: 6, position: 13, bestLapTime: 0, lastLapTime: 74_000 });

    const threats = deriveThreatCars([withBest, noBest], player, new Map());
    expect(threats[0].deltaMs).toBe(400);
    // bestLapTime이 없으면 lastLapTime(아웃랩 오염 가능)으로 폴백하지 않는다 — null.
    expect(threats[1].deltaMs).toBeNull();
  });

  it('yields null deltas when the player has no valid best lap', () => {
    const noBestPlayer = makeDriver({ index: 21, position: 8, pitStatus: 1, bestLapTime: 0 });
    const candidate = makeDriver({ index: 5, position: 12, bestLapTime: 72_400 });
    const threats = deriveThreatCars([candidate], noBestPlayer, new Map());
    expect(threats[0].deltaMs).toBeNull();
  });
});
