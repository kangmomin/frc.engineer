import { useEffect, useState } from 'react';
import { clamp } from '../../utils/formatters';
import { COL_ORDER, columnChipLabel, type ColumnKey } from './columns';
import { DISPLAY_SETTINGS_ID } from './PitWallHeader';
import { PIT_LOSS_MAX_SEC, PIT_LOSS_MIN_SEC, WING_EXTRA_MAX_SEC, WING_EXTRA_MIN_SEC, type PanelKey } from './useDisplayPrefs';

const PANELS_SECTION_LABEL_ID = 'pitwall-settings-panels-label';
const COLUMNS_SECTION_LABEL_ID = 'pitwall-settings-columns-label';
const PITLOSS_SECTION_LABEL_ID = 'pitwall-settings-pitloss-label';
const WING_EXTRA_LABEL_ID = 'pitwall-settings-wing-extra-label';

const PANEL_CHIPS: Array<{ key: PanelKey; label: string }> = [
  { key: 'myCar', label: 'My Car' },
  { key: 'predictor', label: 'Predictor' },
  { key: 'pitExit', label: 'Pit Exit' },
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
  /** 사용자 입력 피트로스(초). 커밋하면 override로 최우선 적용. */
  pitLossSec: number;
  onChangePitLossSec: (sec: number) => void;
  pitLossOverride: boolean;
  onClearPitLossOverride: () => void;
  useLivePitLoss: boolean;
  onChangeUseLivePitLoss: (on: boolean) => void;
  wingExtraSec: number;
  onChangeWingExtraSec: (sec: number) => void;
  onClose: () => void;
}

const numberInputStyle: React.CSSProperties = { width: 72, padding: '6px 9px', borderRadius: 'var(--radius-sm)', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13 };

/**
 * 초 단위 숫자 입력. 타이핑 중엔 draft로 두고 blur/Enter에서만 커밋한다(E1): 빈 값/NaN이면
 * 커밋하지 않고 마지막 유효값으로 되돌린다. 편집하지 않은 채 blur만 한 경우는 커밋하지 않는다
 * (포커스만 스쳐도 피트로스 override가 켜지는 것 방지).
 */
function SecondsField({ value, min, max, labelledBy, onCommit }: { value: number; min: number; max: number; labelledBy: string; onCommit: (sec: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = (raw: string) => {
    if (!dirty) return;
    setDirty(false);
    const v = Number(raw);
    if (Number.isFinite(v) && raw.trim() !== '') {
      const clamped = clamp(v, min, max);
      onCommit(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={0.5}
      value={draft}
      aria-labelledby={labelledBy}
      onChange={(e) => {
        setDraft(e.currentTarget.value);
        setDirty(true);
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      style={numberInputStyle}
    />
  );
}

/**
 * 목업 Display Settings 팝오버 이식. Game Version/Update Rate 섹션은 Spec §9에 따라
 * DEFER(gameFormat이 authoritative, cockpit 데이터는 저빈도라 rate override 가치 낮음) —
 * 컬럼 가시성/패널 가시성/컬럼폭 리셋만 남긴다.
 */
export function DisplaySettings({
  cols, onToggleCol, panels, onTogglePanel, onResetWidths, is2026,
  pitLossSec, onChangePitLossSec, pitLossOverride, onClearPitLossOverride, useLivePitLoss, onChangeUseLivePitLoss, wingExtraSec, onChangeWingExtraSec,
  onClose,
}: DisplaySettingsProps) {
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
      aria-label="Settings"
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
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>Settings</span>
        <button onClick={onClose} aria-label="Close settings" style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 17, lineHeight: 1 }}>
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

      <div role="group" aria-labelledby={PITLOSS_SECTION_LABEL_ID} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--bg-panel-border)', paddingTop: 12 }}>
        <span id={PITLOSS_SECTION_LABEL_ID} style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pit Stop</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SecondsField value={pitLossSec} min={PIT_LOSS_MIN_SEC} max={PIT_LOSS_MAX_SEC} labelledBy={PITLOSS_SECTION_LABEL_ID} onCommit={onChangePitLossSec} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>sec</span>
          {pitLossOverride && (
            <button type="button" onClick={onClearPitLossOverride} style={{ ...chipStyle(false), marginLeft: 'auto', padding: '4px 10px' }}>
              Auto
            </button>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {pitLossOverride
            ? 'Manual pit-loss — applied now, overrides live and track values. Press Auto to go back.'
            : 'Auto: live (if enabled) → track data → this value. Enter a value to override.'}
        </div>
        <button type="button" aria-pressed={useLivePitLoss} onClick={() => onChangeUseLivePitLoss(!useLivePitLoss)} style={{ ...chipStyle(useLivePitLoss), alignSelf: 'flex-start' }}>
          Use live pit-loss
        </button>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          After your stop, the measured pit-lane time is used. It includes driving through the lane, so it can read a few seconds high.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span id={WING_EXTRA_LABEL_ID} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Wing change +</span>
          <SecondsField value={wingExtraSec} min={WING_EXTRA_MIN_SEC} max={WING_EXTRA_MAX_SEC} labelledBy={WING_EXTRA_LABEL_ID} onCommit={onChangeWingExtraSec} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>sec</span>
        </div>
      </div>
    </div>
  );
}
