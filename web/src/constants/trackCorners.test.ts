import { describe, expect, it } from 'vitest';
import { cornersFor, nextCornerNumber } from './trackCorners';
import { TRACK_CORNER_PCTS } from './trackCorners.data';

// canonical trackId 24종 (internal/tracks/names.go) — 리버스(39-41)·Madring(42) 제외.
const CANONICAL_IDS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 23, 24, 25, 26, 27, 28];

const SUZUKA = 12;
const SUZUKA_LEN = 5807; // mock 세션과 동일한 게임 trackLength
const suzuka = TRACK_CORNER_PCTS[SUZUKA];

describe('TRACK_CORNER_PCTS 데이터셋 불변식', () => {
  it('키는 정확히 canonical 24개 트랙이다 (리버스·Madring 부재)', () => {
    expect(Object.keys(TRACK_CORNER_PCTS).map(Number).sort((a, b) => a - b)).toEqual(CANONICAL_IDS);
    expect(TRACK_CORNER_PCTS[39]).toBeUndefined();
    expect(TRACK_CORNER_PCTS[40]).toBeUndefined();
    expect(TRACK_CORNER_PCTS[41]).toBeUndefined();
    expect(TRACK_CORNER_PCTS[42]).toBeUndefined();
  });

  it('트랙별 pct는 (0,1) 개구간에서 순증가한다', () => {
    for (const [id, corners] of Object.entries(TRACK_CORNER_PCTS)) {
      expect(corners.length, `trackId ${id}`).toBeGreaterThan(0);
      for (let i = 0; i < corners.length; i++) {
        expect(corners[i].pct, `trackId ${id} index ${i}`).toBeGreaterThan(0);
        expect(corners[i].pct, `trackId ${id} index ${i}`).toBeLessThan(1);
        if (i > 0) expect(corners[i].pct, `trackId ${id} index ${i}`).toBeGreaterThan(corners[i - 1].pct);
      }
    }
  });

  it('코너 번호는 1 이상 정수이며 비감소한다 (유일성은 요구하지 않음)', () => {
    for (const [id, corners] of Object.entries(TRACK_CORNER_PCTS)) {
      for (let i = 0; i < corners.length; i++) {
        expect(Number.isInteger(corners[i].n), `trackId ${id} index ${i}`).toBe(true);
        expect(corners[i].n, `trackId ${id} index ${i}`).toBeGreaterThanOrEqual(1);
        if (i > 0) expect(corners[i].n, `trackId ${id} index ${i}`).toBeGreaterThanOrEqual(corners[i - 1].n);
      }
    }
  });

  it('Hungaroring(8)의 이중 apex 중복 번호는 원본 그대로 유지된다 (dedupe 금지 고정)', () => {
    const ns = TRACK_CORNER_PCTS[8].map((c) => c.n);
    expect(ns.length).toBeGreaterThan(new Set(ns).size);
  });
});

describe('cornersFor', () => {
  it('pct에 trackLength를 곱해 미터 거리로 변환한다', () => {
    const cs = cornersFor(SUZUKA, SUZUKA_LEN);
    expect(cs).not.toBeNull();
    expect(cs).toHaveLength(suzuka.length);
    expect(cs![0]).toEqual({ number: suzuka[0].n, distance: suzuka[0].pct * SUZUKA_LEN });
  });

  it('데이터 없는 trackId(Madring 42)·미지정 trackId는 null', () => {
    expect(cornersFor(42, SUZUKA_LEN)).toBeNull();
    expect(cornersFor(undefined, SUZUKA_LEN)).toBeNull();
  });

  it('trackLength가 0/음수/NaN/미지정이면 null', () => {
    expect(cornersFor(SUZUKA, 0)).toBeNull();
    expect(cornersFor(SUZUKA, -1)).toBeNull();
    expect(cornersFor(SUZUKA, NaN)).toBeNull();
    expect(cornersFor(SUZUKA, undefined)).toBeNull();
  });
});

describe('nextCornerNumber', () => {
  const mid = (i: number, j: number) => ((suzuka[i].pct + suzuka[j].pct) / 2) * SUZUKA_LEN;

  it('두 apex 사이에서는 뒤쪽 코너를 반환한다', () => {
    expect(nextCornerNumber(SUZUKA, mid(0, 1), SUZUKA_LEN)).toBe(suzuka[1].n);
  });

  it('스타트라인(0m)에서는 첫 코너를 반환한다', () => {
    expect(nextCornerNumber(SUZUKA, 0, SUZUKA_LEN)).toBe(suzuka[0].n);
  });

  it('apex에 정확히 도달하면 통과로 간주해 다음 코너로 전진한다', () => {
    expect(nextCornerNumber(SUZUKA, suzuka[0].pct * SUZUKA_LEN, SUZUKA_LEN)).toBe(suzuka[1].n);
  });

  it('마지막 apex 이후에는 첫 코너로 랩어라운드한다', () => {
    const afterLast = ((suzuka[suzuka.length - 1].pct + 1) / 2) * SUZUKA_LEN;
    expect(nextCornerNumber(SUZUKA, afterLast, SUZUKA_LEN)).toBe(suzuka[0].n);
  });

  it('음수 lapDistance(라인 통과 전)는 랩 끝 기준으로 래핑된다', () => {
    // -50m → 랩의 99.1% 지점 → 마지막 apex(97.1%) 이후 → T1
    expect(nextCornerNumber(SUZUKA, -50, SUZUKA_LEN)).toBe(suzuka[0].n);
  });

  it('trackLength 초과 lapDistance는 한 랩 기준으로 래핑된다', () => {
    expect(nextCornerNumber(SUZUKA, SUZUKA_LEN + mid(0, 1), SUZUKA_LEN)).toBe(suzuka[1].n);
  });

  it('데이터 없는 trackId·비유한 입력은 null', () => {
    expect(nextCornerNumber(42, 100, SUZUKA_LEN)).toBeNull();
    expect(nextCornerNumber(undefined, 100, SUZUKA_LEN)).toBeNull();
    expect(nextCornerNumber(SUZUKA, NaN, SUZUKA_LEN)).toBeNull();
    expect(nextCornerNumber(SUZUKA, undefined, SUZUKA_LEN)).toBeNull();
    expect(nextCornerNumber(SUZUKA, 100, 0)).toBeNull();
    expect(nextCornerNumber(SUZUKA, 100, undefined)).toBeNull();
  });
});
