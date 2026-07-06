import { PanelTitle } from '../../ui';
import type { DriverIssue } from './derive/fieldDerivations';

const GRID = '26px 40px minmax(0,1fr) 62px 52px 50px';

const ISSUE_COLOR: Record<Exclude<DriverIssue, null>, string> = {
  pit: 'var(--accent-cyan)',
  penalty: '#eab308',
  damage: 'var(--accent-soft)',
};

export interface OrderRow {
  index: number;
  pos: string;
  posColor: string;
  move: number | null;
  code: string;
  team: string;
  teamColor: string;
  gapL: string;
  intv: string;
  tyre: string;
  tyreColor: string;
  age: number;
  issue: DriverIssue;
  rowBg: string;
}

function moveText(move: number | null): { text: string; color: string } {
  if (move == null || move === 0) return { text: '–', color: 'var(--text-muted)' };
  if (move > 0) return { text: `▲${move}`, color: 'var(--accent-lime)' };
  return { text: `▼${-move}`, color: 'var(--accent-soft)' };
}

const HEAD: Array<{ label: string; align?: 'right' | 'center' }> = [
  { label: 'Pos' },
  { label: '+/−', align: 'center' },
  { label: 'Driver' },
  { label: 'Leader', align: 'right' },
  { label: 'Int', align: 'right' },
  { label: 'Tyre', align: 'center' },
];

export function RunningOrderPanel({ rows, detail }: { rows: OrderRow[]; detail: string }) {
  return (
    <section style={{ minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="Running Order" tone="primary" detail={detail} />
      <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 7, padding: '0 9px 6px', borderBottom: '1px solid var(--bg-panel-border)' }}>
        {HEAD.map((h) => (
          <span key={h.label} style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: h.align }}>
            {h.label}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {rows.map((d) => {
          const mv = moveText(d.move);
          return (
            <div key={d.index} style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 7, padding: '0 9px', background: d.rowBg, borderLeft: `3px solid ${d.teamColor}` }}>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 14, color: d.posColor }}>{d.pos}</span>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 11, color: mv.color, textAlign: 'center' }}>{mv.text}</span>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13.5, letterSpacing: '0.03em', color: 'var(--text-primary)' }}>{d.code}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.team}</span>
                {d.issue ? <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: ISSUE_COLOR[d.issue] }} /> : null}
              </div>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{d.gapL}</span>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right' }}>{d.intv}</span>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 12.5, color: d.tyreColor, textAlign: 'center' }}>
                {d.tyre}
                <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 600 }}> {d.age}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
