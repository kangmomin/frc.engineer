import { useMemo } from 'react';
import { finite, pathFor, sampleRuns, sampleSegments, valueAt, type Runs, type SelectedLapTrace, type TraceRange } from './analysisTrace';
export interface TraceTheme { surface2: string; text: string; muted: string; accent: string; accent2: string; border: string; bg: string }
export function TraceChart({ title, unit, a, b = [], range, cursor, setCursor, theme, step = false, dots = false, derived = false }: {
  title: string; unit: string; a: Runs; b?: Runs; range: TraceRange; cursor: number; setCursor: (d: number) => void; theme: TraceTheme; step?: boolean; dots?: boolean; derived?: boolean;
}) {
  const visible = [...a, ...b].flat().filter(p => p.d >= range.fromM && p.d <= range.toM);
  let min = Infinity, max = -Infinity;
  for (const p of visible) { min = Math.min(min, p.v); max = Math.max(max, p.v); }
  if (!visible.length) return <div>{title}: No aligned observations in this window.</div>;
  if (min === max) { min -= .5; max += .5; }
  const x = (d: number) => (d - range.fromM) / (range.toM - range.fromM) * 640;
  const y = (v: number) => 134 - (v - min) / (max - min) * 128;
  const fmt = (v: number | null) => v === null ? 'unavailable here' : `${v.toFixed(2)} ${unit}`;
  return <div style={{ background: theme.surface2, border: `1px solid ${theme.border}`, padding: 12, borderRadius: 'var(--radius-md)', display: 'grid', gap: 6 }}>
    <strong>{title} {unit ? `(${unit})` : ''}</strong>
    <div style={{ color: theme.muted }}>{derived ? "Compare − Baseline" : "Baseline — solid"}: {fmt(valueAt(a, cursor, step))}{!derived && <> · Compare – dashed: {fmt(valueAt(b, cursor, step))}</>}</div>
    <svg role="img" aria-label={`${title} by distance`} viewBox="0 0 640 140" style={{ width: '100%', display: 'block', cursor: 'crosshair' }} onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect(); setCursor(range.fromM + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (range.toM - range.fromM));
    }}>
      <title>{title}: {derived ? "Clock difference at shared observed distances." : "Recorded samples without averaging. Baseline solid; compare dashed."}</title>
      {[a, b].map((runs, side) => <g key={side} fill="none" style={{ stroke: side ? theme.accent2 : theme.accent }}>
        {!dots && <path d={pathFor(runs, range, min, max, 640, 140, step)} strokeWidth="1.5" strokeDasharray={side ? '7 4' : undefined} />}
        {runs.flatMap((run, ri) => (dots || run.length === 1 ? run : []).filter(p => p.d >= range.fromM && p.d <= range.toM).map((p, pi) => side ?
          <rect key={`${ri}-${pi}`} x={x(p.d) - 2} y={y(p.v) - 2} width="4" height="4" /> : <circle key={`${ri}-${pi}`} cx={x(p.d)} cy={y(p.v)} r="2" />))}
      </g>)}
      <line x1={x(cursor)} x2={x(cursor)} y1="0" y2="140" style={{ stroke: theme.text }} strokeDasharray="2 3" />
    </svg>
    <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.muted }}><span>{range.fromM.toFixed(1)} m</span><span>{visible.length} {derived ? "distance positions" : "native observations"} · {min.toFixed(2)}…{max.toFixed(2)} {unit}</span><span>{range.toM.toFixed(1)} m</span></div>
  </div>;
}
function mapRuns(trace: SelectedLapTrace | undefined) {
  const rows = (trace?.motion ?? []).map(row => finite(row.xM) && finite(row.zM) ? row : { ...row, xM: null, zM: null });
  return { x: sampleRuns(rows, r => r.xM), z: sampleRuns(rows, r => r.zM), positions: sampleSegments(rows, row => finite(row.xM) && finite(row.zM)) };
}
export function ObservedMap({ a, b, range, cursor, theme }: { a?: SelectedLapTrace; b?: SelectedLapTrace; range: TraceRange; cursor: number; theme: TraceTheme }) {
  const maps = useMemo(() => [mapRuns(a), mapRuns(b)], [a, b]);
  const points = maps.flatMap(map => map.positions.flat().filter(row => row.distanceM! >= range.fromM && row.distanceM! <= range.toM));
  if (!points.length) return <p>Observed map unavailable: no aligned X/Z positions in this window.</p>;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.xM!); maxX = Math.max(maxX, p.xM!); minZ = Math.min(minZ, p.zM!); maxZ = Math.max(maxZ, p.zM!); }
  const scale = Math.min(600 / (maxX - minX || 1), 260 / (maxZ - minZ || 1));
  const x = (v: number) => 320 + (v - (minX + maxX) / 2) * scale;
  const z = (v: number) => 150 + (v - (minZ + maxZ) / 2) * scale;
  return <div><strong>Recorded X/Z map (metres)</strong><p style={{ color: theme.muted }}>Shared scale; open paths follow recorded positions. Baseline circle / solid, Compare square / dashed.</p>
    <svg role="img" aria-label="Observed track positions and distance cursor" viewBox="0 0 640 300" style={{ width: '100%', maxHeight: 300 }}>
      <title>Actual recorded X/Z positions; no ideal racing line or inferred closure.</title>
      {maps.map((map, side) => {
        const mx = valueAt(map.x, cursor), mz = valueAt(map.z, cursor);
        return <g key={side} style={{ stroke: side ? theme.accent2 : theme.accent }} fill="none">
          {map.positions.map((run, ri) => <path key={ri} d={run.filter(p => p.distanceM! >= range.fromM && p.distanceM! <= range.toM).map((p, pi) => `${pi ? 'L' : 'M'} ${x(p.xM!).toFixed(2)} ${z(p.zM!).toFixed(2)}`).join(' ')} strokeWidth="2" strokeDasharray={side ? '7 4' : undefined} />)}
          {mx !== null && mz !== null && (side ? <rect x={x(mx) - 5} y={z(mz) - 5} width="10" height="10" strokeWidth="3" /> : <circle cx={x(mx)} cy={z(mz)} r="5" strokeWidth="3" />)}
        </g>;
      })}
    </svg>
    {maps.map((map, side) => <div key={side}>{side ? 'Compare' : 'Baseline'} cursor: {valueAt(map.x, cursor)?.toFixed(2) ?? 'unavailable'} X, {valueAt(map.z, cursor)?.toFixed(2) ?? 'unavailable'} Z (m)</div>)}
  </div>;
}
