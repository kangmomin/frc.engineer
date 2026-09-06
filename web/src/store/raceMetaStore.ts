import { create } from 'zustand';
import type { DriverInfo, PitwallState, RaceControlNotification, SessionInfo } from '../types/telemetry';
import { useTelemetryStore } from './telemetryStore';
import { sessionIdentity } from './sessionIdentity';

/**
 * 레이스 메타 추적 스토어.
 * telemetryStore 에는 없는 두 파생을 뷰보다 상위에서 계산·보관한다:
 *  - move-vs-start: 그리드(시작 순위) 스냅샷 — 백엔드에 gridPosition 필드가 없어 lap 1 프레임에서 캡처
 *  - notification lap 태그: RaceControlNotification 은 timestamp 만 있어, 최초 관측 시 리더 lap 을 기록
 *
 * 뷰가 레이스 중간(예: lap 12)에 마운트돼도 그리드를 놓치지 않도록 AppShell 에서
 * startRaceMetaTracker() 로 telemetryStore 를 앱 수명 내내 1회 구독한다.
 */

export type GridStatus = 'empty' | 'captured' | 'unavailable';

export interface RaceMetaState {
  sessionKey: string;
  /** 세션 변경/리스타트/리플레이 rewind 마다 증가 — 배틀·페이스 히스토리 리셋 키 */
  epoch: number;
  gridStatus: GridStatus;
  /** driver.index → 시작(그리드) 순위 */
  grid: Record<number, number>;
  capturedAtLap: number;
  observedLeaderLap: number;
  /** 중간 합류 시 최초 관측 리더 lap ("joined lap N" 캡션용) */
  firstSeenLap: number;
  /** notification.id → 최초 관측 리더 lap */
  notificationLaps: Record<string, number>;
  ingest: (
    session: SessionInfo | null,
    drivers: DriverInfo[],
    notifications: RaceControlNotification[],
    sessionUid?: string,
  ) => void;
}

function maxLeaderLap(drivers: DriverInfo[]): number {
  let max = 0;
  for (const d of drivers) if (d.currentLapNum > max) max = d.currentLapNum;
  return max;
}

export const createRaceMetaStore = () => create<RaceMetaState>((set) => ({
  sessionKey: '',
  epoch: 0,
  gridStatus: 'empty',
  grid: {},
  capturedAtLap: 0,
  observedLeaderLap: 0,
  firstSeenLap: 0,
  notificationLaps: {},

  ingest: (session, drivers, notifications, sessionUid) =>
    set((state) => {
      const key = sessionIdentity(session, sessionUid ?? session?.sessionUid);
      const isRace = /^Race/i.test(session?.sessionType ?? '');
      const leaderLap = maxLeaderLap(drivers);

      const resetFrom = (base: RaceMetaState): RaceMetaState => ({
        ...base,
        epoch: base.epoch + 1,
        gridStatus: 'empty',
        grid: {},
        capturedAtLap: 0,
        firstSeenLap: 0,
        observedLeaderLap: 0,
      });

      // 1) 세션 변경 → 전체 리셋 (notification 태그 포함)
      // 2) 리스타트/리플레이 rewind (리더 lap ≥1 감소) → 그리드/에폭 리셋 (태그는 유지 → 프루닝으로 정리)
      let s = state;
      if (key !== state.sessionKey) {
        s = { ...resetFrom(state), sessionKey: key, notificationLaps: {} };
      } else if (leaderLap > 0 && state.observedLeaderLap - leaderLap >= 1) {
        s = resetFrom(state);
      }
      if (!session || drivers.length === 0) return s;

      const observedLeaderLap = Math.max(s.observedLeaderLap, leaderLap);

      // 3) 그리드 캡처 — empty + Race 세션에서 최초 관측 프레임이 결정 후 freeze
      let gridStatus = s.gridStatus;
      let grid = s.grid;
      let capturedAtLap = s.capturedAtLap;
      let firstSeenLap = s.firstSeenLap;
      if (gridStatus === 'empty' && isRace) {
        if (leaderLap <= 1) {
          const captured: Record<number, number> = {};
          for (const d of drivers) if (d.position > 0) captured[d.index] = d.position;
          if (Object.keys(captured).length > 0) {
            grid = captured;
            gridStatus = 'captured';
            capturedAtLap = leaderLap;
          }
        } else {
          gridStatus = 'unavailable';
          firstSeenLap = leaderLap;
        }
      }

      // 4) notification lap 태그 (신규 id 만 기록, 현재 리스트 id 로 프루닝해 ≤50 유지)
      let notificationLaps = s.notificationLaps;
      let lapsChanged = false;
      for (const n of notifications) {
        if (notificationLaps[n.id] === undefined) {
          if (!lapsChanged) {
            notificationLaps = { ...notificationLaps };
            lapsChanged = true;
          }
          notificationLaps[n.id] = leaderLap;
        }
      }
      if (lapsChanged) {
        const ids = new Set(notifications.map((n) => n.id));
        notificationLaps = Object.fromEntries(
          Object.entries(notificationLaps).filter(([id]) => ids.has(id)),
        );
      }

      // no-op 이면 원본 반환 (4Hz 리렌더 churn 방지)
      if (
        s === state &&
        observedLeaderLap === state.observedLeaderLap &&
        gridStatus === state.gridStatus &&
        grid === state.grid &&
        !lapsChanged
      ) {
        return state;
      }

      return {
        ...s,
        observedLeaderLap,
        gridStatus,
        grid,
        capturedAtLap,
        firstSeenLap,
        notificationLaps,
      };
    }),
}));

export const useRaceMetaStore = createRaceMetaStore();

let trackerStarted = false;
// 재생 중 마지막으로 관측한 리플레이 프레임 — 재생 종료 직후 pitwallState 에
// 그대로 남아 있으면 라이브로 오인해 ingest 하지 않도록 기억한다.
let lastReplayState: PitwallState | null = null;

/** telemetryStore 를 1회 구독해 그리드/노티 lap 을 추적한다 (idempotent, 앱 수명). */
export function startRaceMetaTracker(): void {
  if (trackerStarted) return;
  trackerStarted = true;
  let roomGeneration = useTelemetryStore.getState().roomGeneration;
  const run = () => {
    const { pitwallState, raceControlNotifications, playbackActive, roomGeneration: currentRoom } = useTelemetryStore.getState();
    if (roomGeneration !== currentRoom) {
      roomGeneration = currentRoom;
      lastReplayState = null;
      useRaceMetaStore.setState((state) => ({
        ...useRaceMetaStore.getInitialState(),
        epoch: state.epoch + 1,
      }));
    }
    if (playbackActive) {
      lastReplayState = pitwallState;
      return;
    }
    if (!pitwallState || (!pitwallState.session && !pitwallState.sessionUid)) return;
    if (pitwallState === lastReplayState) return;
    lastReplayState = null;
    useRaceMetaStore
      .getState()
      .ingest(pitwallState.session, pitwallState.drivers, raceControlNotifications, pitwallState.sessionUid);
  };
  useTelemetryStore.subscribe(run);
  run();
}

/** 그리드 대비 순위 변동. captured 상태에서만 값(>0 상승/<0 하락), 아니면 null. */
export function moveVsStart(
  driverIndex: number,
  currentPosition: number,
  grid: Record<number, number>,
  gridStatus: GridStatus,
): number | null {
  if (gridStatus !== 'captured') return null;
  const start = grid[driverIndex];
  if (start === undefined || currentPosition <= 0) return null;
  return start - currentPosition;
}
