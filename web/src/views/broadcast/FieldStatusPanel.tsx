import { MetricTile, PanelTitle } from '../../ui';
import type { FieldStatus } from './derive/fieldDerivations';

const TYRE_DOT: Array<{ key: 'S' | 'M' | 'H'; color: string }> = [
  { key: 'S', color: '#ff525c' },
  { key: 'M', color: '#E8D63D' },
  { key: 'H', color: '#e5e2e3' },
];

export function FieldStatusPanel({ field }: { field: FieldStatus }) {
  return (
    <div style={{ flex: 'none', background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PanelTitle title="Field Status" tone="primary" detail={`${field.fieldSize} Cars`} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MetricTile label="Pitted" value={String(field.pittedCount)} tone="primary" note={`Of ${field.fieldSize}`} compact />
        <MetricTile label="Damaged" value={String(field.damagedCount)} tone="secondary" note="Cars" compact />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', width: 44 }}>Tyres</span>
        <div style={{ flex: 1, display: 'flex', gap: 6 }}>
          {TYRE_DOT.map((t) => (
            <div key={t.key} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '5px 0', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 2 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color }} />
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13 }}>{field.tyreCounts[t.key]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
