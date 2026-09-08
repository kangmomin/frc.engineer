export interface TraceRange { fromM: number; toM: number }
export interface SamplePosition {
  distanceM: number | null; sessionTimeMs: number | null; segment: number | null;
  alignment: 'exact' | 'interpolated' | 'unavailable';
}
export interface TimingSample extends SamplePosition { elapsedMs: number | null }
export interface ControlSample extends SamplePosition {
  speedKph: number | null; throttle: number | null; brake: number | null;
  steer: number | null; gear: number | null; rpm: number | null;
}
export interface MotionSample extends SamplePosition { xM: number | null; zM: number | null }
export interface StatusSample extends SamplePosition { fuelKg: number | null; ersJ: number | null }
export interface StreamQuality {
  available: boolean; capturedSamples: number; returnedSamples: number; alignedSamples: number;
  method: 'overallFrame' | 'captureTime' | 'frame' | 'mixed' | 'none';
  medianIntervalMs: number | null; maxSkewMs: number | null; maxSkewFrames: number | null;
}
export interface SelectedLapTrace {
  lapNum: number; attemptId: string; playerIndex: number; valid: boolean;
  trackId: number | null; packetFormat: number | null; gameYear: number | null; trackLengthM: number | null;
  extent: TraceRange | null; window: TraceRange | null;
  finish: { distanceM: number | null; elapsedMs: number; source: 'lastLapTime' };
  timing: TimingSample[]; controls: ControlSample[]; motion: MotionSample[]; status: StatusSample[];
  quality: { timing: StreamQuality; controls: StreamQuality; motion: StreamQuality; status: StreamQuality; maxInterpolationGapMs: number };
}
export interface TraceError { code: string; message: string; extent?: TraceRange }
export type TraceState = { data?: SelectedLapTrace; error?: TraceError; loading?: boolean };
export type Channel = 'speedKph' | 'throttle' | 'brake' | 'steer' | 'gear' | 'rpm' | 'fuelKg' | 'ersJ';
export const CHANNELS: { key: Channel; label: string; unit: string; discrete?: boolean }[] = [
  { key: 'speedKph', label: 'Speed', unit: 'km/h' }, { key: 'throttle', label: 'Throttle', unit: '0–1' },
  { key: 'brake', label: 'Brake', unit: '0–1' }, { key: 'steer', label: 'Steering input', unit: '−1–1' },
  { key: 'gear', label: 'Gear (−1 reverse, 0 neutral)', unit: '', discrete: true }, { key: 'rpm', label: 'RPM', unit: 'rev/min' },
  { key: 'fuelKg', label: 'Fuel', unit: 'kg', discrete: true }, { key: 'ersJ', label: 'ERS stored energy', unit: 'J', discrete: true },
];
export interface Point { d: number; v: number; t: number | null }
export type Runs = Point[][];
export const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function compatibility(a?: SelectedLapTrace, b?: SelectedLapTrace): { ok: boolean; message: string } {
  if (!a || !b) return { ok: false, message: 'Select two available traces to compare.' };
  const knownMismatch = (x: number | null, y: number | null) => x !== null && y !== null && x !== y;
  // [Assumption] Recorded track lengths within 1 m share the same distance coordinate.
  if (knownMismatch(a.trackId, b.trackId) || knownMismatch(a.packetFormat, b.packetFormat) || knownMismatch(a.gameYear, b.gameYear) ||
      (finite(a.trackLengthM) && finite(b.trackLengthM) && Math.abs(a.trackLengthM - b.trackLengthM) > 1)) {
    return { ok: false, message: 'Incompatible track, format, year, or length. Δt, map overlay, and coaching are disabled; individual channels remain available.' };
  }
  if (![a, b].every(t => finite(t.trackId) && t.trackId >= 0 && finite(t.packetFormat) && t.packetFormat > 0 && finite(t.trackLengthM) && t.trackLengthM > 0)) {
    return { ok: false, message: 'Unverified coordinate context: track, length, or packet format is unknown. Δt, map overlay, and coaching are disabled.' };
  }
  return { ok: true, message: 'Matching track, length, and packet format. Positive Δt means Compare is slower.' };
}

