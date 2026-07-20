import { useMemo, useState } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { clamp } from '../../utils/formatters';
import { COL_ORDER, COL_W, DEFAULT_COL_VISIBILITY, DRIVER_COL_W, MAX_COL_WIDTH, MIN_COL_WIDTH, type ColumnKey, type WidthKey } from './columns';

/** Every resizable width key: the visible columns plus the fixed Driver column. */
const WIDTH_KEYS: WidthKey[] = [...COL_ORDER, 'driver'];

/** Default width for any width key (Driver has its own default, not in COL_W). */
function defaultWidth(key: WidthKey): number {
  return key === 'driver' ? DRIVER_COL_W : COL_W[key];
}

export type PanelKey = 'myCar' | 'predictor' | 'pitExit' | 'strategy' | 'weather' | 'tyres';

/** 기본 패널 가시성. tyres는 좌측 리더보드 하단의 4휠 마모/온도 스트립(기본 표시). */
export const DEFAULT_PANEL_VISIBILITY: Record<PanelKey, boolean> = {
  myCar: true,
  predictor: true,
  pitExit: true,
  strategy: true,
  weather: false,
  tyres: true,
};

export const WEATHER_STEP_OPTIONS = [1, 5, 10, 15] as const;

/** 폴백 피트로스 설정 범위(초). sender PitTimeLossMs clamp(5000~60000ms, cmd/sender/main.go:1224)와 동일 정책. */
export const PIT_LOSS_MIN_SEC = 5;
export const PIT_LOSS_MAX_SEC = 60;
/** 기본 폴백 피트로스(초). sender defaultStrategyConfig.PitTimeLossMs(22000ms)와 일치. */
export const DEFAULT_PIT_LOSS_SEC = 22;

/** FIX-3: 값 타입까지 검증한다(문자열 등 이물 값이 boolean 자리에 섞이는 것을 방지). */
function validateCols(parsed: unknown): Record<ColumnKey, boolean> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const result = { ...DEFAULT_COL_VISIBILITY };
  for (const key of COL_ORDER) {
    const value = (parsed as Partial<Record<ColumnKey, unknown>>)[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

/**
 * FIX-3: 숫자·유한값만 통과시키고 [MIN_COL_WIDTH, MAX_COL_WIDTH]로 clamp한다. 기존에는
 * `typeof`/범위 검증 없이 그대로 신뢰해 손상된 값("abc" 등)이 `${colW[k]}px` 템플릿에
 * 그대로 들어가 grid를 깨뜨릴 수 있었다(comp-L2).
 */
function validateColW(parsed: unknown): Partial<Record<WidthKey, number>> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const result: Partial<Record<WidthKey, number>> = {};
  for (const key of WIDTH_KEYS) {
    const value = (parsed as Partial<Record<WidthKey, unknown>>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = clamp(value, MIN_COL_WIDTH, MAX_COL_WIDTH);
    }
  }
  return result;
}

function validatePanels(parsed: unknown): Record<PanelKey, boolean> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  return { ...DEFAULT_PANEL_VISIBILITY, ...(parsed as Partial<Record<PanelKey, boolean>>) };
}

function validateWeatherStep(parsed: unknown): number | null {
  return typeof parsed === 'number' && (WEATHER_STEP_OPTIONS as readonly number[]).includes(parsed) ? parsed : null;
}

/** 숫자·유한값만 통과시키고 [PIT_LOSS_MIN_SEC, PIT_LOSS_MAX_SEC]로 clamp한다(validateColW 선례). */
function validatePitLossSec(parsed: unknown): number | null {
  return typeof parsed === 'number' && Number.isFinite(parsed) ? clamp(parsed, PIT_LOSS_MIN_SEC, PIT_LOSS_MAX_SEC) : null;
}

export interface DisplayPrefs {
  cols: Record<ColumnKey, boolean>;
  toggleCol: (key: ColumnKey) => void;
  colW: Record<WidthKey, number>;
  startResize: (key: WidthKey, e: React.PointerEvent<HTMLDivElement>) => void;
  nudgeWidth: (key: WidthKey, delta: number) => void;
  resetWidths: () => void;
  panels: Record<PanelKey, boolean>;
  togglePanel: (key: PanelKey) => void;
  weatherStep: number;
  setWeatherStep: (step: number) => void;
  /** 트랙 데이터 결측 시 쓰는 폴백 피트로스(초). */
  pitLossSec: number;
  setPitLossSec: (sec: number) => void;
}

interface DragState {
  key: WidthKey;
  width: number;
}

