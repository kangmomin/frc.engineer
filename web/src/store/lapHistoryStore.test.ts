import { describe, expect, it } from 'vitest';
import type { DriverInfo, PitwallState } from '../types/telemetry';
import { createLapHistoryIngestor, startLapHistoryTracker, useLapHistoryStore, type LapRecord } from './lapHistoryStore';
import { startRaceMetaTracker, useRaceMetaStore } from './raceMetaStore';
import { useTelemetryStore } from './telemetryStore';

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

const KEY = '5|Race|0';

function liveFrame(driver: Partial<DriverInfo>): PitwallState {
  return {
    session: {
      weather: 'Clear', trackTemp: 30, airTemp: 20, safetyCar: 'None',
      sessionType: 'Race', totalLaps: 20, trackId: 5, trackName: 'Monaco', trackLength: 3337,
    },
    drivers: [makeDriver(driver)], positions: [], playerIndex: 0,
    ersEstimateEnabled: false, ersComparisonEnabled: false,
  };
}

describe('live room boundaries', () => {
  function startRoom(): void {
    startRaceMetaTracker();
    startLapHistoryTracker();
    useTelemetryStore.getState().resetRoom();
  }

  it('clears Alice history, grid, notification tags and ingest baselines before Bob joins the same track and lap', () => {
    startRoom();
    const telemetry = useTelemetryStore.getState();
    telemetry.setPitwallState(liveFrame({ name: 'Alice', position: 5 }));
    telemetry.setPitwallState(liveFrame({ name: 'Alice', currentLapNum: 4, lastLapTime: 80_000 }));
    telemetry.setPitwallState(liveFrame({ name: 'Alice', currentLapNum: 4, lastLapTime: 81_000 }));
    telemetry.addRaceControlNotification({ id: 'alice', timestamp: 1, category: 'info', severity: 'info', message: 'Alice' });
    expect(useLapHistoryStore.getState().history.get(0)).toMatchObject([{ lap: 4, lapMs: 81_000 }]);
    expect(useRaceMetaStore.getState().grid).toEqual({ 0: 5 });

    const epoch = useRaceMetaStore.getState().epoch;
    telemetry.resetRoom();
    expect(useRaceMetaStore.getState()).toMatchObject({ grid: {}, gridStatus: 'empty', notificationLaps: {} });
    expect(useRaceMetaStore.getState().epoch).toBeGreaterThan(epoch);
    expect(useLapHistoryStore.getState().history.size).toBe(0);
    telemetry.setPitwallState(liveFrame({ name: 'Bob', currentLapNum: 4, lastLapTime: 90_000 }));
    expect(useLapHistoryStore.getState().history.size).toBe(0);
    expect(useRaceMetaStore.getState()).toMatchObject({ grid: {}, gridStatus: 'unavailable', firstSeenLap: 4 });
    telemetry.setPitwallState(liveFrame({ name: 'Bob', currentLapNum: 5, lastLapTime: 89_000 }));
    expect(useLapHistoryStore.getState().history.get(0)).toMatchObject([{ lap: 4, lapMs: 89_000, partial: true }]);
  });

  it('preserves same-room history and baselines across a transient reconnect', () => {
    startRoom();
    const telemetry = useTelemetryStore.getState();
    telemetry.setPitwallState(liveFrame({ currentLapNum: 4, lastLapTime: 80_000 }));
    telemetry.setPitwallState(liveFrame({ currentLapNum: 5, lastLapTime: 81_000 }));
    const history = useLapHistoryStore.getState().history;
    telemetry.setConnectionState('reconnecting');
    telemetry.setPitwallState(null);
    telemetry.setConnectionState('connected');
    expect(useLapHistoryStore.getState().history).toBe(history);
    telemetry.setPitwallState(liveFrame({ currentLapNum: 6, lastLapTime: 82_000 }));
    expect(useLapHistoryStore.getState().history.get(0)).toMatchObject([
      { lap: 4, lapMs: 81_000 }, { lap: 5, lapMs: 82_000 },
    ]);
  });

  it('preserves normal replay isolation but discards the prior-room snapshot on explicit exit', () => {
    startRoom();
    const telemetry = useTelemetryStore.getState();
    const live = liveFrame({ name: 'Alice', currentLapNum: 4, lastLapTime: 80_000 });
    telemetry.setPitwallState(live);
    telemetry.setPlaybackActive(true);
    telemetry.applyReplayFrame({ pitwall: liveFrame({ currentLapNum: 4, lastLapTime: 70_000 }) });
    telemetry.setPlaybackActive(false);
    expect(useTelemetryStore.getState().pitwallState).toBe(live);
    expect(useLapHistoryStore.getState().history.size).toBe(0);

    telemetry.setPlaybackActive(true);
    telemetry.applyReplayFrame({ pitwall: liveFrame({ currentLapNum: 5, lastLapTime: 71_000 }) });
    telemetry.resetRoom();
    telemetry.setPlaybackActive(false);
    expect(useTelemetryStore.getState().pitwallState).toBeNull();
    expect(useLapHistoryStore.getState().history.size).toBe(0);
  });
});

