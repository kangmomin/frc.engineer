import { COL_ORDER, columnChipLabel, type ColumnKey } from './columns';
import { DISPLAY_SETTINGS_ID } from './PitWallHeader';
import type { PanelKey } from './useDisplayPrefs';

const PANEL_CHIPS: Array<{ key: PanelKey; label: string }> = [
  { key: 'myCar', label: 'My Car' },
  { key: 'predictor', label: 'Predictor' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'weather', label: 'Weather' },
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Side Panels</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PANEL_CHIPS.map((p) => (
            <button key={p.key} onClick={() => onTogglePanel(p.key)} style={chipStyle(panels[p.key])}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, borderTop: '1px solid var(--bg-panel-border)', paddingTop: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Columns</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COL_ORDER.map((key) => (
            <button key={key} onClick={() => onToggleCol(key)} style={chipStyle(cols[key])}>
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