/**
 * Pit Wall 표시 설정(컬럼 가시성/폭 · 패널 가시성 · forecast step)을 localStorage에
 * 영속한다(Spec §3.5/§4/§4.3: pw_cols/pw_colw/pw_panels/pw_wstep). 파싱 실패/부재 시
 * useLocalStorage의 validate 콜백이 기본값으로 폴백한다(try/catch는 훅 내부에 있음).
 */
export function useDisplayPrefs(): DisplayPrefs {
  const [cols, setCols] = useLocalStorage<Record<ColumnKey, boolean>>('pw_cols', DEFAULT_COL_VISIBILITY, validateCols);
  const [colW, setColW] = useLocalStorage<Partial<Record<WidthKey, number>>>('pw_colw', {}, validateColW);
  const [panels, setPanels] = useLocalStorage<Record<PanelKey, boolean>>('pw_panels', DEFAULT_PANEL_VISIBILITY, validatePanels);
  const [weatherStep, setWeatherStep] = useLocalStorage<number>('pw_wstep', 5, validateWeatherStep);
  const [pitLossSec, setPitLossSecRaw] = useLocalStorage<number>('pw_pitloss', DEFAULT_PIT_LOSS_SEC, validatePitLossSec);
  // 드래그 중 실시간 시각 폭(비영속, plain state). pointermove마다 이 state만 갱신하고,
  // 영속 colW(및 그에 딸린 localStorage write)는 pointerup 1회로만 커밋한다(FIX-3/comp-H1:
  // 매 프레임 컨테이너 전체 재렌더 + localStorage 동기 write가 발생하던 hot-path 제거).
  const [dragState, setDragState] = useState<DragState | null>(null);

  const toggleCol = (key: ColumnKey) => setCols((prev) => ({ ...prev, [key]: !prev[key] }));
  const togglePanel = (key: PanelKey) => setPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  const resetWidths = () => setColW({});
  // 유한값만 clamp해 커밋한다(NaN/빈 입력이 pitLossMs=NaN으로 흘러 패널이 unavailable로 회귀하는 것을 방지).
  const setPitLossSec = (sec: number) => {
    if (Number.isFinite(sec)) setPitLossSecRaw(clamp(sec, PIT_LOSS_MIN_SEC, PIT_LOSS_MAX_SEC));
  };

  /** 키보드 리사이즈(←/→ ±10px 등)용. 드래그와 동일하게 clamp를 재사용하고, no-op이면 setColW를 생략한다. */
  const nudgeWidth = (key: WidthKey, delta: number) => {
    setColW((prev) => {
      const current = prev[key] ?? defaultWidth(key);
      const next = Math.round(clamp(current + delta, MIN_COL_WIDTH, MAX_COL_WIDTH));
      return current === next ? prev : { ...prev, [key]: next };
    });
  };

  // 목업 startResize(pointerdown→document pointermove/pointerup) 패턴 이식 + FIX-3 보강:
  // ① no-op 가드(반올림 폭이 이전과 같으면 state 갱신 생략) ② pointerup에서만 영속 커밋
  // ③ pointercancel(OS 제스처 인터럽트 등)은 커밋 없이 드래그 취소 ④ 핸들에 pointer capture.
  const startResize = (key: WidthKey, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    handle.setPointerCapture?.(pointerId);
    const startX = e.clientX;
    const startW = colW[key] ?? defaultWidth(key);
    let liveWidth = startW;

    const onMove = (ev: PointerEvent) => {
      liveWidth = clamp(startW + (ev.clientX - startX), MIN_COL_WIDTH, MAX_COL_WIDTH);
      const rounded = Math.round(liveWidth);
      setDragState((prev) => (prev && prev.key === key && prev.width === rounded ? prev : { key, width: rounded }));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      handle.releasePointerCapture?.(pointerId);
      const rounded = Math.round(liveWidth);
      setColW((prev) => (prev[key] === rounded ? prev : { ...prev, [key]: rounded }));
      setDragState(null);
    };
    const onCancel = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      handle.releasePointerCapture?.(pointerId);
      setDragState(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  };

  const resolvedColW = useMemo(() => {
    const result = {} as Record<WidthKey, number>;
    for (const k of WIDTH_KEYS) result[k] = colW[k] ?? defaultWidth(k);
    if (dragState) result[dragState.key] = dragState.width;
    return result;
  }, [colW, dragState]);

  return { cols, toggleCol, colW: resolvedColW, startResize, nudgeWidth, resetWidths, panels, togglePanel, weatherStep, setWeatherStep, pitLossSec, setPitLossSec };
}
