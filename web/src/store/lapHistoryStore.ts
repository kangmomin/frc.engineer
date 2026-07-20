import { create } from 'zustand';
import type { DriverInfo, PitwallState } from '../types/telemetry';
import { useRaceMetaStore } from './raceMetaStore';
import { useTelemetryStore } from './telemetryStore';

/**
 * 드라이버별 랩 히스토리 축적 스토어 (Pit Wall 드라이버 상세 모달의 데이터 근간).
 * 와이어(DriverInfo)에는 랩 히스토리가 없어 클라이언트가 lastLapTime **값 전이**를 관측해
 * 완주 랩을 채록한다. raceMetaStore와 동일하게 앱 수명 1회 telemetryStore 구독으로 구동
 * (뷰 전환과 무관하게 축적 유지, 리플레이 프레임 스킵).
 *
 * 채록 정확성의 근거가 되는 와이어 불변식(설계 검증 루프 v5에서 확정):
 *  - 쌍 일관성: lastLapTime·currentLapNum은 같은 LapData 패킷의 필드 — 모든 프레임은 일관 쌍.
 *  - 게시 순서: 터미널 틱에 lastLapTime이 lapNum 증가보다 먼저 완주 랩 값으로 갱신된다
 *    (useSectorAccumulator.ts 헤더의 실측 선례). 따라서 고정 lapNum 중의 전이는
 *    ①그 랩의 종료 게시 또는 ②플래시백 revert 두 경우뿐이다.
 * 원칙: 확신 없는 랩 귀속은 기록하지 않는다(레포 파생 원칙 — fabrication 금지, 결측 degrade).
 */

export interface LapRecord {
  /** 완주 랩 번호 (currentLapNum 기준 1-based). */
  lap: number;
  lapMs: number;
  /** 0 = 결측 (섹터 스냅샷 가드 불통과). s3는 lapMs−s1−s2 역산. */
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
  /** 커밋 프레임 tireWear 유한값 평균. 유한값 없으면 null. */
  wearPct: number | null;
  /** 랩 중 pitStatus>0 관측 여부. null = 커버리지 불충분(unknown) — "관측 안 됨"≠"핏 아님". */
  pit: boolean | null;
  /** 관측이 랩 중간부터 시작된 커밋 (중간 합류·회귀/점프/revert 직후 첫 커밋). */
  partial?: true;
}

const MAX_RECORDS_PER_DRIVER = 40;

interface LapHistoryState {
  /** driver.index(안정 car index) → 랩 오름차순 레코드. */
  history: Map<number, LapRecord[]>;
}

export const useLapHistoryStore = create<LapHistoryState>(() => ({
  history: new Map(),
}));

// ── ingest 상태기계 (순수 로직 — lapHistoryStore.test.ts가 고정) ──

/** 드라이버별 고빈도 transient — zustand 밖에 보관해 커밋 없는 프레임의 참조 동일성을 지킨다. */
interface DriverTransient {
  lapNum: number;
  lastLapTime: number;
  s1: number;
  s2: number;
  /** 현재 주행 중 랩에서 pitStatus>0을 관측했는가. */
  pitSeen: boolean;
  /** 다음 성공 커밋 1건에 partial+pit null을 적용 후 클리어. */
  nextPartial: boolean;
  /**
   * 터미널 틱 커밋 직후 플래시백 revert 감지용 스테일 기준값. 커밋으로는 클리어하지 않고
   * 랩 전진(recordedLap+1 초과)으로만 만료한다 — 플래시백은 랩 경계를 2개 이상 되감을 수
   * 없고, 라인 역통과는 lapNum 회귀로 새 baseline이 장전되므로 창이 유계다.
   */
  baseline: { value: number; recordedLap: number } | null;
}

export interface LapHistoryIngestor {
  /**
   * 한 프레임 ingest. 커밋/프루닝/리셋이 있으면 새 history Map을, 없으면 null을 반환한다
   * (null → 스토어 참조 유지, 리렌더 churn 방지).
   */
  ingest(drivers: DriverInfo[], sessionKey: string, history: Map<number, LapRecord[]>): Map<number, LapRecord[]> | null;
}

