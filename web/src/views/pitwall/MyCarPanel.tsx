import { PanelTitle } from '../../ui';
import type { MyCarVM, PitWindowVM } from './derive/myCar';
import styles from './PitWallView.module.css';

const tile: React.CSSProperties = {
  padding: '6px 9px',
  background: 'rgba(14,14,15,.5)',
  border: '1px solid var(--bg-panel-border)',
  borderRadius: 2,
};

const tileLabel: React.CSSProperties = {
  fontSize: 9.5,
  letterSpacing: '.08em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const tileValue: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 14 };

const PIT_WINDOW_STYLE: Record<PitWindowVM['tone'], { bg: string; border: string; dot: string; text: string }> = {
  open: { bg: 'rgba(205,255,19,.1)', border: 'rgba(205,255,19,.3)', dot: 'var(--accent-lime)', text: 'var(--accent-lime)' },
  upcoming: { bg: 'rgba(0,229,255,.08)', border: 'rgba(0,229,255,.25)', dot: 'var(--accent)', text: 'var(--accent)' },
  closed: { bg: 'rgba(132,147,150,.08)', border: 'var(--bg-panel-border)', dot: 'var(--text-muted)', text: 'var(--text-muted)' },
};

export function MyCarPanel({ car, detail }: { car: MyCarVM | null; detail: string }) {
  if (!car) {
    return (
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PanelTitle title="My Car" tone="primary" detail={detail} />
        <div role="status" style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No player car in feed</div>
      </div>
    );
  }

  const pw = car.pitWindow;
  const pwStyle = pw ? PIT_WINDOW_STYLE[pw.tone] : null;

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="My Car" tone="primary" detail={detail} />
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
        <div style={{ flex: 'none', width: 78, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.28)', borderRadius: 'var(--radius-md)', padding: '7px 0' }}>
          <span style={{ fontSize: 9.5, letterSpacing: '.16em', color: 'var(--text-muted)' }}>POS</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 40, lineHeight: 0.95, color: 'var(--accent)' }}>{car.position}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '6px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: '3px solid var(--accent)', borderRadius: 2 }}>
            <span style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>▲ {car.aheadCode}</span>
            <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 20, lineHeight: 1, color: 'var(--accent)' }}>{car.gapAhead}</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '6px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: '3px solid var(--text-secondary)', borderRadius: 2 }}>
            <span style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>▼ {car.behindCode}</span>
            <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 20, lineHeight: 1, color: 'var(--text-secondary)' }}>{car.gapBehind}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
        <div style={tile}>
          <div style={tileLabel}>Last</div>
          <div style={{ ...tileValue, color: 'var(--text-primary)' }}>{car.lastLapText}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Delta</div>
          <div style={{ ...tileValue, color: car.deltaColor }}>{car.deltaText}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>ERS</div>
          <div style={{ ...tileValue, color: 'var(--accent)' }}>{car.ersText}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-sm)' }}>
        <span style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', border: `3px solid ${car.compoundColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 15, color: car.compoundColor }}>
          {car.compound}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13 }}>{car.compoundName}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '.04em' }}>Age {car.tireAge} · Wear {car.wearText}</div>
        </div>
      </div>
      {pw && pwStyle && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 'var(--radius-md)', background: pwStyle.bg, border: `1px solid ${pwStyle.border}` }}>
          <span className={styles.pulse} style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: pwStyle.dot, boxShadow: `0 0 10px ${pwStyle.dot}` }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13, color: pwStyle.text }}>{pw.title}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{pw.rangeText}{pw.rejoinText ? ` · ${pw.rejoinText}` : ''}</div>
          </div>
        </div>
      )}
    </div>
  );
}
