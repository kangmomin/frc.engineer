import type { TyreDetailVM } from './derive/tyreDetail';

const raceFont: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 700 };

export interface TyreDetailStripProps {
  detail: TyreDetailVM;
  driverName: string;
}

/** Player 4-wheel tyre wear + temperature strip, shown below the leaderboard.
 * VM-only pure component. */
export function TyreDetailStrip({ detail, driverName }: TyreDetailStripProps) {
  return (
    <section
      aria-label="Player tyre wear and temperature"
      style={{
        flex: 'none',
        background: 'var(--bg-panel)',
        border: '1px solid var(--bg-panel-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ ...headLabel, flex: 'none' }}>
        Tyres
        <span style={{ display: 'block', fontSize: 9, color: 'var(--text-secondary)', letterSpacing: '.02em', textTransform: 'none' }}>{driverName}</span>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9 }}>
        {detail.wheels.map((w) => (
          <div
            key={w.label}
            style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 9px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 4 }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--text-muted)' }}>{w.label}</span>
              <span style={{ ...raceFont, fontWeight: 800, fontSize: 14, color: w.wearColor }}>{w.wearText}</span>
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', letterSpacing: '.02em' }}>{w.tempText}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const headLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};
