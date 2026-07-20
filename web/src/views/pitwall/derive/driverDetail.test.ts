import { describe, expect, it } from 'vitest';
import type { LapRecord } from '../../../store/lapHistoryStore';
import type { DriverInfo } from '../../../types/telemetry';
import {
  deriveDetailCharts,
  deriveRecentLaps,
  deriveRivalsSelection,
  deltaTier,
  type DetailChartsInput,
} from './driverDetail';

// ── Helpers ──

function makeRecord(lap: number, lapMs: number, overrides: Partial<LapRecord> = {}): LapRecord {
  return { lap, lapMs, s1Ms: 0, s2Ms: 0, s3Ms: 0, wearPct: null, pit: false, ...overrides };
}

function makeDriverStub(index: number, position: number): DriverInfo {
  // deriveRivalsSelection은 index/position만 읽는다 — 테스트 전용 최소 스텁.
  return { index, position } as DriverInfo;
}

function chartsInput(overrides: Partial<DetailChartsInput> = {}): DetailChartsInput {
  return {
    seriesIndices: [0],
    history: new Map(),
    codes: new Map(),
    view: 'lap',
    delta: false,
    exPit: false,
    highlight: -1,
    hoverLap: -1,
    ...overrides,
  };
}

describe('deriveDetailCharts', () => {
  it('⑪ 공통 x 도메인은 전 시리즈 최대 lap 기준 고정 14랩 스팬이고, hover는 lap 번호로 조인한다', () => {
    const history = new Map<number, LapRecord[]>([
      [0, [makeRecord(10, 90_000), makeRecord(11, 91_000)]],
      [7, [makeRecord(20, 92_000)]], // 시리즈 7이 더 최근 랩까지 진행
    ]);
    const vm = deriveDetailCharts(chartsInput({ seriesIndices: [0, 7], history, hoverLap: 20 }));
    expect(vm.lapMax).toBe(20);
    expect(vm.lapMin).toBe(7);
    // 시리즈 0의 랩 10/11은 창(7..20) 안 — lap 좌표로 매핑, 시리즈 7과 오프셋 공유 없음
    expect(vm.lines[0].markers).toHaveLength(2);
    // hover lap 20: 시리즈 7만 값 존재 (lap 조인 — 배열 오프셋이면 잘못된 행이 나온다)
    expect(vm.hover.active).toBe(true);
    expect(vm.hover.rows).toHaveLength(1);
    expect(vm.hover.rows[0].value).toBe('92.00s');
  });

  it('⑫ EXCLUDE IN/OUT은 pit===true만 차트·best에서 제외한다 (null unknown은 유지)', () => {
    const history = new Map<number, LapRecord[]>([
      [
        0,
        [
          makeRecord(10, 90_000),
          makeRecord(11, 110_000, { pit: true }), // 인랩
          makeRecord(12, 91_000, { pit: null }), // 커버리지 unknown
        ],
      ],
    ]);
    const off = deriveDetailCharts(chartsInput({ history }));
    expect(off.lines[0].markers).toHaveLength(3);

    const on = deriveDetailCharts(chartsInput({ history, exPit: true }));
    expect(on.lines[0].markers).toHaveLength(2); // pit true만 제외, null 유지

    // Δ DELTA best 산정도 필터 후: pit 랩(110s)이 아닌 90s가 기준
    const delta = deriveDetailCharts(chartsInput({ history, exPit: true, delta: true, hoverLap: 10 }));
    expect(delta.hover.rows[0].value).toBe('0.00s');
  });

  it('⑬ 결측 랩은 폴리라인을 분절한다 — 건너 연결 금지', () => {
    const history = new Map<number, LapRecord[]>([
      [
        0,
        [
          makeRecord(10, 90_000),
          makeRecord(11, 90_500),
          // lap 12 결측 (점프로 미기록)
          makeRecord(13, 91_000),
          makeRecord(14, 91_500),
        ],
      ],
    ]);
    const vm = deriveDetailCharts(chartsInput({ history }));
    expect(vm.lines[0].segments).toHaveLength(2); // [10,11], [13,14]
    expect(vm.lines[0].markers).toHaveLength(4);
  });

  it('⑭ 희소 데이터: 0점이면 empty, 1점이면 세그먼트 없이 마커만', () => {
    expect(deriveDetailCharts(chartsInput()).empty).toBe(true);

    const single = deriveDetailCharts(
      chartsInput({ history: new Map([[0, [makeRecord(5, 90_000)]]]) }),
    );
    expect(single.empty).toBe(false);
    expect(single.lines[0].segments).toHaveLength(0);
    expect(single.lines[0].markers).toHaveLength(1);
    // 동일값 1점 — y 스팬 폴백으로 좌표 유한
    expect(Number.isFinite(single.lines[0].markers[0].topPct)).toBe(true);
  });

  it('섹터 뷰는 해당 섹터 결측(0) 레코드를 점에서 제외한다', () => {
    const history = new Map<number, LapRecord[]>([
      [0, [makeRecord(10, 90_000, { s1Ms: 28_000, s2Ms: 31_000, s3Ms: 31_000 }), makeRecord(11, 91_000)]],
    ]);
    const vm = deriveDetailCharts(chartsInput({ history, view: 's1' }));
    expect(vm.lines[0].markers).toHaveLength(1);
  });

  it('하이라이트는 시리즈 5개 이상에서만 활성화된다', () => {
    const history = new Map<number, LapRecord[]>(
      [0, 1, 2, 3, 4].map((i) => [i, [makeRecord(5, 90_000 + i * 100)]]),
    );
    const four = deriveDetailCharts(chartsInput({ seriesIndices: [0, 1, 2, 3], history, highlight: 0 }));
    expect(four.highlightEnabled).toBe(false);
    expect(four.lines.every((l) => l.opacity === 1)).toBe(true);

    const five = deriveDetailCharts(chartsInput({ seriesIndices: [0, 1, 2, 3, 4], history, highlight: 0 }));
    expect(five.highlightEnabled).toBe(true);
    expect(five.lines.find((l) => l.index === 0)!.strokeWidth).toBe(2.6);
    expect(five.lines.find((l) => l.index === 1)!.opacity).toBe(0.5);
  });
});

