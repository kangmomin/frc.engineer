import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { deriveDriverCodes } from '../../../utils/driverCodes';

const DASH = '—';

/**
 * 스페이싱 휴리스틱(측정값 아님): 재합류 후 최근접 이웃이 이 이내면 트래픽(더티에어 추정).
 */
export const TRAFFIC_WINDOW_MS = 2000;
/** DRS 사거리 근접(거리 추정 — 실제 DRS 가용 여부는 아님). */
export const DRS_WINDOW_MS = 1000;

export type PitExitSpace = 'clear' | 'traffic' | 'drs';

export interface PitExitNeighbor {
  code: string;
  /** 부호 없는 크기(초, 1자리). */
  gapText: string;
  /** numPitStops===0 — 아직 한 번도 피트인 안 함(문자적 사실). */
  neverStopped: boolean;
}

export interface PitExitScenario {
  key: 's1' | 's2' | 's3';
  label: string;
  outcome: string;
  /** 실측 필드 유도(true) vs 정성/방향(false — 미모델 요소 명시). */
  estimate: boolean;
}

/**
 * "지금 박스하면 어디로 나오는가"의 실데이터 유도 VM. 모든 수치는 실필드
 * (deltaToPlayer, pit_stop_time_lost_s)에서 유도한 균일 피트로스 추정이며, 조작은 없다.
 * 결측/피트 중/무-라이벌은 null·억제로 정직하게 degrade한다(anti-fabrication).
 */
export interface PitExitVM {
  /** player.pitStatus>0 — 이미 피트 중(계산 갭 억제, 게임 projection만 · 이중계산 방지). */
  pitting: boolean;
  /** 표시용 피트로스("22.5s"). 2026 세션에선 F1 25 스크랩 기반 추정치. 결측 시 null. */
  pitLossText: string | null;
  /** pitLoss가 트랙 실데이터가 아니라 사용자 설정 폴백값임(출처 구분 표기용, anti-fabrication). */
  pitLossFallback: boolean;
  /** 게임 자체 재합류 예상 순위(있으면 headline, "game"으로 라벨). */
  gameRejoin: number | null;
  /** 균일 피트로스 추정 순위("est."). coverage 불완전 시 approximate. */
  estPosition: number;
  /** 온트랙 라이벌 중 갭 결측이 있어 정확 순위/스페이싱을 보장 못 함. */
  approximate: boolean;
  /** 재합류 직후 바로 앞 차(없거나 피트 중이면 null). */
  ahead: PitExitNeighbor | null;
  /** 재합류 직후 바로 뒤 차(없거나 피트 중이면 null). */
  behind: PitExitNeighbor | null;
  /** 스페이싱 판정. coverage 불완전/피트 중이면 null(정직 억제). */
  space: PitExitSpace | null;
  /** 3개 what-if 시나리오. 인접 "안 멈춘" 차가 없거나 피트 중이면 빈 배열. */
  scenarios: PitExitScenario[];
}

interface Proj {
  d: DriverInfo;
  /** projectedGap: 음수=재합류 후 내 앞, 양수=내 뒤. */
  gap: number;
}

