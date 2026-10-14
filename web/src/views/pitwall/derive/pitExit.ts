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

/** pitLoss 값의 출처(표기 구분용, anti-fabrication). measured=실측, track=트랙 baseline, user=사용자 입력. */
export type PitLossSource = 'measured' | 'track' | 'user';

/** 윙 교체 스톱 판정 정지시간 하한(ms). 서버 분류 임계값 pitWingMinMs(internal/platformsvc/pitloss.go)와 동일. */
export const WING_STOP_MIN_MS = 7000;

export interface PitLossInputs {
  /** 플레이어 마지막 확정 스톱의 레인 체류(ms). */
  measuredLaneMs?: number;
  /** 플레이어 마지막 확정 스톱의 정지 작업(ms). */
  measuredStopMs?: number;
  /** 트랙 baseline 피트로스(초). */
  trackLossSec?: number | null;
  /** 트랙 baseline 조회가 끝났는지(ready/unavailable). 로딩 중엔 사용자 폴백으로 점프하지 않는다. */
  trackSettled: boolean;
  /** 사용자 입력 피트로스(초). */
  userSec: number;
  /** 사용자가 값을 직접 기입함 → 실측/트랙보다 우선. */
  userOverride: boolean;
  /** 실측(live) 피트로스 사용 여부. */
  useLive: boolean;
  /** 이번 스톱에 윙 교체 예정. */
  wingChange: boolean;
  /** 윙 교체 추가 시간(초). */
  wingExtraSec: number;
}

export interface ResolvedPitLoss {
  /** 예측에 쓰는 총 피트로스(ms, 윙 교체 가산 포함). 결정 불가면 null. */
  ms: number | null;
  source: PitLossSource;
  /** 총 피트로스에 가산된 윙 교체 시간(ms). */
  wingMs: number;
}

const validPos = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/**
 * 피트로스 우선순위: 사용자 입력(override) → 실측(live, 설정 시) → 트랙 baseline → 사용자 폴백.
 * 실측 스톱이 윙 교체였으면 윙 추가분을 빼 타이어-only 기준으로 정규화한 뒤, 이번 스톱 윙 교체 여부로 다시 가산한다
 * (윙 스톱 실측 + 윙 토글의 이중 가산 방지).
 */
export function resolvePitLoss(i: PitLossInputs): ResolvedPitLoss {
  const wingExtraMs = validPos(i.wingExtraSec) ? i.wingExtraSec * 1000 : 0;
  let base: { ms: number | null; source: PitLossSource };
  if (i.userOverride && validPos(i.userSec)) {
    base = { ms: i.userSec * 1000, source: 'user' };
  } else if (i.useLive && validPos(i.measuredLaneMs)) {
    const wingStop = validPos(i.measuredStopMs) && i.measuredStopMs >= WING_STOP_MIN_MS;
    const normalized = wingStop ? i.measuredLaneMs - wingExtraMs : i.measuredLaneMs;
    base = { ms: normalized > 0 ? normalized : i.measuredLaneMs, source: 'measured' };
  } else if (validPos(i.trackLossSec)) {
    base = { ms: i.trackLossSec * 1000, source: 'track' };
  } else if (i.trackSettled && validPos(i.userSec)) {
    base = { ms: i.userSec * 1000, source: 'user' };
  } else {
    base = { ms: null, source: 'track' };
  }
  const wingMs = base.ms != null && i.wingChange ? wingExtraMs : 0;
  return { ms: base.ms != null ? base.ms + wingMs : null, source: base.source, wingMs };
}

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
  /** pitLoss 값의 출처(표기 구분용, anti-fabrication): 실측/트랙 baseline/사용자 폴백. */
  pitLossSource: PitLossSource;
  /** 게임 자체 재합류 예상 순위(참고용 보조 표기, "game"으로 라벨). 피트 중에만 headline. */
  gameRejoin: number | null;
  /** 균일 피트로스 추정 순위(headline, "est."). 표시된 피트로스를 그대로 반영. coverage 불완전 시 approximate. */
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
 * 온트랙 레이싱 라이벌 판정(threatWatch.ts 선례 재사용): 피트 중(pitStatus>0)·개러지(lapDist<0)
 * ·은퇴·DNF 차는 제외한다. 이들의 deltaToPlayer는 "다들 유지" 가정을 깨거나 부재하므로 뺀다.
 *
 * resultStatus는 화이트리스트(=2/3)가 아니라 **블랙리스트**로 판정한다: 실측상 온트랙 레이싱 차가
 * resultStatus=0(미보고, omitempty)/1(inactive)로 오는 세션이 있어, 2/3 강제는 전 그리드를
 * 오탈락시켰다(라이브 진단: 나 제외 21대 전원 '비활성'). 물리 신호(핏 아님·트랙 위·순위 보유)로
 * 온트랙을 판정하고, 명시적 '아웃'(DNF/DSQ/NC/retired)만 제외한다. 갭 부재는 하류 withGap이 거른다.
 */
