import { getTyreShortLabel } from '../../../constants/tyreCompounds';
import { clamp } from '../../../utils/formatters';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';

// 데미지 심각도 임계값(%) — 윙 < 바디 패널 < 파워트레인 순으로 완파에 가까워야 카운트.
const WING_DAMAGE_THRESHOLD = 10;
const BODY_DAMAGE_THRESHOLD = 20;
const POWERTRAIN_DAMAGE_THRESHOLD = 30;

export function isDamaged(d: DriverInfo): boolean {
  const dmg = d.damage;
  if (!dmg) return false;
  return (
    dmg.frontLeftWing >= WING_DAMAGE_THRESHOLD ||
    dmg.frontRightWing >= WING_DAMAGE_THRESHOLD ||
    dmg.rearWing >= WING_DAMAGE_THRESHOLD ||
    dmg.floor >= BODY_DAMAGE_THRESHOLD ||
    dmg.diffuser >= BODY_DAMAGE_THRESHOLD ||
    dmg.sidepod >= BODY_DAMAGE_THRESHOLD ||
    dmg.engine >= POWERTRAIN_DAMAGE_THRESHOLD ||
    dmg.gearbox >= POWERTRAIN_DAMAGE_THRESHOLD ||
    dmg.drsFault ||
    dmg.ersFault
  );
}

export type DriverIssue = 'pit' | 'penalty' | 'damage' | null;

/** 러닝오더 issue dot 우선순위: pit(cyan) > penalty(yellow) > damage(soft). */
export function deriveDriverIssue(d: DriverInfo): DriverIssue {
  if (d.pitStatus > 0) return 'pit';
  if (d.penalties > 0 || d.numUnservedDriveThroughs > 0 || d.numUnservedStopGoPenalties > 0) {
    return 'penalty';
  }
  if (isDamaged(d)) return 'damage';
  return null;
}

export type TyreLabel = 'S' | 'M' | 'H' | 'I' | 'W' | '?';

export interface FieldStatus {
  fieldSize: number;
  pittedCount: number;
  inPitNow: number;
  damagedCount: number;
  tyreCounts: Record<TyreLabel, number>;
}

export function deriveFieldStatus(drivers: DriverInfo[]): FieldStatus {
  const tyreCounts: Record<TyreLabel, number> = { S: 0, M: 0, H: 0, I: 0, W: 0, '?': 0 };
  let pittedCount = 0;
  let inPitNow = 0;
  let damagedCount = 0;

  for (const d of drivers) {
    if (d.numPitStops > 0) pittedCount++;
    if (d.pitStatus > 0) inPitNow++;
    if (isDamaged(d)) damagedCount++;
    const label = getTyreShortLabel(d.tireCompound) as TyreLabel;
    tyreCounts[label] += 1;
  }

  return { fieldSize: drivers.length, pittedCount, inPitNow, damagedCount, tyreCounts };
}

export interface FastestLap {
  driverIndex: number;
  timeMs: number;
}

export function deriveFastestLap(drivers: DriverInfo[]): FastestLap | null {
  let best: FastestLap | null = null;
  for (const d of drivers) {
    if (d.bestLapTime > 0 && (best === null || d.bestLapTime < best.timeMs)) {
      best = { driverIndex: d.index, timeMs: d.bestLapTime };
    }
  }
  return best;
}

export interface LapCounter {
  leaderLap: number;
  displayLap: number;
  totalLaps: number;
  toGo: number;
  progressPct: number;
}

function maxCurrentLap(drivers: DriverInfo[]): number {
  let max = 0;
  for (const d of drivers) if (d.currentLapNum > max) max = d.currentLapNum;
  return max;
}

/**
 * 랩 카운터/프로그레스. leaderLap/displayLap 모두 P1의 currentLapNum(없으면 필드
 * 최댓값)을 그대로 반영한다(표시용 별칭). toGo·progressPct는 각각 Math.max(...,0)·
 * clamp(...,0,100)로 오버슈트(예: 레이스 종료 프레임의 currentLapNum > totalLaps)를
 * 흡수하므로 leaderLap 자체를 별도로 클램프할 필요가 없다.
 */
export function deriveLapCounter(drivers: DriverInfo[], session: SessionInfo | null): LapCounter {
  const totalLaps = session?.totalLaps ?? 0;
  const leaderDriver = drivers.find((d) => d.position === 1) ?? null;
  const leaderLap = leaderDriver ? leaderDriver.currentLapNum : maxCurrentLap(drivers);
  const displayLap = leaderLap;
  const toGo = Math.max(totalLaps - displayLap, 0);

  const trackLength = session?.trackLength ?? 0;
  const leaderLapDistanceFrac =
    leaderDriver && trackLength > 0 ? clamp(leaderDriver.lapDistance / trackLength, 0, 1) : 0;

  const progressPct =
    totalLaps > 0
      ? clamp((((displayLap - 1) + leaderLapDistanceFrac) / totalLaps) * 100, 0, 100)
      : 0;

  return { leaderLap, displayLap, totalLaps, toGo, progressPct };
}

const RED_ISSUE_PATTERN = /(drive[- ]?through|stop[- ]?go|disqualif|time penalty|penalty)/i;
const SOFT_ISSUE_PATTERN = /collision|contact|off|wing/i;
const MUTED_ISSUE_PATTERN = /(corner cutting|track limits|lap.*invalid|blocking)/i;

/** Issue Feed 항목 색상 분류. 메시지 텍스트 우선, 매치 없으면 severity로 폴백. */
export function classifyIssue(message: string, severity: string): 'red' | 'soft' | 'muted' | 'cyan' {
  if (RED_ISSUE_PATTERN.test(message)) return 'red';
  if (SOFT_ISSUE_PATTERN.test(message)) return 'soft';
  if (MUTED_ISSUE_PATTERN.test(message)) return 'muted';
  if (severity === 'critical') return 'red';
  if (severity === 'warning') return 'soft';
  return 'cyan';
}

export interface RainRisk {
  pct: number;
  minutes: number;
}

/** 30분 이내 예보 중 강수확률 최댓값. 예보가 없으면 null. */
export function deriveRainRisk(session: SessionInfo | null): RainRisk | null {
  const forecast = session?.weatherForecast;
  if (!forecast || forecast.length === 0) return null;

  let best: { rainPercentage: number; timeOffset: number } | null = null;
  for (const f of forecast) {
    if (f.timeOffset <= 30 && (best === null || f.rainPercentage > best.rainPercentage)) {
      best = f;
    }
  }
  return best ? { pct: best.rainPercentage, minutes: best.timeOffset } : null;
}