/** 프레임 시퀀스를 순차 ingest — 각 프레임은 단일 드라이버(index 0). history 스레딩 포함. */
function run(frames: Array<Partial<DriverInfo>>, key = KEY) {
  const ingestor = createLapHistoryIngestor();
  let history = new Map<number, LapRecord[]>();
  const returns: Array<Map<number, LapRecord[]> | null> = [];
  for (const f of frames) {
    const next = ingestor.ingest([makeDriver(f)], key, history);
    returns.push(next);
    if (next) history = next;
  }
  return { ingestor, history, returns, records: history.get(0) ?? [] };
}

/** 랩 N 주행 중 프레임 (직전 랩 총합 = lastMs). */
function onLap(lap: number, lastMs: number, extra: Partial<DriverInfo> = {}): Partial<DriverInfo> {
  return { currentLapNum: lap, lastLapTime: lastMs, ...extra };
}

describe('createLapHistoryIngestor — 커밋 트리거', () => {
  it('① 터미널 틱 전이(같은 lapNum에서 lastLapTime 갱신)로 완주 랩을 커밋한다', () => {
    const { records } = run([
      onLap(2, 90_000), // seed (lap 1 총합 90s 게시 완료 상태로 합류)
      onLap(2, 90_000),
      onLap(2, 91_500), // 터미널 틱: 랩 2 총합 게시, lapNum 미증가
      onLap(3, 91_500),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ lap: 2, lapMs: 91_500 });
  });

  it('② +1 폴백은 freshness(전이 동반) 시에만 커밋하고, 터미널 틱 선커밋 시 이중 커밋하지 않는다', () => {
    // 터미널 틱 프레임 드랍 → +1 프레임에서 전이 동반 관측
    const dropped = run([onLap(2, 90_000), onLap(3, 91_500)]);
    expect(dropped.records).toHaveLength(1);
    expect(dropped.records[0]).toMatchObject({ lap: 2, lapMs: 91_500 });

    // 터미널 틱 관측 후 +1 프레임 — 이미 커밋된 랩은 재커밋 없음
    const both = run([onLap(2, 90_000), onLap(2, 91_500), onLap(3, 91_500)]);
    expect(both.records).toHaveLength(1);

    // freshness 불통과(+1인데 lastLapTime 불변) = 무통과 텔레포트 → 미커밋
    const teleport = run([onLap(2, 90_000), onLap(3, 90_000)]);
    expect(teleport.records).toHaveLength(0);
  });

  it('③ +2 이상 점프는 커밋하지 않고 리싱크하며, 이후 첫 커밋이 partial·pit null이다', () => {
    const { records } = run([
      onLap(2, 90_000),
      onLap(2, 91_500), // 랩 2 커밋 (partial: seed 직후 첫 커밋)
      onLap(6, 94_000), // 점프 — 94s가 어느 랩 총합인지 확정 불가 → 미커밋
      onLap(6, 95_000), // 랩 6 터미널 틱 → 커밋 (점프 후 첫 커밋 → partial·pit null)
    ]);
    expect(records.map((r) => r.lap)).toEqual([2, 6]);
    expect(records[1]).toMatchObject({ lap: 6, lapMs: 95_000, partial: true, pit: null });
  });

  it('⑧ 최초 관측 프레임은 커밋 평가 없이 seed만 하고(중간 합류 오기록 차단), 첫 커밋은 partial·pit null', () => {
    // 합류 프레임의 lastLapTime(직전 랩 총합)이 현재 랩으로 오기록되면 안 된다
    const { records, returns } = run([onLap(8, 92_000), onLap(8, 92_000)]);
    expect(records).toHaveLength(0);
    expect(returns.every((r) => r === null)).toBe(true);

    const committed = run([onLap(8, 92_000), onLap(8, 93_000), onLap(9, 93_000)]);
    expect(committed.records).toHaveLength(1);
    expect(committed.records[0]).toMatchObject({ lap: 8, lapMs: 93_000, partial: true, pit: null });
  });
});

