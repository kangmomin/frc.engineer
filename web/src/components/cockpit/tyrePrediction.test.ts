import { describe, expect, it } from 'vitest';
import { projectTyreWear, tyreWearPerLap } from './tyrePrediction';

describe('tyreWearPerLap', () => {
  it('스틴트 누적 평균 마모율을 계산한다', () => {
    expect(tyreWearPerLap(40, 20)).toBe(2);
    expect(tyreWearPerLap(45, 15)).toBe(3);
  });

  it('타이어 나이가 없거나 0이면 0을 반환한다', () => {
    expect(tyreWearPerLap(30, 0)).toBe(0);
    expect(tyreWearPerLap(30, undefined)).toBe(0);
    expect(tyreWearPerLap(30, null)).toBe(0);
  });
});

describe('projectTyreWear', () => {
  it('현재 마모에 앞으로 N랩 추가 마모를 더해 누적 마모를 투영한다', () => {
    // tireAge=20, wear=40% → 2%/lap, 10랩 뒤 = 40 + 2*10 = 60%
    expect(projectTyreWear(40, 20, 10)).toEqual({ absolute: 60, delta: 20 });
    // tireAge=5, wear=10% → 2%/lap, 10랩 뒤 = 10 + 2*10 = 30%
    expect(projectTyreWear(10, 5, 10)).toEqual({ absolute: 30, delta: 20 });
    // tireAge=15, wear=45% → 3%/lap, 10랩 뒤 = 45 + 3*10 = 75%
    expect(projectTyreWear(45, 15, 10)).toEqual({ absolute: 75, delta: 30 });
  });

  it('회귀 가드: predictionLaps가 현재 tireAge보다 작아도 예측은 현재 마모 이상이다', () => {
    // 과거 버그: absolute = perLap*predictionLaps = 2*5 = 10% (현재 40%보다 낮아 delta 음수)
    // 수정 후: 40 + 2*5 = 50%, delta = +10%
    const p = projectTyreWear(40, 20, 5);
    expect(p.absolute).toBe(50);
    expect(p.delta).toBe(10);
  });

  it('delta는 항상 0 이상이다 (음수 "+-N%" 표기 버그 방지)', () => {
    for (const tireAge of [1, 5, 10, 20, 40]) {
      for (const wear of [0, 10, 40, 80, 100]) {
        for (const laps of [1, 5, 10, 50]) {
          expect(projectTyreWear(wear, tireAge, laps).delta).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('누적 마모를 100%로 클램프하고 delta는 남은 마모만 반영한다', () => {
    // wear=90, tireAge=10 → 9%/lap, 5랩 뒤 = 90 + 45 = 135 → 100% 클램프, delta=10
    expect(projectTyreWear(90, 10, 5)).toEqual({ absolute: 100, delta: 10 });
    // 이미 100%면 추가 마모 없음
    expect(projectTyreWear(100, 10, 10)).toEqual({ absolute: 100, delta: 0 });
  });

  it('타이어 나이가 없으면 현재 마모를 그대로 반환한다', () => {
    expect(projectTyreWear(25, 0, 10)).toEqual({ absolute: 25, delta: 0 });
    expect(projectTyreWear(25, undefined, 10)).toEqual({ absolute: 25, delta: 0 });
  });

  it('소수 마모율을 반올림한다', () => {
    // wear=33, tireAge=10 → 3.3%/lap, 3랩 뒤 = 33 + 9.9 = 42.9 → absolute 43, delta round(9.9)=10
    expect(projectTyreWear(33, 10, 3)).toEqual({ absolute: 43, delta: 10 });
  });
});
