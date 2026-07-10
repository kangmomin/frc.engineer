/**
 * Pit Wall 리더보드 가변 컬럼 정의. 목업(PitWall.dc.html)의 COL_ORDER/COL_W/COL_HEAD/
 * COL_ALIGN 상수를 그대로 이식한다(색상/레이아웃 기준은 목업, 데이터 매핑은 Spec).
 */

export type ColumnKey =
  | 'drs'
  | 'ers'
  | 'gap'
  | 'interval'
  | 'lastLap'
  | 'bestLap'
  | 'fuel'
  | 'penalty'
  | 'tyre'
  | 'pit'
  | 'vmax'
  | 'sector'
  | 'damage';

/** Width-adjustable key: any resizable column plus the fixed-width Driver column. */
export type WidthKey = ColumnKey | 'driver';

export const COL_ORDER: ColumnKey[] = [
  'drs',
  'ers',
  'gap',
  'interval',
  'lastLap',
  'bestLap',
  'fuel',
  'penalty',
  'tyre',
  'pit',
  'vmax',
  'sector',
  'damage',
];

/** Default Driver column width (px). Fixed-width so its resize handle follows the
 * cursor and left/right columns don't reflow (FIX: was minmax(128px,1.1fr) which
 * absorbed every resize). Wide enough for "VERSTAPPEN [RBR]". */
export const DRIVER_COL_W = 232;

/** 기본 컬럼폭(px). 리사이즈 시 useDisplayPrefs의 colW가 이 값을 덮어쓴다. */
export const COL_W: Record<ColumnKey, number> = {
  drs: 62,
  ers: 104,
  gap: 72,
  interval: 78,
  lastLap: 86,
  bestLap: 86,
  fuel: 64,
  penalty: 56,
  tyre: 168,
  pit: 56,
  vmax: 64,
  sector: 186,
  damage: 150,
};

/** 테이블 헤더용 풀 라벨. */
export const COL_HEAD: Record<ColumnKey, string> = {
  drs: 'DRS',
  ers: 'ERS',
  gap: 'To You',
  interval: 'Interval',
  lastLap: 'Last Lap',
  bestLap: 'Best Lap',
  fuel: 'Fuel',
  penalty: 'Pen',
  tyre: 'Tyre · Life',
  pit: 'Pit',
  vmax: 'Vmax',
  sector: 'S1 · S2 · S3',
  damage: 'Damage',
};

/** Display Settings 토글 칩용 축약 라벨. */
export const COL_LABEL: Record<ColumnKey, string> = {
  drs: 'DRS',
  ers: 'ERS',
  gap: 'To You',
  interval: 'Interval',
  lastLap: 'Last',
  bestLap: 'Best',
  fuel: 'Fuel',
  penalty: 'Pen',
  tyre: 'Tyre',
  pit: 'Pit',
  vmax: 'Vmax',
  sector: 'Sector',
  damage: 'DMG',
};

export type ColumnAlign = 'center' | 'flex-start' | 'flex-end';

export const COL_ALIGN: Record<ColumnKey, ColumnAlign> = {
  drs: 'center',
  ers: 'flex-start',
  gap: 'flex-end',
  interval: 'flex-end',
  lastLap: 'flex-end',
  bestLap: 'flex-end',
  fuel: 'flex-end',
  penalty: 'center',
  tyre: 'flex-start',
  pit: 'center',
  vmax: 'flex-end',
  sector: 'center',
  damage: 'center',
};

/** 컬럼 헤더 라벨. drs는 2026에서 OVT로 표기(Spec §3). */
export function columnHeadLabel(key: ColumnKey, is2026: boolean): string {
  if (key === 'drs') return is2026 ? 'OVT' : 'DRS';
  return COL_HEAD[key];
}

/** Display Settings 토글 칩 라벨. drs는 2026에서 OVT로 표기. */
export function columnChipLabel(key: ColumnKey, is2026: boolean): string {
  if (key === 'drs') return is2026 ? 'OVT' : 'DRS';
  return COL_LABEL[key];
}

/** 기본 컬럼 가시성. 목업 기준(drs/ers/gap/interval/lastLap/tyre) + 요구사항으로 추가된
 * bestLap/fuel/penalty도 기본 표시(페널티 호버 상세가 기본 상태에서 보여야 함). 나머지=false. */
export const DEFAULT_COL_VISIBILITY: Record<ColumnKey, boolean> = {
  drs: true,
  ers: true,
  gap: true,
  interval: true,
  lastLap: true,
  bestLap: true,
  fuel: true,
  penalty: true,
  tyre: true,
  pit: false,
  vmax: false,
  sector: false,
  damage: false,
};

/** 리사이즈 클램프(Spec §3.5: min 40px). max는 목업 startResize 로직 이식(360px). */
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 360;
