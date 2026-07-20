import { describe, expect, it } from 'vitest';
import { advanceSectorDisplay } from './useSectorDisplay';

const INIT = { s1: 0, s2: 0, s3: 0, s1Lap: -1 };

describe('advanceSectorDisplay — 섹터 완주/유지 상태 머신', () => {
  it('S1 완주 시 S1을 채우고 S2/S3를 비운다', () => {
    const next = advanceSectorDisplay(
      INIT,
      { lap: 5, lastLapTime: 0, s1: 0, s2: 0 },
      { lap: 5, lastLapTime: 0, s1: 30_000, s2: 0 },
    );
    expect(next).toEqual({ s1: 30_000, s2: 0, s3: 0, s1Lap: 5 });
  });

  it('같은 랩 S2 완주 시 S2만 갱신한다', () => {
    const held = { s1: 30_000, s2: 0, s3: 0, s1Lap: 5 };
    const next = advanceSectorDisplay(
      held,
      { lap: 5, lastLapTime: 0, s1: 30_000, s2: 0 },
      { lap: 5, lastLapTime: 0, s1: 30_000, s2: 31_000 },
    );
    expect(next).toEqual({ s1: 30_000, s2: 31_000, s3: 0, s1Lap: 5 });
  });

  it('랩 롤오버 시 직전 랩 S3를 역산해 완료 트리오를 확정한다', () => {
    const held = { s1: 30_000, s2: 31_000, s3: 0, s1Lap: 5 };
    const next = advanceSectorDisplay(
      held,
      { lap: 5, lastLapTime: 90_000, s1: 30_000, s2: 31_000 },
      { lap: 6, lastLapTime: 90_000, s1: 0, s2: 0 },
    );
    // S3 = 90_000 - 30_000 - 31_000 = 29_000, 완료 랩 5에 귀속(s1Lap=5)
    expect(next).toEqual({ s1: 30_000, s2: 31_000, s3: 29_000, s1Lap: 5 });
  });

  it('롤오버로 확정된 트리오는 다음 랩 S1이 완주될 때까지 유지되다 그 때 리셋된다', () => {
    const rolled = advanceSectorDisplay(
      { s1: 30_000, s2: 31_000, s3: 28_000, s1Lap: 5 },
      { lap: 5, lastLapTime: 90_000, s1: 30_000, s2: 31_000 },
      { lap: 6, lastLapTime: 90_000, s1: 0, s2: 0 },
    );
    expect(rolled.s1Lap).toBe(5); // 완료 랩 5 트리오 확정

    // 새 랩(6) S1 진행 중(cur.s1=0)엔 유지 → 참조 동일
    const heldStill = advanceSectorDisplay(
      rolled,
      { lap: 6, lastLapTime: 90_000, s1: 0, s2: 0 },
      { lap: 6, lastLapTime: 90_000, s1: 0, s2: 0 },
    );
    expect(heldStill).toBe(rolled);

    // 새 랩(6) S1 완주 → 리셋(S1=신규, S2/S3 비움)
    const reset = advanceSectorDisplay(
      rolled,
      { lap: 6, lastLapTime: 90_000, s1: 0, s2: 0 },
      { lap: 6, lastLapTime: 90_000, s1: 29_800, s2: 0 },
    );
    expect(reset).toEqual({ s1: 29_800, s2: 0, s3: 0, s1Lap: 6 });
  });

  it('직전 랩 lastLapTime이 무효(아웃랩)면 롤오버여도 트리오를 덮어쓰지 않는다', () => {
    const held = { s1: 30_000, s2: 31_000, s3: 28_000, s1Lap: 5 };
    const next = advanceSectorDisplay(
      held,
      { lap: 5, lastLapTime: 0, s1: 0, s2: 0 },
      { lap: 6, lastLapTime: 0, s1: 0, s2: 0 },
    );
    expect(next).toBe(held); // 변화 없음(참조 동일 → 렌더 dedup)
  });
});
