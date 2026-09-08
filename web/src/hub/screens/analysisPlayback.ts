import { getTeamColor, getTeamName, TEAM_NAMES } from '../../constants/teamColors';
import type {
  IncidentCarTuple,
  IncidentFrame,
  IncidentReplay,
  RaceAnalysisTrackOutline,
} from '../data/raceAnalysisTypes';

export interface DecodedIncidentCar {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yawRad: number;
  gLat: number;
  gLong: number;
  speedKmh: number;
  throttle: number;
  brake: number;
  steer: number;
  gear: number;
}

export interface ScreenVector {
  x: number;
  y: number;
}

export interface ReplayBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ReplayMap {
  kind: 'outline' | 'local-grid';
  label: string;
  bounds: ReplayBounds;
}

export interface TeamIdentity {
  label: string;
  color: string;
}

export type TelemetryFreshness = 'fresh' | 'unavailable' | 'legacy-unknown';

export function decodeIncidentCar(tuple: IncidentCarTuple | null | undefined): DecodedIncidentCar | null {
  if (!tuple) return null;
  const [x, y, z, vx, vy, vz, yawRad, gLat, gLong, speedKmh, throttle, brake, steer, gear] = tuple;
  return { x, y, z, vx, vy, vz, yawRad, gLat, gLong, speedKmh, throttle, brake, steer, gear };
}

// Old payloads can have non-monotonic timestamps. JavaScript's sort is stable,
// but storing the source index makes that contract explicit across runtimes.
export function sortedReplayFrames(frames: readonly IncidentFrame[]): IncidentFrame[] {
  return frames
    .map((frame, sourceIndex) => ({ frame, sourceIndex }))
    .sort((a, b) => a.frame.tMs - b.frame.tMs || a.sourceIndex - b.sourceIndex)
    .map(({ frame }) => frame);
}

// Returns -1 only when the playhead precedes all measured frames. The UI clamps
// its slider to the measured range, so normal replay always obtains a frame.
export function frameIndexAt(frames: readonly Pick<IncidentFrame, 'tMs'>[], playheadMs: number): number {
  let low = 0;
  let high = frames.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (frames[middle].tMs <= playheadMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// Collision time is an event timestamp, not a nominal frame offset. This stays
// valid for irregular v2 captures and stable-sorted legacy payloads alike.
export function relativeIncidentTimeMs(frameTimeMs: number, sessionTimeMs: number): number {
  return frameTimeMs - sessionTimeMs;
}

// World yaw is zero toward +Z. Rendering maps world (X,Z) to screen (X,-Z).
export function bodyScreenVector(yawRad: number): ScreenVector {
  return { x: zeroSmall(Math.sin(yawRad)), y: zeroSmall(-Math.cos(yawRad)) };
}

export function motionScreenVector(vx: number, vz: number): ScreenVector | null {
  const magnitude = Math.hypot(vx, vz);
  return magnitude > 0 ? { x: zeroSmall(vx / magnitude), y: zeroSmall(-vz / magnitude) } : null;
}

function zeroSmall(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export function participantName(name: string, idx: number): string {
  return name.trim() || `Car #${idx}`;
}

export function teamIdentity(teamId: number | null): TeamIdentity {
  if (teamId === null) return { label: 'Unknown', color: '#6f7070' };
  if (teamId === 255) return { label: 'No team', color: getTeamColor(teamId) };
  if (Object.prototype.hasOwnProperty.call(TEAM_NAMES, teamId)) {
    return { label: getTeamName(teamId), color: getTeamColor(teamId) };
  }
  return { label: `Team #${teamId}`, color: '#6f7070' };
}

export function telemetryFreshness(frame: IncidentFrame, participantIndex: number): TelemetryFreshness {
  if (frame.telemetryUnavailable === null) return 'legacy-unknown';
  return frame.telemetryUnavailable.includes(participantIndex) ? 'unavailable' : 'fresh';
}

function boundsForPoints(points: readonly [number, number][]): ReplayBounds {
  if (points.length === 0) return { minX: -10, maxX: 10, minY: -10, maxY: 10 };
  let minX = points[0][0];
  let maxX = minX;
  let minY = -points[0][1];
  let maxY = minY;
  for (const [x, z] of points.slice(1)) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, -z);
    maxY = Math.max(maxY, -z);
  }
  return paddedBounds({ minX, maxX, minY, maxY });
}

function paddedBounds(bounds: ReplayBounds): ReplayBounds {
  const spanX = Math.max(bounds.maxX - bounds.minX, 10);
  const spanY = Math.max(bounds.maxY - bounds.minY, 10);
  const padding = Math.max(spanX, spanY) * 0.12;
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  };
}

export function localGridLinePositions(width: number, height: number, padding: number, divisions = 8): { vertical: number[]; horizontal: number[] } {
  const positionsFor = (size: number) => Array.from(
    { length: divisions + 1 },
    (_, index) => padding + index * ((size - padding * 2) / divisions),
  );
  return { vertical: positionsFor(width), horizontal: positionsFor(height) };
}

