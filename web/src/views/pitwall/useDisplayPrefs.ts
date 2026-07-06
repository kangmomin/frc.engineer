import { useMemo } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { clamp } from '../../utils/formatters';
import { COL_ORDER, COL_W, DEFAULT_COL_VISIBILITY, MAX_COL_WIDTH, MIN_COL_WIDTH, type ColumnKey } from './columns';

export type PanelKey = 'myCar' | 'predictor' | 'strategy' | 'weather';

/** 기본 우측 레일 패널 가시성(Spec §4: myCar/predictor/strategy=true, weather=false). */
export const DEFAULT_PANEL_VISIBILITY: Record<PanelKey, boolean> = {
  myCar: true,
  predictor: true,
  strategy: true,
  weather: false,
};

export const WEATHER_STEP_OPTIONS = [1, 5, 10, 15] as const;

function validateCols(parsed: unknown): Record<ColumnKey, boolean> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  return { ...DEFAULT_COL_VISIBILITY, ...(parsed as Partial<Record<ColumnKey, boolean>>) };
}

function validateColW(parsed: unknown): Partial<Record<ColumnKey, number>> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as Partial<Record<ColumnKey, number>>;
}

function validatePanels(parsed: unknown): Record<PanelKey, boolean> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  return { ...DEFAULT_PANEL_VISIBILITY, ...(parsed as Partial<Record<PanelKey, boolean>>) };
}

function validateWeatherStep(parsed: unknown): number | null {
  return typeof parsed === 'number' && (WEATHER_STEP_OPTIONS as readonly number[]).includes(parsed) ? parsed : null;
}

export interface DisplayPrefs {
  cols: Record<ColumnKey, boolean>;
  toggleCol: (key: ColumnKey) => void;
  colW: Record<ColumnKey, number>;
  startResize: (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => void;
  resetWidths: () => void;
  panels: Record<PanelKey, boolean>;
  togglePanel: (key: PanelKey) => void;
  weatherStep: number;
  setWeatherStep: (step: number) => void;
}

/**
 * Pit Wall 표시 설정(컬럼 가시성/폭 · 패널 가시성 · forecast step)을 localStorage에
 * 영속한다(Spec §3.5/§4/§4.3: pw_cols/pw_colw/pw_panels/pw_wstep). 파싱 실패/부재 시
 * useLocalStorage의 validate 콜백이 기본값으로 폴백한다(try/catch는 훅 내부에 있음).
 */
export function useDisplayPrefs(): DisplayPrefs {
  const [cols, setCols] = useLocalStorage<Record<ColumnKey, boolean>>('pw_cols', DEFAULT_COL_VISIBILITY, validateCols);
  const [colW, setColW] = useLocalStorage<Partial<Record<ColumnKey, number>>>('pw_colw', {}, validateColW);
  const [panels, setPanels] = useLocalStorage<Record<PanelKey, boolean>>('pw_panels', DEFAULT_PANEL_VISIBILITY, validatePanels);
  const [weatherStep, setWeatherStep] = useLocalStorage<number>('pw_wstep', 5, validateWeatherStep);

  const toggleCol = (key: ColumnKey) => setCols((prev) => ({ ...prev, [key]: !prev[key] }));
  const togglePanel = (key: PanelKey) => setPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  const resetWidths = () => setColW({});

  // 목업 startResize(pointerdown→document pointermove/pointerup) 패턴 이식.
  // legacy와 달리 pointerup에서 수동 저장하지 않는다 — useLocalStorage가 값이
  // 바뀔 때마다(=드래그 중 매 프레임) 자동으로 write-through 하기 때문(§3.5).
  const startResize = (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colW[key] ?? COL_W[key];
    const onMove = (ev: PointerEvent) => {
      const w = clamp(startW + (ev.clientX - startX), MIN_COL_WIDTH, MAX_COL_WIDTH);
      setColW((prev) => ({ ...prev, [key]: Math.round(w) }));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const resolvedColW = useMemo(() => {
    const result = {} as Record<ColumnKey, number>;
    for (const k of COL_ORDER) result[k] = colW[k] ?? COL_W[k];
    return result;
  }, [colW]);

  return { cols, toggleCol, colW: resolvedColW, startResize, resetWidths, panels, togglePanel, weatherStep, setWeatherStep };
}
