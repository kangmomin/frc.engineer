import { useEffect } from 'react';
import { COL_ORDER, columnChipLabel, type ColumnKey } from './columns';
import { DISPLAY_SETTINGS_ID } from './PitWallHeader';
import type { PanelKey } from './useDisplayPrefs';

const PANELS_SECTION_LABEL_ID = 'pitwall-settings-panels-label';
const COLUMNS_SECTION_LABEL_ID = 'pitwall-settings-columns-label';

const PANEL_CHIPS: Array<{ key: PanelKey; label: string }> = [
  { key: 'myCar', label: 'My Car' },
  { key: 'predictor', label: 'Predictor' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'weather', label: 'Weather' },
  { key: 'tyres', label: 'Tyre Strip' },
];

function chipStyle(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 11.5,
    padding: '6px 13px',
    borderRadius: 999,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#0c0c0d' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--bg-panel-border)'}`,
  };
}

export interface DisplaySettingsProps {
  cols: Record<ColumnKey, boolean>;
  onToggleCol: (key: ColumnKey) => void;
  panels: Record<PanelKey, boolean>;
  onTogglePanel: (key: PanelKey) => void;
  onResetWidths: () => void;
  is2026: boolean;
  onClose: () => void;
}

/**
 * 목업 Display Settings 팝오버 이식. Game Version/Update Rate 섹션은 Spec §9에 따라
 * DEFER(gameFormat이 authoritative, cockpit 데이터는 저빈도라 rate override 가치 낮음) —
 * 컬럼 가시성/패널 가시성/컬럼폭 리셋만 남긴다.
 */
export function DisplaySettings({ cols, onToggleCol, panels, onTogglePanel, onResetWidths, is2026, onClose }: DisplaySettingsProps) {
  // 비-모달 팝오버(Spec FIX-6) — aria-modal/focus-trap 없이 Escape로만 닫는다. 트리거
  // 버튼으로의 포커스 복귀는 이 컴포넌트를 언마운트하는 부모(PitWallView)의 onClose 책임이다.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      id={DISPLAY_SETTINGS_ID}
      role="dialog"
      aria-label="Display settings"
      style={{
        position: 'absolute',
        top: 66,
        right: 14,
        zIndex: 30,
        width: 300,
        background: 'var(--bg-surface-elevated)',
        border: '1px solid var(--bg-panel-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 14px 44px rgba(0,0,0,.6)',
        padding: 15,
        display: 'flex',
        flexDirection: 'column',
        gap: 15,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>Display Settings</span>
        <button onClick={onClose} aria-label="Close display settings" style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 17, lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div role="group" aria-labelledby={PANELS_SECTION_LABEL_ID} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span id={PANELS_SECTION_LABEL_ID} style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Side Panels</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PANEL_CHIPS.map((p) => (
            <button key={p.key} onClick={() => onTogglePanel(p.key)} aria-pressed={panels[p.key]} style={chipStyle(panels[p.key])}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-labelledby={COLUMNS_SECTION_LABEL_ID} style={{ display: 'flex', flexDirection: 'column', gap: 9, borderTop: '1px solid var(--bg-panel-border)', paddingTop: 12 }}>
        <span id={COLUMNS_SECTION_LABEL_ID} style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Columns</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COL_ORDER.map((key) => (
            <button key={key} onClick={() => onToggleCol(key)} aria-pressed={cols[key]} style={chipStyle(cols[key])}>
              {columnChipLabel(key, is2026)}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>Drag a column header's right edge to resize.</div>
        <button
          onClick={onResetWidths}
          style={{ cursor: 'pointer', alignSelf: 'flex-start', fontWeight: 600, fontSize: 11, padding: '6px 13px', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--bg-panel-border)' }}
        >
          Reset column widths
        </button>
      </div>
    </div>
  );
}