export function makeReplayMap(incident: IncidentReplay, outline: RaceAnalysisTrackOutline | null, focus: 'track' | 'incident' = 'track'): ReplayMap {
  const positions: Array<[number, number]> = [];
  for (const frame of incident.frames) {
    for (const tuple of frame.cars) {
      const car = decodeIncidentCar(tuple);
      if (car) positions.push([car.x, car.z]);
    }
  }
  if (outline?.points.length) {
    return { kind: 'outline', label: 'Recorded track centreline', bounds: boundsForPoints(focus === 'incident' && positions.length ? positions : [...outline.points, ...positions]) };
  }
  return { kind: 'local-grid', label: 'Incident-local metre grid', bounds: boundsForPoints(positions) };
}

export type PlaybackRate = 0.25 | 0.5 | 1 | 2;

export interface PlaybackState {
  timestamps: number[];
  playheadMs: number;
  playing: boolean;
  rate: PlaybackRate;
}

export type PlaybackAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'rate'; rate: PlaybackRate }
  | { type: 'tick'; elapsedMs: number }
  | { type: 'seek'; playheadMs: number }
  | { type: 'previous-frame' }
  | { type: 'next-frame' }
  | { type: 'home' }
  | { type: 'end' };

export function createPlaybackState(timestamps: readonly number[], rate: PlaybackRate = 1): PlaybackState {
  const ordered = [...timestamps].sort((a, b) => a - b);
  return {
    timestamps: ordered,
    playheadMs: ordered[0] ?? 0,
    playing: false,
    rate,
  };
}

function clampPlayhead(timestamps: readonly number[], value: number): number {
  if (timestamps.length === 0) return 0;
  return Math.max(timestamps[0], Math.min(timestamps[timestamps.length - 1], value));
}

function resume(state: PlaybackState): PlaybackState {
  if (state.timestamps.length < 2 || state.timestamps[0] === state.timestamps[state.timestamps.length - 1]) return { ...state, playing: false };
  const atEnd = state.playheadMs >= state.timestamps[state.timestamps.length - 1];
  return { ...state, playheadMs: atEnd ? state.timestamps[0] : state.playheadMs, playing: true };
}

export function reducePlayback(state: PlaybackState, action: PlaybackAction): PlaybackState {
  const timestamps = state.timestamps;
  if (timestamps.length === 0) return action.type === 'rate' ? { ...state, rate: action.rate } : { ...state, playing: false };
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  switch (action.type) {
    case 'play':
      return resume(state);
    case 'pause':
      return { ...state, playing: false };
    case 'toggle':
      return state.playing ? { ...state, playing: false } : resume(state);
    case 'rate':
      return { ...state, rate: action.rate };
    case 'tick': {
      if (!state.playing) return state;
      const next = clampPlayhead(timestamps, state.playheadMs + Math.max(0, action.elapsedMs) * state.rate);
      return { ...state, playheadMs: next, playing: next < last };
    }
    case 'seek':
      return { ...state, playheadMs: clampPlayhead(timestamps, action.playheadMs), playing: false };
    case 'previous-frame': {
      const index = frameIndexAt(timestamps.map((tMs) => ({ tMs })), state.playheadMs);
      const exact = index >= 0 && timestamps[index] === state.playheadMs;
      const previous = Math.max(0, exact ? index - 1 : index);
      return { ...state, playheadMs: timestamps[previous] ?? first, playing: false };
    }
    case 'next-frame': {
      const index = frameIndexAt(timestamps.map((tMs) => ({ tMs })), state.playheadMs);
      const next = Math.min(timestamps.length - 1, Math.max(0, index + 1));
      return { ...state, playheadMs: timestamps[next] ?? last, playing: false };
    }
    case 'home':
      return { ...state, playheadMs: first, playing: false };
    case 'end':
      return { ...state, playheadMs: last, playing: false };
  }
}

export function playbackActionForKey(key: string): PlaybackAction | null {
  switch (key) {
    case ' ':
    case 'Space':
    case 'Spacebar':
      return { type: 'toggle' };
    case 'ArrowLeft':
      return { type: 'previous-frame' };
    case 'ArrowRight':
      return { type: 'next-frame' };
    case 'Home':
      return { type: 'home' };
    case 'End':
      return { type: 'end' };
    default:
      return null;
  }
}

// Keyboard shortcuts are intentionally not document-level. A caller passes
// whether the replay region itself (rather than one of its nested controls) is
// focused, keeping Space/arrows from affecting another UI element.
export function playbackActionForFocusedRegion(key: string, regionFocused: boolean): PlaybackAction | null {
  return regionFocused ? playbackActionForKey(key) : null;
}

export interface ReplayCamera { zoom: number; x: number; y: number }
export const INITIAL_REPLAY_CAMERA: ReplayCamera = { zoom: 1, x: 0, y: 0 };

// Zoom around the cursor (or viewport centre), keeping its world point fixed.
export function zoomReplayCamera(camera: ReplayCamera, factor: number, anchor: ScreenVector): ReplayCamera {
  const zoom = Math.max(0.5, Math.min(16, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return { zoom, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}