// Segment identities are local to this one stream. Keep whole source rows together
// so paired coordinates and duplicate-distance native observations stay intact.
export function sampleSegments<T extends SamplePosition>(rows: T[], valid: (row: T) => boolean, gapMs = 100, strictDistance = false): T[][] {
  const runs: T[][] = []; let run: T[] | undefined; let previous: T | undefined;
  for (const row of rows) {
    if (!finite(row.distanceM) || !valid(row) || row.alignment === 'unavailable') { run = undefined; previous = undefined; continue; }
    const connected = previous && previous.segment !== null && previous.segment === row.segment &&
      finite(previous.sessionTimeMs) && finite(row.sessionTimeMs) && row.sessionTimeMs > previous.sessionTimeMs &&
      row.sessionTimeMs - previous.sessionTimeMs <= gapMs + 0.001 &&
      (strictDistance ? row.distanceM > previous.distanceM! : row.distanceM >= previous.distanceM!);
    if (!run || !connected) { run = []; runs.push(run); }
    run.push(row); previous = row;
  }
  return runs;
}
export function sampleRuns<T extends SamplePosition>(rows: T[], value: (row: T) => number | null, gapMs = 100, strictDistance = false): Runs {
  return sampleSegments(rows, row => finite(value(row)), gapMs, strictDistance)
    .map(run => run.map(row => ({ d: row.distanceM!, v: value(row)!, t: row.sessionTimeMs })));
}
export function channelRuns(trace: SelectedLapTrace | undefined, key: Channel): Runs {
  if (!trace) return [];
  if (key === 'fuelKg' || key === 'ersJ') return sampleRuns(trace.status, row => row[key], 0);
  return sampleRuns(trace.controls, row => row[key]);
}
export function channelRecorded(trace: SelectedLapTrace | undefined, key: Channel): boolean {
  if (!trace) return false;
  return key === 'fuelKg' || key === 'ersJ' ? trace.status.some(row => finite(row[key])) : trace.controls.some(row => finite(row[key]));
}
export function timingRuns(trace: SelectedLapTrace): Runs {
  return sampleRuns(trace.timing, row => row.elapsedMs, trace.quality.maxInterpolationGapMs, true);
}
function runValue(run: Point[], distance: number, step = false): number | null {
  if (!run.length || distance < run[0].d || distance > run[run.length - 1].d) return null;
  let lo = 0, hi = run.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (run[mid].d <= distance) lo = mid; else hi = mid - 1; }
  const left = run[lo];
  if (left.d === distance) return left.v;
  const right = run[lo + 1];
  if (!right || right.d <= left.d) return null;
  return step ? left.v : left.v + (right.v - left.v) * (distance - left.d) / (right.d - left.d);
}
export function valueAt(runs: Runs, distance: number, step = false): number | null {
  let result: number | null = null;
  for (const run of runs) {
    const value = runValue(run, distance, step);
    if (value !== null) { if (result !== null) return null; result = value; }
  }
  return result;
}
// Sorted start/end events maintain unique coverage without rescanning every run
// at every distance. Exact legacy samples can legitimately produce many singleton
// segments; they are retained with O(n log n) sorting and O(n) event processing.
function coverageSweep(runs: Runs): (distance: number) => Point[] | null {
  const spans = runs.filter(run => run.length).map(run => ({ run, from: run[0].d, to: run[run.length - 1].d }));
  const starts = [...spans].sort((a, b) => a.from - b.from);
  const ends = [...spans].sort((a, b) => a.to - b.to);
  const active = new Set<(typeof spans)[number]>();
  let start = 0, end = 0;
  return distance => {
    while (start < starts.length && starts[start].from <= distance) active.add(starts[start++]);
    while (end < ends.length && ends[end].to < distance) active.delete(ends[end++]);
    return active.size === 1 ? active.values().next().value!.run : null;
  };
}
export function deltaRuns(a: Runs, b: Runs): Runs {
  // Include every competing segment boundary. Unique endpoints of an outer run
  // alone cannot establish that its interior is free from overlapping segments.
  const distances = [...new Set([...a, ...b].flatMap(run => run.map(point => point.d)))].sort((x, y) => x - y);
  const atA = coverageSweep(a), atB = coverageSweep(b);
  const result: Runs = [];
  let run: Point[] | undefined, previousA: Point[] | null = null, previousB: Point[] | null = null;
  for (const d of distances) {
    const activeA = atA(d), activeB = atB(d);
    if (!activeA || !activeB) { run = undefined; previousA = null; previousB = null; continue; }
    if (!run || activeA !== previousA || activeB !== previousB) { run = []; result.push(run); }
    run.push({ d, v: (runValue(activeB, d)! - runValue(activeA, d)!) / 1000, t: null });
    previousA = activeA; previousB = activeB;
  }
  return result;
}
export function intervalCost(a: Runs, b: Runs, range: TraceRange): number | null {
  if (range.fromM >= range.toM) return null;
  if (![a, b].every(runs => runs.filter(run => run[0].d <= range.toM && run[run.length - 1].d >= range.fromM).length === 1 && runs.some(run => run[0].d <= range.fromM && run[run.length - 1].d >= range.toM))) return null;
  const values = [valueAt(a, range.fromM), valueAt(a, range.toM), valueAt(b, range.fromM), valueAt(b, range.toM)];
  return values.some(v => v === null) ? null : ((values[3]! - values[2]!) - (values[1]! - values[0]!)) / 1000;
}
export function pathFor(runs: Runs, range: TraceRange, min: number, max: number, width = 640, height = 140, step = false): string {
  const x = (d: number) => ((d - range.fromM) / (range.toM - range.fromM) * width).toFixed(2);
  const y = (v: number) => (height - 6 - (v - min) / (max - min || 1) * (height - 12)).toFixed(2);
  return runs.map(run => run.filter(p => p.d >= range.fromM && p.d <= range.toM).map((p, i) => `${i ? (step ? ' H ' + x(p.d) + ' V ' : ' L ' + x(p.d) + ' ') : ' M ' + x(p.d) + ' '}${y(p.v)}`).join('')).join('');
}