export function isDriverOutOfRace(resultStatus: number | undefined): boolean {
  const rs = resultStatus ?? 0;
  return rs === 4 || rs === 5 || rs === 6 || rs === 7; // DNF / DSQ / NC / retired
}

function isRacingRival(d: DriverInfo, playerIndex: number): boolean {
  return (
    d.index !== playerIndex
    && d.pitStatus === 0
    && d.lapDistance >= 0
    && !isDriverOutOfRace(d.resultStatus)
    && d.position > 0
  );
}

/**
 * derivePitExit가 null(패널 "Pit-loss data unavailable")을 반환하는 정확한 사유를
 * 진단 문자열로 돌려준다. derivePitExit의 null-return 가드와 동일한 순서·조건을 미러링하며,
 * 패널이 뜰 수 있는 상태(피트 중 포함)면 null을 반환한다. 콘솔 디버깅 전용 — 렌더에는 영향 없다.
 */
export function pitExitUnavailableReason(
  player: DriverInfo | null,
  drivers: DriverInfo[],
  pitLossMs: number | null,
): string | null {
  if (!player) return 'player 텔레메트리 없음 (player=null)';
  if (player.pitStatus > 0) return null; // 피트 중이면 게임 projection 패널이 뜬다(unavailable 아님)
  const pitLossValid = pitLossMs != null && Number.isFinite(pitLossMs) && pitLossMs > 0;
  if (!pitLossValid) return `피트로스 값 결측/무효 (pitLossMs=${pitLossMs})`;
  const racingRivals = drivers.filter((d) => isRacingRival(d, player.index));
  const withGap = racingRivals.filter((d) => d.deltaToPlayer != null && Number.isFinite(d.deltaToPlayer));
  if (withGap.length === 0) {
    // 왜 라이벌이 0인지 조건별로 분해한다(첫 실패 조건에 귀속). 라이브 세션에서 어느 필터가
    // 전부 걸러내는지(솔로/그리드 전/전원 핏/비활성) 콘솔만 보고 판별할 수 있게 한다.
    const others = drivers.filter((d) => d.index !== player.index);
    let inPit = 0;
    let offTrack = 0;
    let outOfRace = 0;
    let noPos = 0;
    for (const d of others) {
      if (d.pitStatus !== 0) inPit++;
      else if (d.lapDistance < 0) offTrack++;
      else if (isDriverOutOfRace(d.resultStatus)) outOfRace++;
      else if (d.position <= 0) noPos++;
    }
    const noDelta = racingRivals.length - withGap.length;
    return (
      `투영 가능한 온트랙 라이벌 없음 (총 ${drivers.length}대, 나 제외 ${others.length}대 · ` +
      `핏중 ${inPit} · 트랙밖(lapDist<0) ${offTrack} · 아웃(DNF/DSQ/NC/retired) ${outOfRace} · ` +
      `순위없음 ${noPos} · 통과 ${racingRivals.length} · 갭결측 ${noDelta} · withGap ${withGap.length})`
    );
  }
  return null;
}

export function derivePitExit(
  player: DriverInfo | null,
  drivers: DriverInfo[],
  pitLossMs: number | null,
  session: SessionInfo | null,
  pitLossSource: PitLossSource = 'track',
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
      pitLossSource: pitLossValid ? pitLossSource : 'track',
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
    pitLossSource,
    gameRejoin,
    estPosition: aheadCount + 1,
    approximate: !coverageComplete,
    ahead: toNeighbor(ahead),
    behind: toNeighbor(behind),
    space,
    scenarios,
  };
}