function sec(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

/**
 * 온트랙 레이싱 라이벌 판정(threatWatch.ts 선례 재사용): 피트 중(pitStatus>0)·개러지·은퇴
 * ·DNF 차는 제외한다. 이들의 deltaToPlayer는 "다들 유지" 가정을 깨거나 부재하므로, coverage
 * 분모와 exitPosition 기준에서 모두 빼야 정확 순위/스페이싱이 살아난다(Fable REVISE #2/#3).
 */
function isRacingRival(d: DriverInfo, playerIndex: number): boolean {
  return (
    d.index !== playerIndex
    && d.pitStatus === 0
    && d.lapDistance >= 0
    && ((d.resultStatus ?? 0) === 2 || (d.resultStatus ?? 0) === 3)
    && d.position > 0
  );
}

export function derivePitExit(
  player: DriverInfo | null,
  drivers: DriverInfo[],
  pitLossMs: number | null,
  session: SessionInfo | null,
  pitLossFallback = false,
): PitExitVM | null {
  if (!player) return null;

  const gameRejoin = session?.pitStopRejoinPosition ?? null;
  const pitLossValid = pitLossMs != null && Number.isFinite(pitLossMs) && pitLossMs > 0;

  // 이미 피트 중이면 계산 갭은 이중계산이라 억제하고 게임 projection만 표시한다. pitLoss/라이벌
  // 갭과 무관하게 도달해야 force-open이 빈 박스가 되지 않는다(Fable REVISE #1).
  if (player.pitStatus > 0) {
    return {
      pitting: true,
      pitLossText: pitLossValid ? sec(pitLossMs) : null,
      pitLossFallback: pitLossValid && pitLossFallback,
      gameRejoin,
      estPosition: 0,
      approximate: true,
      ahead: null,
      behind: null,
      space: null,
      scenarios: [],
    };
  }

  if (!pitLossValid) return null;

  const codes = deriveDriverCodes(drivers);
  const racingRivals = drivers.filter((d) => isRacingRival(d, player.index));
  const withGap = racingRivals.filter((d) => d.deltaToPlayer != null && Number.isFinite(d.deltaToPlayer));
  if (withGap.length === 0) return null; // 투영할 온트랙 상대가 없음 → 패널 unavailable

  const coverageComplete = withGap.length === racingRivals.length;
  const proj: Proj[] = withGap.map((d) => ({ d, gap: (d.deltaToPlayer as number) - pitLossMs }));

  // nearest ahead(0에 가장 가까운 음수) / behind(0에 가장 가까운 비음수), index 타이브레이크.
  let ahead: Proj | null = null;
  let behind: Proj | null = null;
  let aheadCount = 0;
  for (const p of proj) {
    if (p.gap < 0) {
      aheadCount++;
      if (!ahead || p.gap > ahead.gap || (p.gap === ahead.gap && p.d.index < ahead.d.index)) ahead = p;
    } else if (!behind || p.gap < behind.gap || (p.gap === behind.gap && p.d.index < behind.d.index)) {
      behind = p;
    }
  }

  // 스페이싱은 coverage 완전할 때만 판정(누락 갭이 실제 이웃이었을 수 있으므로 억제).
  let space: PitExitSpace | null = null;
  if (coverageComplete) {
    const nearest = Math.min(ahead ? Math.abs(ahead.gap) : Infinity, behind ? behind.gap : Infinity);
    space = !Number.isFinite(nearest)
      ? 'clear' // 양쪽 다 비어 있고 coverage 완전 → 실제로 혼자
      : nearest <= DRS_WINDOW_MS
        ? 'drs'
        : nearest <= TRAFFIC_WINDOW_MS
          ? 'traffic'
          : 'clear';
  }

  const toNeighbor = (p: Proj | null): PitExitNeighbor | null =>
    p
      ? { code: codes.get(p.d.index) ?? DASH, gapText: sec(p.gap), neverStopped: (p.d.numPitStops ?? 0) === 0 }
      : null;

  // ── 시나리오: 사용자 요구대로 "아직 안 멈춘"(numPitStops===0) 최근접 라이벌을 pivot으로 삼는다.
  // 그런 차가 없으면(전후 모두 이미 피트 완료) 시나리오를 억지로 만들지 않는다("전후로 있다면").
  const scenarios: PitExitScenario[] = [];
  const nonPitted = proj.filter((p) => (p.d.numPitStops ?? 0) === 0);
  const pivot = nonPitted.length
    ? nonPitted.reduce((best, p) => (Math.abs(p.gap) < Math.abs(best.gap) ? p : best))
    : null;
  if (pivot) {
    const code = codes.get(pivot.d.index) ?? DASH;
    const curGap = pivot.d.deltaToPlayer as number; // 현재 갭(+뒤/−앞)
    const curMag = sec(curGap);
    const curSide = curGap < 0 ? 'ahead' : 'behind';
    const projSide = pivot.gap < 0 ? 'ahead of you' : 'behind you';

    scenarios.push({
      key: 's1',
      label: 'They stay out',
      outcome: `${code} ends ${sec(pivot.gap)} ${projSide}`,
      estimate: true,
    });
    scenarios.push({
      key: 's2',
      label: 'They box with you',
      outcome: `Order holds — ${code} ~${curMag} ${curSide} (equal pit-loss)`,
      estimate: true,
    });
    scenarios.push({
      key: 's3',
      label: 'They box the lap after',
      outcome: `You pit first — undercut on fresher tyres vs ${code}; net gain rides on out-lap pace (not modeled)`,
      estimate: false,
    });
  }

  return {
    pitting: false,
    pitLossText: sec(pitLossMs),
    pitLossFallback,
    gameRejoin,
    estPosition: aheadCount + 1,
    approximate: !coverageComplete,
    ahead: toNeighbor(ahead),
    behind: toNeighbor(behind),
    space,
    scenarios,
  };
}
