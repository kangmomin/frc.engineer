import type { ReplayTrackBoundaries, TrackWorldPoint } from '../../constants/replayTrackBoundaries';

type Project = (x: number, z: number) => { x: number; y: number };

const pathFor = (points: TrackWorldPoint[], project: Project) => points.map(([x, , z], index) => {
  const point = project(x, z);
  return `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`;
}).join(' ');

export function ReplayTrackSurface({ boundaries, project }: { boundaries: ReplayTrackBoundaries; project: Project }) {
  return <g aria-label="참조 트랙 경계와 도로 영역">
    {boundaries.features.filter(({ kind }) => kind !== 'wall').map(({ kind, points }, index) => <path key={`${kind}:${index}`} d={`${pathFor(points, project)} Z`} fill={kind === 'kerb' ? '#b96858' : '#889878'} opacity=".3" />)}
    {boundaries.segments.map(({ id, sections }) => <g key={id} data-boundary-segment={id}>
      {sections.slice(1).map((next, index) => {
        const previous = sections[index];
        // A missing side breaks the surface. Never close a gap, connect two
        // segments, or derive the edge by offsetting the recorded racing line.
        return <g key={index}>
          {previous.left && previous.right && next.left && next.right && <path data-road-surface d={`${pathFor([previous.left, next.left, next.right, previous.right], project)} Z`} fill="var(--analysis-line2, #d3d7dd)" opacity=".6" />}
          {(['left', 'right'] as const).map((side) => previous[side] && next[side] ? <path key={side} data-road-edge={side} d={pathFor([previous[side], next[side]], project)} fill="none" stroke="var(--analysis-text, #1a1d24)" strokeWidth="1.25" /> : null)}
        </g>;
      })}
    </g>)}
    {boundaries.features.filter(({ kind }) => kind === 'wall').map(({ points }, index) => <path key={index} data-road-wall d={pathFor(points, project)} fill="none" stroke="#b5533f" strokeWidth="2.5" />)}
  </g>;
}

export function ReplayScaleBar({ project, height }: { project: Project; height: number }) {
  const origin = project(0, 0);
  const metre = project(1, 0);
  const pixelsPerMetre = Math.hypot(metre.x - origin.x, metre.y - origin.y);
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return null;
  const target = 90 / pixelsPerMetre;
  const power = 10 ** Math.floor(Math.log10(target));
  const metres = (target / power >= 5 ? 5 : target / power >= 2 ? 2 : 1) * power;
  const end = 16 + metres * pixelsPerMetre;
  return <g aria-label={`축척 ${metres}m`} data-scale-metres={metres} stroke="currentColor" fill="currentColor" transform={`translate(0 ${height - 44})`}>
    <path d={`M16,-4 V0 H${end} V-4`} fill="none" strokeWidth="1.5" />
    <text x="16" y="-8" fontSize="11" stroke="none">{Number(metres.toPrecision(3))} m</text>
  </g>;
}
