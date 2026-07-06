import { MetricTile, PanelTitle } from '../../ui';
import type { FieldStatus, TyreLabel } from './derive/fieldDerivations';

// S/M/H 는 항상 표시(드라이 목업 기준), I/W 는 장착 차량이 있을 때만 표시(우천 커버리지).
const TYRE_DOT: Array<{ key: TyreLabel; color: string; name: string; base: boolean }> = [
  { key: 'S', color: '#ff525c', name: 'Soft', base: true },
  { key: 'M', color: '#E8D63D', name: 'Medium', base: true },
  { key: 'H', color: '#e5e2e3', name: 'Hard', base: true },
  { key: 'I', color: '#43d67c', name: 'Inter', base: false },
  { key: 'W', color: '#5aa9e6', name: 'Wet', base: false },
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
          {TYRE_DOT.filter((t) => t.base || field.tyreCounts[t.key] > 0).map((t) => (
            <div key={t.key} title={`${t.name}: ${field.tyreCounts[t.key]}`} aria-label={`${t.name}: ${field.tyreCounts[t.key]}`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '5px 0', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 2 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color }} />
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13 }}>{field.tyreCounts[t.key]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
