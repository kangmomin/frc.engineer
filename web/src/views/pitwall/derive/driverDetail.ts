import { getTeamColor, getTeamShort } from '../../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import type { LapRecord } from '../../../store/lapHistoryStore';
import type { DriverInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';

/**
 * 드라이버 상세 모달(DriverDetailModal) 순수 파생. 목업 PitWall.dc.html의 detailData/chartData
 * (820–878, 738–818)를 실데이터(lapHistoryStore 축적 레코드) 위에 재구성한다.
 * 결측은 '—'/점 생략/분절로 degrade — 합성 없음(레포 파생 원칙).
 */

const DASH = '—';

/** 최근 랩 테이블·헤더 Best 창 크기 (목업 N=6). */
export const RECENT_LAP_COUNT = 6;
/** 차트 x 도메인 스팬 (목업 N=14). 희소해도 스팬 고정 → 단일점 0-division 없음. */
export const CHART_LAP_SPAN = 14;

/** 목업 chartData 팔레트/dash — driver.index 기반 안정 매핑. */
const SERIES_COLORS = ['#00e5ff', '#cdff13', '#ff8f8f', '#ffb020', '#8b7bff', '#4ad07a', '#ff5c7a', '#5aa9ff'];
const SERIES_DASHES = ['none', '5 4', '1.5 3'];

export function seriesColor(driverIndex: number): string {
  return SERIES_COLORS[((driverIndex % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
}

export function seriesDash(driverIndex: number): string {
  return SERIES_DASHES[Math.floor(driverIndex / SERIES_COLORS.length) % SERIES_DASHES.length];
}

/** 목업 tier(842)의 ms 환산: ≤1ms BEST 퍼플 / <150ms 라임 / <400ms secondary / 이상 soft. */
export function deltaTier(deltaMs: number): string {
  if (deltaMs <= 1) return 'var(--sector-purple)';
  if (deltaMs < 150) return 'var(--accent-lime)';
  if (deltaMs < 400) return 'var(--text-secondary)';
  return 'var(--accent-soft)';
}

function formatSectorSec(ms: number): string {
  return ms > 0 ? (ms / 1000).toFixed(2) : DASH;
}

function finiteMean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

// ── 헤더 ──

export interface DetailHeaderVM {
  code: string;
  posLabel: string;
  teamName: string;
  teamColor: string;
  lastLap: string;
  best6: string;
  deltaLast: string;
  deltaLastColor: string;
  compound: string;
  compoundColor: string;
  tyreDetail: string;
}

export function deriveDetailHeader(focus: DriverInfo, records: LapRecord[], code: string): DetailHeaderVM {
  const recent = records.slice(-RECENT_LAP_COUNT);
  const bestMs = recent.reduce((min, r) => (r.lapMs > 0 && r.lapMs < min ? r.lapMs : min), Infinity);
  const hasBest = Number.isFinite(bestMs);
  const lastMs = focus.lastLapTime;

  let deltaLast = DASH;
  let deltaLastColor = 'var(--text-muted)';
  if (hasBest && lastMs > 0) {
    const d = lastMs - bestMs;
    deltaLast = d <= 1 ? 'BEST' : `+${(d / 1000).toFixed(2)}`;
    deltaLastColor = deltaTier(d);
  }

  const wearNow = finiteMean(focus.tireWear);
  return {
    code,
    posLabel: `P${focus.position}`,
    teamName: getTeamShort(focus.teamId),
    teamColor: getTeamColor(focus.teamId),
    lastLap: lastMs > 0 ? formatLapTime(lastMs) : DASH,
    best6: hasBest ? formatLapTime(bestMs) : DASH,
    deltaLast,
    deltaLastColor,
    compound: getTyreShortLabel(focus.tireCompound),
    compoundColor: getTyreColor(focus.tireCompound),
    tyreDetail: `${focus.tireAge}L · ${wearNow === null ? DASH : `${Math.round(wearNow)}%`}`,
  };
}

// ── Recent Laps 테이블 ──

export interface RecentLapRowVM {
  lapLabel: string;
  s1: string;
  s2: string;
  s3: string;
  lap: string;
  delta: string;
  deltaColor: string;
}

/** 최근 6 레코드 원본 표시(EXCLUDE 미적용). Δ는 표시 창 내 최소 lapMs 대비. */
export function deriveRecentLaps(records: LapRecord[]): RecentLapRowVM[] {
  const recent = records.slice(-RECENT_LAP_COUNT).filter((r) => r.lapMs > 0);
  if (recent.length === 0) return [];
  const best = Math.min(...recent.map((r) => r.lapMs));
  return recent.map((r) => {
    const d = r.lapMs - best;
    return {
      lapLabel: String(r.lap),
      s1: formatSectorSec(r.s1Ms),
      s2: formatSectorSec(r.s2Ms),
      s3: formatSectorSec(r.s3Ms),
      lap: formatLapTime(r.lapMs),
      delta: d <= 1 ? 'BEST' : `+${(d / 1000).toFixed(2)}`,
      deltaColor: deltaTier(d),
    };
  });
}

// ── 시리즈 선택 ──

export type CompareMode = 'solo' | 'rivals' | 'pick';
export type ChartView = 'lap' | 's1' | 's2' | 's3';

/**
 * ME+RIVALS 멤버십(모달 open/모드 전환 시점에 1회 계산해 동결 — 이후 순위 변동에 불변).
 * dedup[focus, player(존재 시), 그 시점 position 기준 focus±1]. P1/꼴찌는 존재하는 쪽만.
 */
export function deriveRivalsSelection(focusIndex: number, drivers: DriverInfo[], playerIndex: number): number[] {
  const focus = drivers.find((d) => d.index === focusIndex);
  if (!focus) return [focusIndex];
  const byPosition = [...drivers].sort((a, b) => a.position - b.position);
  const pos = byPosition.findIndex((d) => d.index === focusIndex);
  const picked = new Set<number>();
  const player = drivers.find((d) => d.index === playerIndex);
  if (player) picked.add(player.index);
  if (pos > 0) picked.add(byPosition[pos - 1].index);
  picked.add(focusIndex);
  if (pos >= 0 && pos + 1 < byPosition.length) picked.add(byPosition[pos + 1].index);
  return [...picked];
}

// ── 차트 ──

export interface ChartMarkerVM {
  leftPct: number;
  topPct: number;
  /** pit 랩 다이아 마커 (pit===true만). */
  pit: boolean;
  color: string;
}

export interface ChartSeriesVM {
  index: number;
  code: string;
  color: string;
  dash: string;
  strokeWidth: number;
  opacity: number;
  /** 결측 랩에서 분절된 폴리라인 points 문자열들 (2점 이상 구간만). */
  segments: string[];
  markers: ChartMarkerVM[];
}

export interface ChartHoverRowVM {
  code: string;
  color: string;
  dash: string;
  value: string;
  wear: string;
}

export interface DetailChartsVM {
  empty: boolean;
  lapMin: number;
  lapMax: number;
  yUnit: string;
  lines: ChartSeriesVM[];
  wearLines: ChartSeriesVM[];
  yTicks: Array<{ label: string; topPct: number }>;
  wearYTicks: Array<{ label: string; topPct: number }>;
  xTicks: Array<{ label: string; leftPct: number }>;
  hoverCols: Array<{ lap: number; leftPct: number; widthPct: number }>;
  highlightEnabled: boolean;
  hover: { active: boolean; leftPct: number; title: string; rows: ChartHoverRowVM[] };
}

export interface DetailChartsInput {
  /** 동결된 시리즈 driver.index 목록. */
  seriesIndices: number[];
  history: Map<number, LapRecord[]>;
  codes: Map<number, string>;
  view: ChartView;
  delta: boolean;
  exPit: boolean;
  /** 하이라이트 driver.index (-1 없음). 시리즈 ≥5일 때만 유효. */
  highlight: number;
  /** hover 중인 랩 번호 (-1 없음). */
  hoverLap: number;
}

interface SeriesPoint {
  lap: number;
  value: number;
  wear: number | null;
  pit: boolean;
}

function metricOf(r: LapRecord, view: ChartView): number {
  if (view === 's1') return r.s1Ms;
  if (view === 's2') return r.s2Ms;
  if (view === 's3') return r.s3Ms;
  return r.lapMs;
}

/** 연속 lap 구간별로 분절 — 결측 랩을 건너 연결(fabrication된 직선)하지 않는다. */
function splitSegments(points: SeriesPoint[]): SeriesPoint[][] {
  const segments: SeriesPoint[][] = [];
  let current: SeriesPoint[] = [];
  let prevLap = NaN;
  for (const p of points) {
    if (current.length > 0 && p.lap !== prevLap + 1) {
      segments.push(current);
      current = [];
    }
    current.push(p);
    prevLap = p.lap;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function deriveDetailCharts(input: DetailChartsInput): DetailChartsVM {
  const { seriesIndices, history, codes, view, delta, exPit, highlight, hoverLap } = input;

  // 공통 x 도메인: 선택 시리즈 전체의 최대 커밋 lap 기준 고정 14랩 스팬. lap 번호로 조인.
  let lapMax = -Infinity;
  for (const idx of seriesIndices) {
    for (const r of history.get(idx) ?? []) if (r.lap > lapMax) lapMax = r.lap;
  }
  const emptyVM: DetailChartsVM = {
    empty: true,
    lapMin: 0,
    lapMax: 0,
    yUnit: '',
    lines: [],
    wearLines: [],
    yTicks: [],
    wearYTicks: [],
    xTicks: [],
    hoverCols: [],
    highlightEnabled: false,
    hover: { active: false, leftPct: 0, title: '', rows: [] },
  };
  if (!Number.isFinite(lapMax)) return emptyVM;
  const lapMin = lapMax - (CHART_LAP_SPAN - 1);
  const xPct = (lap: number): number => ((lap - lapMin) / (CHART_LAP_SPAN - 1)) * 100;

  // 시리즈별 창 내 유효 점 수집 (EXCLUDE: pit===true 제외 — null(unknown)은 유지)
  const perSeries = seriesIndices.map((idx) => {
    const records = (history.get(idx) ?? []).filter(
      (r) => r.lap >= lapMin && r.lap <= lapMax && !(exPit && r.pit === true),
    );
    const points: SeriesPoint[] = records
      .filter((r) => metricOf(r, view) > 0)
      .map((r) => ({ lap: r.lap, value: metricOf(r, view) / 1000, wear: r.wearPct, pit: r.pit === true }));
    const wearPoints: SeriesPoint[] = records
      .filter((r) => r.wearPct !== null)
      .map((r) => ({ lap: r.lap, value: r.wearPct as number, wear: r.wearPct, pit: r.pit === true }));
    return { idx, points, wearPoints };
  });

  if (perSeries.every((s) => s.points.length === 0 && s.wearPoints.length === 0)) return emptyVM;

  // y 도메인 (lap/섹터 차트, 초 단위) — Δ DELTA는 필터 후 전 시리즈 최소 대비
  const allValues = perSeries.flatMap((s) => s.points.map((p) => p.value));
  const best = allValues.length > 0 ? Math.min(...allValues) : 0;
  const valueOf = (v: number): number => (delta ? v - best : v);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of allValues) {
    const adj = valueOf(v);
    if (adj < yMin) yMin = adj;
    if (adj > yMax) yMax = adj;
  }
  if (!Number.isFinite(yMin)) {
    yMin = 0;
    yMax = 1;
  }
  const yPad = (yMax - yMin) * 0.12 || 0.5;
  yMin -= yPad;
  yMax += yPad;
  // 위 = 느림(값 큼), 아래 = 빠름 — "lower = faster" 축 라벨과 일관.
  const yPct = (v: number): number => 100 - ((v - yMin) / (yMax - yMin)) * 100;

  // wear y 도메인 (%)
  const allWear = perSeries.flatMap((s) => s.wearPoints.map((p) => p.value));
  let wMin = allWear.length > 0 ? Math.min(...allWear) : 0;
  let wMax = allWear.length > 0 ? Math.max(...allWear) : 100;
  const wPad = (wMax - wMin) * 0.12 || 4;
  wMin = Math.max(0, wMin - wPad);
  wMax = Math.min(105, wMax + wPad);
  const wPct = (v: number): number => 100 - ((v - wMin) / (wMax - wMin)) * 100;

  const highlightEnabled = seriesIndices.length >= 5;
  const active = (idx: number): boolean => !highlightEnabled || highlight < 0 || highlight === idx;

  function buildSeries(idx: number, points: SeriesPoint[], toPct: (v: number) => number, mapValue: (v: number) => number): ChartSeriesVM {
    const dimmed = !active(idx);
    const color = dimmed ? '#4a4f51' : seriesColor(idx);
    const markerColor = dimmed ? '#5a5f61' : seriesColor(idx);
    return {
      index: idx,
      code: codes.get(idx) ?? `#${idx}`,
      color,
      dash: seriesDash(idx),
      strokeWidth: dimmed ? 1 : highlightEnabled && highlight === idx ? 2.6 : 2,
      opacity: dimmed ? 0.5 : 1,
      segments: splitSegments(points)
        .filter((seg) => seg.length >= 2)
        .map((seg) => seg.map((p) => `${xPct(p.lap).toFixed(2)},${toPct(mapValue(p.value)).toFixed(2)}`).join(' ')),
      markers: points.map((p) => ({
        leftPct: xPct(p.lap),
        topPct: toPct(mapValue(p.value)),
        pit: p.pit,
        color: markerColor,
      })),
    };
  }

  const lines = perSeries.map((s) => buildSeries(s.idx, s.points, yPct, valueOf));
  const wearLines = perSeries.map((s) => buildSeries(s.idx, s.wearPoints, wPct, (v) => v));

  // 축 눈금 — 위 = 최댓값(느림/마모 높음). 좁은 도메인(<1s)은 2자리로 눈금 중복 표기 방지.
  const yDecimals = yMax - yMin < 1 ? 2 : 1;
  const yTicks = Array.from({ length: 5 }, (_, i) => ({
    label: `${delta && yMax - ((yMax - yMin) * i) / 4 >= 0 ? '+' : ''}${(yMax - ((yMax - yMin) * i) / 4).toFixed(yDecimals)}`,
    topPct: (i / 4) * 100,
  }));
  const wearYTicks = Array.from({ length: 5 }, (_, i) => ({
    label: `${Math.round(wMax - ((wMax - wMin) * i) / 4)}%`,
    topPct: (i / 4) * 100,
  }));
  const xTicks: Array<{ label: string; leftPct: number }> = [];
  for (let lap = lapMin; lap <= lapMax; lap++) {
    if (lap >= 1 && (lapMax - lap) % 2 === 0) xTicks.push({ label: String(lap), leftPct: xPct(lap) });
  }
  const halfW = 100 / (CHART_LAP_SPAN - 1) / 2;
  const hoverCols: Array<{ lap: number; leftPct: number; widthPct: number }> = [];
  for (let lap = Math.max(lapMin, 1); lap <= lapMax; lap++) {
    hoverCols.push({ lap, leftPct: Math.max(0, xPct(lap) - halfW), widthPct: halfW * 2 });
  }

  // hover: lap 번호 조인 — 배열 오프셋 금지
  const hoverActive = hoverLap >= lapMin && hoverLap <= lapMax;
  const hoverRows: ChartHoverRowVM[] = hoverActive
    ? perSeries.flatMap((s) => {
        const p = s.points.find((x) => x.lap === hoverLap);
        if (!p) return [];
        return [
          {
            code: codes.get(s.idx) ?? `#${s.idx}`,
            color: seriesColor(s.idx),
            dash: seriesDash(s.idx),
            value: `${valueOf(p.value).toFixed(2)}s`,
            wear: p.wear === null ? DASH : `${Math.round(p.wear)}%`,
          },
        ];
      })
    : [];

  return {
    empty: false,
    lapMin,
    lapMax,
    yUnit: delta ? 'Δs vs best' : 'sec',
    lines,
    wearLines,
    yTicks,
    wearYTicks,
    xTicks,
    hoverCols,
    highlightEnabled,
    hover: {
      active: hoverActive && hoverRows.length > 0,
      leftPct: hoverActive ? xPct(hoverLap) : 0,
      title: `Lap ${hoverLap}`,
      rows: hoverRows,
    },
  };
}
