export type TrackWorldPoint = [number, number, number]; // world X, Y (height), Z

export interface TrackBoundarySection {
  distance: number;
  left: TrackWorldPoint | null;
  right: TrackWorldPoint | null;
}

export interface ReplayTrackBoundaries {
  schemaVersion: 1;
  projection: 'single-surface-xz';
  trackId: number;
  gameFormat: string;
  provenance: { description: string; gameVersion: string; verifiedAt: string };
  maxErrorM: number | null;
  segments: Array<{ id: string; sections: TrackBoundarySection[] }>;
  features: Array<{ kind: 'kerb' | 'runoff' | 'wall'; points: TrackWorldPoint[] }>;
}

const assets = import.meta.glob('./replayTrackBoundaries/*.json', { import: 'default' });
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const point = (value: unknown): value is TrackWorldPoint => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function crosses(a: TrackWorldPoint, b: TrackWorldPoint, c: TrackWorldPoint, d: TrackWorldPoint): boolean {
  const side = (p: TrackWorldPoint, q: TrackWorldPoint, r: TrackWorldPoint) => (q[0] - p[0]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

// Convex patches may touch, but their interiors must not overlap in this 2D
// viewer. Height alone cannot resolve which road a recorded car occupies.
function overlaps(a: TrackWorldPoint[], b: TrackWorldPoint[]): boolean {
  return [a, b].every((polygon) => polygon.every((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(q[0] - p[0], q[2] - p[2]);
    const project = (r: TrackWorldPoint) => (r[0] * (q[2] - p[2]) - r[2] * (q[0] - p[0])) / length;
    const ap = a.map(project); const bp = b.map(project);
    return Math.min(Math.max(...ap), Math.max(...bp)) - Math.max(Math.min(...ap), Math.min(...bp)) > 1e-8;
  }));
}

function convex(polygon: TrackWorldPoint[]): boolean {
  const turns = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length]; const r = polygon[(i + 2) % polygon.length];
    return (q[0] - p[0]) * (r[2] - q[2]) - (q[2] - p[2]) * (r[0] - q[0]);
  });
  return turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0);
}

// Runtime validation is at the static-asset boundary. Source/coordinate audits
// remain an asset-authoring requirement; a version label cannot prove accuracy.
export function parseTrackBoundaries(value: unknown, trackId: number | undefined, gameFormat: string | undefined): ReplayTrackBoundaries | null {
  if (!object(value) || value.schemaVersion !== 1 || value.projection !== 'single-surface-xz' || value.trackId !== trackId || value.gameFormat !== gameFormat
    || !Number.isInteger(value.trackId) || !nonempty(value.gameFormat) || !object(value.provenance)
    || !['description', 'gameVersion', 'verifiedAt'].every((key) => nonempty(value.provenance && (value.provenance as Record<string, unknown>)[key]))
    || !(value.maxErrorM === null || typeof value.maxErrorM === 'number' && Number.isFinite(value.maxErrorM) && value.maxErrorM >= 0)
    || !Array.isArray(value.segments) || value.segments.length === 0 || !Array.isArray(value.features)) return null;
  const ids = new Set<string>();
  const patches: TrackWorldPoint[][] = [];
  let hasEdge = false;
  for (const segment of value.segments) {
    if (!object(segment) || !nonempty(segment.id) || ids.has(segment.id) || !Array.isArray(segment.sections) || segment.sections.length < 2) return null;
    ids.add(segment.id);
    let previous = -Infinity;
    for (const section of segment.sections) {
      if (!object(section) || typeof section.distance !== 'number' || !Number.isFinite(section.distance) || section.distance < 0 || section.distance <= previous
        || !(section.left === null || point(section.left)) || !(section.right === null || point(section.right))) return null;
      previous = section.distance;
    }
    const sections = segment.sections as TrackBoundarySection[];
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1];
      const b = sections[i];
      hasEdge ||= Boolean(a.left && b.left || a.right && b.right);
      if (a.left && a.right && b.left && b.right && (crosses(a.left, b.left, a.right, b.right) || crosses(a.left, a.right, b.left, b.right))) return null;
      if (a.left && a.right && b.left && b.right) {
        const patch = [a.left, b.left, b.right, a.right];
        if (!convex(patch) || patches.some((other) => overlaps(patch, other))) return null;
        patches.push(patch);
      }
    }
  }
  for (const feature of value.features) {
    if (!object(feature) || !['kerb', 'runoff', 'wall'].includes(String(feature.kind)) || !Array.isArray(feature.points)
      || feature.points.length < (feature.kind === 'wall' ? 2 : 3) || !feature.points.every(point)) return null;
  }
  return hasEdge ? value as unknown as ReplayTrackBoundaries : null;
}

export async function loadTrackBoundaries(trackId: number | undefined, gameFormat: string | undefined): Promise<ReplayTrackBoundaries | null> {
  const year = gameFormat === 'F1 26' ? 2026 : gameFormat === 'F1 25' ? 2025 : null;
  const load = year === null ? undefined : assets[`./replayTrackBoundaries/${trackId}-${year}.json`];
  return load ? parseTrackBoundaries(await load(), trackId, gameFormat) : null;
}

export function boundaryMapPoints(boundaries: ReplayTrackBoundaries): Array<[number, number]> {
  return boundaries.segments.flatMap(({ sections }) => sections.flatMap(({ left, right }) => [left, right].filter((p): p is TrackWorldPoint => p !== null)))
    .concat(boundaries.features.flatMap(({ points }) => points)).map(([x, , z]) => [x, z]);
}

// Fit measured road edges near the incident, rather than shrinking the camera
// to stationary car centres. Keep the rest of the circuit out of this view.
export function incidentBoundaryPoints(boundaries: ReplayTrackBoundaries, positions: TrackWorldPoint[]): Array<[number, number]> {
  const sections = boundaries.segments.flatMap((segment) => segment.sections.map((section, index) => ({ segment, section, index })));
  const selected = new Set<TrackBoundarySection>();
  for (const position of positions) {
    let nearest: typeof sections[number] | undefined;
    let minimum = Infinity;
    for (const candidate of sections) {
      const { left, right } = candidate.section;
      const centre = left && right ? left.map((v, i) => (v + right[i]) / 2) : left ?? right;
      if (!centre) continue;
      const distance = Math.hypot(...position.map((v, i) => v - centre[i]));
      if (distance < minimum) { minimum = distance; nearest = candidate; }
    }
    if (nearest) {
      for (const section of nearest.segment.sections.slice(Math.max(0, nearest.index - 1), nearest.index + 2)) selected.add(section);
    }
  }
  return [...selected].flatMap(({ left, right }) => [left, right].filter((p): p is TrackWorldPoint => p !== null).map(([x, , z]): [number, number] => [x, z]));
}