describe('deriveRivalsSelection (⑮ open 시점 동결 멤버십)', () => {
  const field = [makeDriverStub(10, 1), makeDriverStub(11, 2), makeDriverStub(12, 3), makeDriverStub(13, 4)];

  it('중위권: dedup[player, 앞뒤, focus]', () => {
    expect(new Set(deriveRivalsSelection(12, field, 10))).toEqual(new Set([10, 11, 12, 13]));
  });

  it('P1: 앞 이웃 없음', () => {
    expect(new Set(deriveRivalsSelection(10, field, 13))).toEqual(new Set([10, 11, 13]));
  });

  it('꼴찌: 뒤 이웃 없음', () => {
    expect(new Set(deriveRivalsSelection(13, field, 10))).toEqual(new Set([10, 12, 13]));
  });

  it('스펙테이터(playerIndex=-1): player 없이 focus±1만', () => {
    expect(new Set(deriveRivalsSelection(12, field, -1))).toEqual(new Set([11, 12, 13]));
  });

  it('focus가 필드에 없으면 focus 단독으로 degrade', () => {
    expect(deriveRivalsSelection(99, field, 10)).toEqual([99]);
  });
});

describe('deriveRecentLaps · deltaTier (⑯ tier 경계)', () => {
  it('Δ는 표시 창 최소 대비이고 tier 경계(1/150/400ms)를 따른다', () => {
    const rows = deriveRecentLaps([
      makeRecord(1, 90_000),
      makeRecord(2, 90_100),
      makeRecord(3, 90_500),
    ]);
    expect(rows[0].delta).toBe('BEST');
    expect(rows[0].deltaColor).toBe('var(--sector-purple)');
    expect(rows[1].delta).toBe('+0.10');
    expect(rows[1].deltaColor).toBe('var(--accent-lime)');
    expect(rows[2].delta).toBe('+0.50');
    expect(rows[2].deltaColor).toBe('var(--accent-soft)');

    expect(deltaTier(1)).toBe('var(--sector-purple)');
    expect(deltaTier(149)).toBe('var(--accent-lime)');
    expect(deltaTier(150)).toBe('var(--text-secondary)');
    expect(deltaTier(399)).toBe('var(--text-secondary)');
    expect(deltaTier(400)).toBe('var(--accent-soft)');
  });

  it('결측 섹터는 —로, 레코드 0개는 빈 배열로 degrade한다', () => {
    const rows = deriveRecentLaps([makeRecord(1, 90_000, { s1Ms: 28_000, s2Ms: 31_000, s3Ms: 31_000 })]);
    expect(rows[0].s1).toBe('28.00');
    expect(deriveRecentLaps([makeRecord(2, 90_000)])[0].s2).toBe('—');
    expect(deriveRecentLaps([])).toEqual([]);
  });
});
