/**
 * 타이어 마모 예측 산식 (순수 함수, 단위 테스트 대상).
 *
 * 예측 입력값 `predictionLaps`는 "지금으로부터 N랩 뒤"를 의미한다. 따라서 N랩 뒤
 * 누적 마모는 현재 마모(wear)에 앞으로의 추가 마모(랩당 마모율 × N랩)를 더한 값이다.
 * 과거 회귀(현재 마모 기준점을 더하지 않아 tireAge가 클 때 예측이 현재보다 낮아짐)를
 * 막기 위해 이 산식을 함수로 분리하고 tyrePrediction.test.ts로 고정한다.
 */

export interface TyreWearProjection {
  /** N랩 뒤 누적 마모(%), 0~100 클램프 후 반올림 */
  absolute: number;
  /** 앞으로 N랩 동안의 추가 마모(%), 반올림. wear∈[0,100]·perLap≥0이면 항상 ≥ 0 */
  delta: number;
}

/** 스틴트 누적 평균 기준 랩당 마모율(%). 타이어 나이가 없으면 0. */
export function tyreWearPerLap(wear: number, tireAge: number | undefined | null): number {
  if (!tireAge || tireAge <= 0) return 0;
  return wear / tireAge;
}

/** 현재 마모와 타이어 나이로 predictionLaps랩 뒤의 누적 마모를 선형 투영한다. */
export function projectTyreWear(
  wear: number,
  tireAge: number | undefined | null,
  predictionLaps: number,
): TyreWearProjection {
  const perLap = tyreWearPerLap(wear, tireAge);
  const absolute = Math.min(wear + perLap * predictionLaps, 100);
  return { absolute: Math.round(absolute), delta: Math.round(absolute - wear) };
}
