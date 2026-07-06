// Mini radar shown on a market card (hub.dc.html:278-281).
import type { HubPerf } from '../data/types';
import type { HubTheme } from '../theme';
import { mkGeo, mkPoly } from './radar';

export function MiniRadar({ t, perf }: { t: HubTheme; perf: Partial<HubPerf> }) {
  const geo = mkGeo(40, 40, 31, 0);
  const poly = mkPoly(perf, 40, 40, 31);
  return (
    <svg viewBox="0 0 80 80" style={{ width: 72, height: 72, flex: 'none' }}>
      {geo.rings.map((r, i) => (
        <polygon key={i} points={r.pts} style={{ fill: 'none', stroke: t.line, strokeWidth: 1 }} />
      ))}
      <polygon
        points={poly.data}
        style={{ fill: t.accSoft, stroke: t.acc, strokeWidth: 1.5, strokeLinejoin: 'round' }}
      />
    </svg>
  );
}