export function createLapHistoryIngestor(): LapHistoryIngestor {
  const transients = new Map<number, DriverTransient>();
  let lastSessionKey = '';

  function armedTransient(d: DriverInfo): DriverTransient {
    return {
      lapNum: d.currentLapNum,
      lastLapTime: d.lastLapTime,
      s1: d.sector1TimeMs ?? 0,
      s2: d.sector2TimeMs ?? 0,
      pitSeen: d.pitStatus > 0,
      nextPartial: true,
      baseline: { value: d.lastLapTime, recordedLap: d.currentLapNum },
    };
  }

  function snapshotFrom(t: DriverTransient, d: DriverInfo): void {
    t.lapNum = d.currentLapNum;
    t.lastLapTime = d.lastLapTime;
    t.s1 = d.sector1TimeMs ?? 0;
    t.s2 = d.sector2TimeMs ?? 0;
  }

  return {
    ingest(drivers, sessionKey, history) {
      let next: Map<number, LapRecord[]> | null = null;
      const mutable = (): Map<number, LapRecord[]> => (next ??= new Map(history));

      if (sessionKey !== lastSessionKey) {
        transients.clear();
        lastSessionKey = sessionKey;
        if (history.size > 0) next = new Map();
      }

      for (const d of drivers) {
        const t = transients.get(d.index);
        // 0. seed: 최초 관측 — 커밋 평가 없이 시드만 (중간 합류 프레임의 lastLapTime 오기록 차단)
        if (!t) {
          transients.set(d.index, armedTransient(d));
          continue;
        }

        const records = (next ?? history).get(d.index) ?? [];
        const committed = (lap: number): LapRecord | undefined => records.find((r) => r.lap === lap);

        /** 유일성 불변식: lap ≥ L 제거 후 append, 오름차순·캡 유지. */
        const commit = (lap: number, lapMs: number): void => {
          let s1Ms = 0;
          let s2Ms = 0;
          let s3Ms = 0;
          // 섹터는 직전 스냅샷이 커밋 랩 위에 있고 두 섹터가 게시된 경우만 — 랩 혼합 금지.
          if (t.lapNum === lap && t.s1 > 0 && t.s2 > 0) {
            const s3 = lapMs - t.s1 - t.s2;
            if (s3 > 0 && s3 < lapMs) {
              s1Ms = t.s1;
              s2Ms = t.s2;
              s3Ms = s3;
            }
          }
          const wearVals = d.tireWear.filter((w) => Number.isFinite(w));
          const wearPct = wearVals.length > 0 ? wearVals.reduce((a, b) => a + b, 0) / wearVals.length : null;
          const record: LapRecord = {
            lap,
            lapMs,
            s1Ms,
            s2Ms,
            s3Ms,
            wearPct,
            pit: t.nextPartial ? null : t.pitSeen,
            ...(t.nextPartial ? { partial: true as const } : {}),
          };
          t.nextPartial = false;
          const kept = records.filter((r) => r.lap < lap);
          kept.push(record);
          mutable().set(d.index, kept.slice(-MAX_RECORDS_PER_DRIVER));
        };

        const prune = (fromLap: number): void => {
          if (records.some((r) => r.lap >= fromLap)) {
            mutable().set(
              d.index,
              records.filter((r) => r.lap < fromLap),
            );
          }
        };

        const currLap = d.currentLapNum;
        const currLast = d.lastLapTime;

        if (currLap < t.lapNum) {
          // 1. 회귀(플래시백 라인 역통과): 폐기된 미래 세대 즉시 프루닝 + transient 재장전
          prune(currLap);
          transients.set(d.index, armedTransient(d));
          continue;
        }

        if (currLap > t.lapNum + 1) {
          // 2. 점프(재연결/텔레포트): 공백 중 lastLapTime의 랩 귀속 확정 불가 → 커밋 없이 리싱크
          transients.set(d.index, armedTransient(d));
          continue;
        }

        if (currLap === t.lapNum + 1) {
          // 3. +1 폴백: 터미널 틱 프레임 드랍 시에만 정당 — 새 총합 전이 동반(freshness)이 증거.
          //    불변이면 무통과 +1(garage 텔레포트류) → 커밋 없이 partial 재장전.
          if (committed(currLap - 1) === undefined) {
            if (currLast > 0 && currLast !== t.lastLapTime) {
              commit(currLap - 1, currLast);
            } else {
              t.nextPartial = true;
            }
          }
          t.pitSeen = d.pitStatus > 0;
          if (t.baseline && currLap > t.baseline.recordedLap + 1) t.baseline = null;
          snapshotFrom(t, d);
          continue;
        }

        // 같은 랩: pit 관측 누적(터미널 틱 프레임 포함) 후 전이 평가
        if (d.pitStatus > 0) t.pitSeen = true;

        if (currLast > 0 && currLast !== t.lastLapTime) {
          // 4. 터미널 틱 전이(정상 경로 + 최종 랩 lapNum 정지 경로)
          const baselineActive = t.baseline !== null && currLap <= t.baseline.recordedLap + 1;
          const isRevert =
            committed(currLap - 1)?.lapMs === currLast || (baselineActive && t.baseline!.value === currLast);
          if (isRevert) {
            // 플래시백 revert: 커밋 없이 세대 프루닝 + 재장전
            prune(currLap);
            transients.set(d.index, armedTransient(d));
            continue;
          }
          commit(currLap, currLast);
        }
        snapshotFrom(t, d);
      }

      return next;
    },
  };
}

// ── 앱 수명 트래커 (startRaceMetaTracker 선례) ──

let trackerStarted = false;
// 재생 중 마지막으로 관측한 리플레이 프레임 — 재생 종료 직후 잔류 프레임을 라이브로 오인해
// ingest 하지 않도록 기억한다 (raceMetaStore lastReplayState 선례).
let lastReplayState: PitwallState | null = null;
const ingestor = createLapHistoryIngestor();

/**
 * telemetryStore를 1회 구독해 랩 히스토리를 축적한다 (idempotent, 앱 수명).
 * AppShell에서 startRaceMetaTracker() **다음에** 호출할 것 — 구독 순서상 raceMetaStore가
 * 먼저 epoch를 갱신해야 본 트래커의 sessionKey 리셋 권위가 성립한다.
 */
export function startLapHistoryTracker(): void {
  if (trackerStarted) return;
  trackerStarted = true;
  const run = () => {
    const { pitwallState, playbackActive } = useTelemetryStore.getState();
    if (playbackActive) {
      lastReplayState = pitwallState;
      return;
    }
    if (!pitwallState?.session) return;
    if (pitwallState === lastReplayState) return;
    lastReplayState = null;
    const epoch = useRaceMetaStore.getState().epoch;
    const key = `${pitwallState.session.trackId}|${pitwallState.session.sessionType}|${epoch}`;
    const prev = useLapHistoryStore.getState().history;
    const next = ingestor.ingest(pitwallState.drivers, key, prev);
    if (next) useLapHistoryStore.setState({ history: next });
  };
  useTelemetryStore.subscribe(run);
  run();
}