describe('createLapHistoryIngestor — 회귀·플래시백', () => {
  it('④ 회귀 시 즉시 세대 프루닝되어, 재완주가 +1 폴백 경로로 와도 스테일이 남지 않는다', () => {
    const { records } = run([
      onLap(2, 90_000),
      onLap(2, 91_500), // 랩 2 커밋 (91.5s)
      onLap(3, 91_500),
      onLap(3, 92_000), // 랩 3 커밋 (92.0s)
      onLap(2, 90_000), // 플래시백: 랩 2로 회귀 → lap≥2 프루닝
      onLap(3, 91_800), // 재완주한 랩 2가 +1 폴백(freshness ok)으로 커밋
    ]);
    expect(records.map((r) => [r.lap, r.lapMs])).toEqual([[2, 91_800]]);
  });

  it('⑰ 터미널 틱 커밋 직후 랩 중간 플래시백(revert)을 커밋값 비교로 감지해 프루닝한다', () => {
    const { records } = run([
      onLap(2, 90_000),
      onLap(2, 91_500), // 랩 2 커밋
      onLap(3, 91_500),
      onLap(3, 92_000), // 랩 3 커밋 (터미널 틱, lapNum 아직 3)
      onLap(3, 91_500), // 터미널 창에서 랩 3 중간으로 플래시백 → lastLapTime이 랩 2 총합으로 revert
      onLap(3, 92_300), // 랩 3 재완주 → 정상 대체 커밋
    ]);
    expect(records.map((r) => [r.lap, r.lapMs])).toEqual([
      [2, 91_500],
      [3, 92_300],
    ]);
  });

  it('⑲ 점프 → 커밋 → 플래시백 revert: staleBaseline이 커밋 후에도 유지되어 스테일 재커밋을 차단한다', () => {
    const { records } = run([
      onLap(2, 90_000),
      onLap(6, 94_000), // 점프 리싱크 — baseline {94_000, lap 6} 장전
      onLap(6, 95_000), // 랩 6 터미널 틱 커밋 (커밋해도 baseline 유지)
      onLap(6, 94_000), // 랩 6 중간으로 플래시백 → revert 전이 = baseline 값 → 미커밋 + 프루닝
      onLap(6, 95_200), // 재완주 → 정상 커밋
    ]);
    expect(records.map((r) => [r.lap, r.lapMs])).toEqual([[6, 95_200]]);
  });

  it('⑳ baseline은 랩 전진(recordedLap+1 초과)으로 만료되어, 만료 후 동일 값 전이도 정상 커밋된다', () => {
    const { records } = run([
      onLap(2, 94_000), // seed — baseline {94_000, lap 2}
      onLap(2, 91_500), // 랩 2 커밋
      onLap(3, 91_500),
      onLap(3, 92_000), // 랩 3 커밋
      onLap(4, 92_000), // lap 4 > recordedLap(2)+1 → baseline 만료
      onLap(4, 94_000), // baseline과 동일 값이지만 만료됨 → 랩 4 정상 커밋
    ]);
    expect(records.map((r) => [r.lap, r.lapMs])).toEqual([
      [2, 91_500],
      [3, 92_000],
      [4, 94_000],
    ]);
  });

  it('⑱ nextPartial은 정확히 다음 성공 커밋 1건에만 적용된다', () => {
    const { records } = run([
      onLap(2, 90_000), // seed → nextPartial
      onLap(2, 91_500), // 첫 커밋: partial·pit null
      onLap(3, 91_500),
      onLap(3, 92_000), // 두 번째 커밋: partial 아님, pit false
    ]);
    expect(records[0]).toMatchObject({ partial: true, pit: null });
    expect(records[1].partial).toBeUndefined();
    expect(records[1].pit).toBe(false);
  });
});

