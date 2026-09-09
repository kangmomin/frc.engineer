import { cornersFor } from '../../constants/trackCorners';
import type { ReplayTrackReference } from '../../constants/replayTracks';
import type { RaceAnalysisTrackOutline } from '../data/raceAnalysisTypes';

export interface ReplayLandmark { label: string; x: number; z: number }
export interface ResolvedReplayTrack {
  outline: RaceAnalysisTrackOutline | null;
  source: 'recorded' | 'reference' | 'unavailable';
  landmarks: ReplayLandmark[];
}

export function outlineFor(points: Array<[number, number]>): RaceAnalysisTrackOutline | null {
  if (points.length < 2 || points.some((point) => point.length !== 2 || !point.every(Number.isFinite))) return null;
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  return bounds.minX === bounds.maxX && bounds.minZ === bounds.maxZ ? null : { points, bounds };
}

export function pointAtDistance(reference: ReplayTrackReference, distance: number): [number, number] {
  const { points, trackLength } = reference;
  const target = ((distance % trackLength) + trackLength) % trackLength;
  const next = points.findIndex(([d]) => d >= target);
  const right = next < 0 ? [points[0][0] + trackLength, points[0][1], points[0][2]] : points[next];
  const left = next <= 0 ? [points[points.length - 1][0] - (next === 0 ? trackLength : 0), ...points[points.length - 1].slice(1)] : points[next - 1];
  const fraction = right[0] === left[0] ? 0 : (target - left[0]) / (right[0] - left[0]);
  return [left[1] + (right[1] - left[1]) * fraction, left[2] + (right[2] - left[2]) * fraction];
}

export function resolveReplayTrack(recorded: RaceAnalysisTrackOutline | null, reference: ReplayTrackReference | null, trackId?: number, gameFormat?: string): ResolvedReplayTrack {
  const captured = recorded ? outlineFor(recorded.points) : null;
  const valid = reference && reference.trackId === trackId && reference.gameFormat === gameFormat
    && Number.isFinite(reference.trackLength) && reference.trackLength > 0 && reference.points.length >= 3
    && reference.points.every((point, index) => point.length === 3 && point.every(Number.isFinite)
      && point[0] >= 0 && point[0] <= reference.trackLength && (index === 0 || point[0] > reference.points[index - 1][0]));
  const geometry = valid ? outlineFor(reference.points.map(([, x, z]) => [x, z])) : null;
  const outline = captured ?? geometry;
  // A captured outline has no lap-distance anchor. Only attach reference labels
  // when both complete paths agree. 15 m accommodates the capture's 256-point
  // spacing and racing-line variation, without accepting a translated circuit.
  const closeTo = (points: Array<[number, number]>, other: Array<[number, number]>) => points.every(([x, z]) => other.some(([rx, rz]) => Math.hypot(x - rx, z - rz) <= 15));
  const aligned = geometry && (!captured || closeTo(captured.points, geometry.points) && closeTo(geometry.points, captured.points));
  const landmarks = valid && aligned ? [
    { label: 'S/F', distance: 0 },
    ...(cornersFor(trackId, reference.trackLength) ?? []).map((corner) => ({ label: `T${corner.number}`, distance: corner.distance })),
  ].map(({ label, distance }) => { const [x, z] = pointAtDistance(reference, distance); return { label, x, z }; }) : [];
  return { outline, source: captured ? 'recorded' : geometry ? 'reference' : 'unavailable', landmarks };
}
