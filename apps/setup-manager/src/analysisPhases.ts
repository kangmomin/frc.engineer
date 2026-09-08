import { cornersFor } from '../../../web/src/constants/trackCorners';
import { compatibility, finite, intervalCost, timingRuns, type ControlSample, type SelectedLapTrace, type TraceRange } from './analysisTrace';

export interface PhaseObservation extends TraceRange { label: string; landmarks: string; costS: number | null; experiment: string }
export interface CornerObservation { label: string; landmarks: string[]; phases: PhaseObservation[] }
export function knownApexes(trace?: SelectedLapTrace) {
  return trace ? cornersFor(trace.trackId ?? undefined, trace.trackLengthM ?? undefined) ?? [] : [];
}
// [Assumption] Initial observable transition thresholds: brake >.1 / release <=.05,
// throttle >=.8 after lower input; each persists >=100 ms of actual timestamps.
// These are heuristic phase boundaries, not official corners or proven causes.
function transition(rows: ControlSample[], test: (r: ControlSample) => boolean, start = 1): number | null {
  for (let i = Math.max(1, start); i < rows.length; i++) {
    if (!test(rows[i]) || test(rows[i - 1])) continue;
    for (let j = i; j < rows.length && test(rows[j]); j++) {
      if (rows[j].sessionTimeMs! - rows[i].sessionTimeMs! >= 100 - 0.001) return i;
    }
  }
  return null;
}
export function observePhases(base?: SelectedLapTrace, compare?: SelectedLapTrace): CornerObservation[] {
  if (!base || !compare || !compatibility(base, compare).ok) return [];
  const apexes = knownApexes(base), a = timingRuns(base), b = timingRuns(compare);
  const groups: ControlSample[][] = []; let group: ControlSample[] | undefined; let prev: ControlSample | undefined;
  for (const row of base.controls) {
    if (![row.distanceM, row.sessionTimeMs, row.speedKph, row.brake, row.throttle].every(finite) || row.segment === null || row.alignment === 'unavailable') { group = undefined; prev = undefined; continue; }
    if (!prev || prev.segment !== row.segment || row.sessionTimeMs! <= prev.sessionTimeMs! || row.sessionTimeMs! - prev.sessionTimeMs! > 100.001 || row.distanceM! < prev.distanceM!) {
      group = []; groups.push(group);
    }
    group!.push(row); prev = row;
  }
  return apexes.map((apex, index) => {
    const from = index ? (apexes[index - 1].distance + apex.distance) / 2 : 0;
    const to = index + 1 < apexes.length ? (apex.distance + apexes[index + 1].distance) / 2 : base.trackLengthM!;
    const result: CornerObservation = { label: `T${apex.number} apex ${apex.distance.toFixed(0)} m`, landmarks: [], phases: [] };
    for (const source of groups) {
      const rows = source.filter(r => r.distanceM! >= from && r.distanceM! <= to);
      const onset = transition(rows, r => r.brake! > .1);
      if (onset === null) continue;
      const release = transition(rows, r => r.brake! <= .05, onset + 1);
      const throttle = transition(rows, r => r.throttle! >= .8, onset + 1);
      const end = throttle ?? rows.length - 1;
      let minimum = onset;
      for (let i = onset; i <= end; i++) if (rows[i].speedKph! < rows[minimum].speedKph!) minimum = i;
      const distance = (i: number) => rows[i].distanceM!;
      result.landmarks.push(`Observed brake onset ${distance(onset).toFixed(1)} m`, release === null ? 'Brake release missing' : `Observed brake release ${distance(release).toFixed(1)} m`, `Observed minimum speed ${rows[minimum].speedKph!.toFixed(1)} km/h at ${distance(minimum).toFixed(1)} m`, throttle === null ? 'Throttle reapplication missing' : `Observed throttle reapplication ${distance(throttle).toFixed(1)} m`);
      const add = (label: string, begin: number | null, finish: number | null, experiment: string) => {
        if (begin === null || finish === null || distance(begin) >= distance(finish)) return;
        const range = { fromM: distance(begin), toM: distance(finish) };
        result.phases.push({ ...range, label, landmarks: 'Inferred interval from observed baseline landmarks', costS: intervalCost(a, b, range), experiment });
      };
      add('Braking', onset, release, 'Repeat the baseline brake onset and release locations, changing only that input.');
      add('Release to minimum speed', release, minimum, 'Repeat the observed release-to-minimum-speed interval with a consistent release.');
      add('Minimum speed to throttle', minimum, throttle, 'Repeat the baseline throttle reapplication location with a consistent input ramp.');
      const nextBrake = throttle === null ? null : transition(rows, r => r.brake! > .1, throttle + 1);
      add('Following acceleration (association only)', throttle, nextBrake ?? rows.length - 1, 'Repeat the throttle application through this following interval while keeping the setup fixed.');
      break;
    }
    return result;
  });
}
export function practiceActions(base: SelectedLapTrace | undefined, compare: SelectedLapTrace | undefined, observations: CornerObservation[]) {
  if (!base?.valid || !compare?.valid || !compatibility(base, compare).ok) return [];
  return observations.flatMap(corner => corner.phases.map(phase => ({ ...phase, corner: corner.label })))
    .filter(phase => phase.costS !== null && phase.costS > 0)
    .sort((a, b) => b.costS! - a.costS!).slice(0, 3);
}