describe('createLapHistoryIngestor — no-op·리셋·결측', () => {
  it('⑤ 커밋/프루닝 없는 프레임은 null을 반환한다(참조 동일 보장)', () => {
    const { returns } = run([
      onLap(2, 90_000), // seed
      onLap(2, 90_000), // 변화 없음
      onLap(2, 90_000, { sector1TimeMs: 28_000 }), // 섹터 갱신은 transient만
      onLap(2, 91_500), // 커밋 → Map 반환
      onLap(2, 91_500), // 변화 없음
    ]);
    expect(returns.map((r) => r !== null)).toEqual([false, false, false, true, false]);
  });

  it('⑥ sessionKey(epoch 포함) 변경 시 히스토리·transient 전체 리셋', () => {
    const ingestor = createLapHistoryIngestor();
    let history = new Map<number, LapRecord[]>();
    for (const f of [onLap(2, 90_000), onLap(2, 91_500)]) {
      const next = ingestor.ingest([makeDriver(f)], KEY, history);
      if (next) history = next;
    }
    expect(history.get(0)).toHaveLength(1);

    // epoch bump → 새 키. 리셋된 빈 Map 반환 + 이후 seed부터 다시.
    const afterReset = ingestor.ingest([makeDriver(onLap(2, 91_500))], '5|Race|1', history);
    expect(afterReset).not.toBeNull();
    expect(afterReset!.size).toBe(0);
  });

  it('⑨ 섹터는 스냅샷이 커밋 랩 위에 있고 타당(0<s3<lap)할 때만 채록한다 — 랩 혼합 차단', () => {
    // 정상: 터미널 틱 직전 스냅샷의 s1/s2 → s3 역산
    const ok = run([
      onLap(2, 90_000),
      onLap(2, 90_000, { sector1TimeMs: 28_000, sector2TimeMs: 31_000 }),
      onLap(2, 91_500, { sector1TimeMs: 28_000, sector2TimeMs: 31_000 }),
    ]);
    expect(ok.records[0]).toMatchObject({ s1Ms: 28_000, s2Ms: 31_000, s3Ms: 32_500 });

    // 섹터 미게시(s2=0) → 셋 다 결측
    const missing = run([
      onLap(2, 90_000),
      onLap(2, 90_000, { sector1TimeMs: 28_000 }),
      onLap(2, 91_500, { sector1TimeMs: 28_000 }),
    ]);
    expect(missing.records[0]).toMatchObject({ s1Ms: 0, s2Ms: 0, s3Ms: 0 });

    // s1+s2가 랩 총합 초과(다른 랩 값 혼입 등) → 타당성 가드로 결측
    const implausible = run([
      onLap(2, 90_000),
      onLap(2, 90_000, { sector1TimeMs: 50_000, sector2TimeMs: 45_000 }),
      onLap(2, 91_500, { sector1TimeMs: 50_000, sector2TimeMs: 45_000 }),
    ]);
    expect(implausible.records[0]).toMatchObject({ s1Ms: 0, s2Ms: 0, s3Ms: 0 });
  });

  it('⑩ tireWear 유한값이 없으면 wearPct=null, 있으면 유한값 평균', () => {
    const empty = run([onLap(2, 90_000), onLap(2, 91_500, { tireWear: [] })]);
    expect(empty.records[0].wearPct).toBeNull();

    const avg = run([onLap(2, 90_000), onLap(2, 91_500, { tireWear: [10, 20, NaN, 30] })]);
    expect(avg.records[0].wearPct).toBe(20);
  });

  it('첫 랩(lastLapTime=0)은 전이가 없어 커밋되지 않는다', () => {
    const { records } = run([onLap(1, 0), onLap(1, 0), onLap(2, 0)]);
    expect(records).toHaveLength(0);
  });

  it('pit: 랩 중 pitStatus>0 관측 시 true (비-partial 커밋)', () => {
    const { records } = run([
      onLap(2, 90_000),
      onLap(2, 91_500), // 랩 2 커밋 (partial 소비)
      onLap(3, 91_500, { pitStatus: 1 }), // 랩 3 중 핏 관측
      onLap(3, 91_500),
      onLap(3, 93_000), // 랩 3 커밋
    ]);
    expect(records[1]).toMatchObject({ lap: 3, pit: true });
  });
});
