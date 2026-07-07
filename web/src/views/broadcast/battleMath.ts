import { clamp } from '../../utils/formatters';

/**
 * gap(=deltaToCarInFront) 히스토리의 초당 변화율(ms/sec)로 배틀 추세를 판정한다.
 * slope는 "gap이 시간에 따라 어떻게 변하는가"이므로, gap이 줄어드는 중(음수 slope)이면
 * 공격자가 좁혀오는 중 → closing. gap이 늘어나는 중(양수 slope)이면 opening.
 */
export function trendFromSlope(slopeMsPerSec: number): 'closing' | 'opening' | 'stable' {
  if (slopeMsPerSec <= -40) return 'closing';
  if (slopeMsPerSec >= 40) return 'opening';
  return 'stable';
}

/** ms/sec 기울기를 랩당 변화량(ms/lap)으로 환산. 부호를 뒤집어 양수=closing이 되게 한다. */
export function ratePerLapMs(slopeMsPerSec: number, lapSec: number): number {
  return -slopeMsPerSec * lapSec;
}

/**
 * 배틀 신뢰도(heuristic, 0-100). 플랜 §4 공식을 그대로 구현.
 * ratePerLapMs가 null(히스토리 부족, <BASELINE_MS)이면 gap+DRS 부스트만으로 낮은
 * 상한(0.60)의 축소 공식을 사용한다. 이 함수 자체는 항상 number를 반환하며(null은
 * SC/VSC 상황에서 호출부가 담당), 반환 타입은 BattleInfo.confidencePct와 맞추기 위해
 * number | null로 선언한다.
 */
export function battleConfidence(
  gapMs: number,
  ratePerLapMsValue: number | null,
  canArmDrs: boolean,
): number | null {
  const gapScore = clamp(1 - gapMs / 1500, 0, 1);
  const boost = canArmDrs ? 1 : 0;

  if (ratePerLapMsValue === null) {
    return Math.round(100 * clamp(0.5 * gapScore + 0.15 * boost, 0.05, 0.6));
  }

  const rateScore = clamp(0.5 + ratePerLapMsValue / 800, 0, 1);
  return Math.round(100 * clamp(0.45 * gapScore + 0.4 * rateScore + 0.15 * boost, 0.05, 0.95));
}

export interface RangeLabel {
  kind: 'OVT' | 'DRS' | 'CHASE';
  text: string;
}

/**
 * 레인지 라벨. 2025는 갭 기반(500ms/1000ms) OVT/DRS 임계, 2026은 overtakeAvailable
 * 플래그 기반(Overtake는 게임 규칙상 DRS와 다른 시스템이므로 'DRS' kind는 절대 내지 않는다).
 */
export function rangeLabel(
  gapMs: number,
  is2026: boolean,
  overtakeAvailable: boolean | undefined,
): RangeLabel {
  if (is2026) {
    if (overtakeAvailable === true) return { kind: 'OVT', text: 'OVT ready' };
    return gapMs <= 1000 ? { kind: 'CHASE', text: 'in range' } : { kind: 'CHASE', text: 'chasing' };
  }
  if (gapMs <= 500) return { kind: 'OVT', text: 'OVT range' };
  if (gapMs <= 1000) return { kind: 'DRS', text: 'DRS range' };
  return { kind: 'CHASE', text: 'chasing' };
}
