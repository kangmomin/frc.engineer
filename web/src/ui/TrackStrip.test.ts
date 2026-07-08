import { describe, expect, it } from 'vitest';
import { buildCornerMarks, clampPct, monotonicBounds, wrapPct } from './TrackStrip.derive';

describe('wrapPct', () => {
  it('트랙 위치를 0..100%로 변환한다', () => {
    expect(wrapPct(2896.5, 5793)).toBeCloseTo(50);
  });

  it('음수 lapDistance(라인 통과 전)를 한 랩 기준으로 래핑한다', () => {
    expect(wrapPct(-100, 5000)).toBeCloseTo(98);
  });

  it('트랙 길이 초과 값을 래핑한다', () => {
    expect(wrapPct(5100, 5000)).toBeCloseTo(2);
  });

  it('비유한 입력은 0으로 강등한다', () => {
    expect(wrapPct(Number.NaN, 5000)).toBe(0);
    expect(wrapPct(100, Number.NaN)).toBe(0);
    expect(wrapPct(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(wrapPct(100, 0)).toBe(0);
    expect(wrapPct(100, -1)).toBe(0);
  });
});

describe('clampPct', () => {
  it('범위 밖 값을 0..100으로 클램프한다', () => {
    expect(clampPct(-50, 5000)).toBe(0);
    expect(clampPct(6000, 5000)).toBe(100);
    expect(clampPct(2500, 5000)).toBeCloseTo(50);
  });

  it('비유한 입력은 0으로 강등한다', () => {
    expect(clampPct(Number.NaN, 5000)).toBe(0);
    expect(clampPct(100, Number.NaN)).toBe(0);
    expect(clampPct(100, 0)).toBe(0);
  });
});

describe('monotonicBounds', () => {
  it('정상 입력은 그대로 통과한다', () => {
    expect(monotonicBounds([1930, 3800], 5793)).toEqual([0, 1930, 3800, 5793]);
  });

  it('역전된 sectorSplits를 단조 비감소로 강제한다 (섹터 겹침 렌더 방지)', () => {
    expect(monotonicBounds([3800, 1930], 5793)).toEqual([0, 3800, 3800, 5793]);
  });

  it('비유한 split은 이전 경계로 대체한다', () => {
    expect(monotonicBounds([Number.NaN, 3800], 5793)).toEqual([0, 0, 3800, 5793]);
  });
});

describe('buildCornerMarks', () => {
  it('여유 간격이면 전부 아래층(base)', () => {
    const marks = buildCornerMarks(
      [
        { number: 1, distance: 500 },
        { number: 2, distance: 2000 },
        { number: 3, distance: 4000 },
      ],
      5793,
    );
    expect(marks.every((m) => !m.raised)).toBe(true);
  });

  it('근접 시케인은 두 번째 라벨을 위층으로 올린다', () => {
    const marks = buildCornerMarks(
      [
        { number: 1, distance: 620 },
        { number: 2, distance: 700 },
      ],
      5793,
    );
    expect(marks.map((m) => m.raised)).toEqual([false, true]);
  });

  it('3연속 복합 코너는 base/raised/base로 층을 나눠 배치한다 (몬차 T8-T10 간격)', () => {
    const marks = buildCornerMarks(
      [
        { number: 8, distance: 3540 },
        { number: 9, distance: 3620 },
        { number: 10, distance: 3700 },
      ],
      5793,
    );
    expect(marks.map((m) => m.raised)).toEqual([false, true, false]);
  });

  it('범위 밖 distance는 래핑된 위치 기준으로 정렬·겹침 판정한다', () => {
    // T14@-30은 99.25%로 래핑 → 마지막으로 정렬되고, 0.5%p 옆 T13과 층이 갈린다.
    const marks = buildCornerMarks(
      [
        { number: 14, distance: -30 },
        { number: 1, distance: 90 },
        { number: 12, distance: 3600 },
        { number: 13, distance: 3950 },
      ],
      4000,
    );
    expect(marks.map((m) => m.corner.number)).toEqual([1, 12, 13, 14]);
    expect(marks.map((m) => m.raised)).toEqual([false, false, false, true]);
  });
});
