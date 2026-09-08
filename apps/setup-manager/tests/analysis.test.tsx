import { afterEach, describe, expect, it, vi } from '../../../web/node_modules/vitest/dist/index.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { compatibility, channelRuns, channelRecorded, deltaRuns, intervalCost, pathFor, sampleRuns, timingRuns, valueAt, type SelectedLapTrace, type ControlSample } from '../src/analysisTrace';
import { knownApexes, observePhases, practiceActions } from '../src/analysisPhases';
import { fetchTrace, traceRequestKey } from '../src/analysisRequests';
import { fetchJsonWithSenderDebug } from '../src/senderDebug';
import { normalizeSessionAnalysisResult } from '../src/sessionAnalysis';
import { ObservedMap, TraceChart } from '../src/AnalysisTraceCharts';

const quality = { available: true, capturedSamples: 3, returnedSamples: 3, alignedSamples: 3, method: 'overallFrame' as const, medianIntervalMs: 50, maxSkewMs: 0, maxSkewFrames: 0 };
const position = (d: number | null, t: number, segment = 0) => ({ distanceM: d, sessionTimeMs: t, segment, alignment: 'exact' as const });
function trace(scale = 1): SelectedLapTrace {
  return { lapNum: 1, attemptId: 'lap1', playerIndex: 0, valid: true, trackId: 0, packetFormat: 2026, gameYear: 26, trackLengthM: 1000,
    extent: { fromM: 0, toM: 1000 }, window: null, finish: { distanceM: 1000, elapsedMs: 10000 * scale, source: 'lastLapTime' },
    timing: [0, 10, 20].map((d, i) => ({ ...position(d, i * 50), elapsedMs: i * 50 * scale })),
    controls: [0, 10, 20].map((d, i) => ({ ...position(d, i * 50), speedKph: 100, throttle: 0, brake: 0, steer: 0, gear: 3, rpm: 10000 })), motion: [], status: [],
    quality: { timing: quality, controls: quality, motion: quality, status: quality, maxInterpolationGapMs: 100 } };
}
const theme = { surface2: '#222', text: '#fff', muted: '#aaa', accent: '#ff0', accent2: '#0ff', border: '#444', bg: '#000' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('observed physical-distance comparison', () => {
  it('uses independent physical positions, preserves actual zero, and separates official finish', () => {
    const a = trace(), b = trace(1.1);
    b.timing = [0, 5, 15, 20].map(d => ({ ...position(d, d * 5), elapsedMs: d * 5.5 }));
    const delta = deltaRuns(timingRuns(a), timingRuns(b));
    expect(valueAt(delta, 10)).toBeCloseTo(.005);
    expect(valueAt(delta, 0)).toBe(0);
    expect(valueAt(delta, 1000)).toBeNull();
    expect(intervalCost(timingRuns(a), timingRuns(b), { fromM: 0, toM: 20 })).toBeCloseTo(.01);
  });
  it('breaks null clocks, long gaps, reversals, and stream-local segment changes', () => {
    const t = trace();
    t.timing[1].elapsedMs = null;
    expect(valueAt(timingRuns(t), 10)).toBeNull();
    expect(intervalCost(timingRuns(t), timingRuns(trace()), { fromM: 0, toM: 20 })).toBeNull();
    t.timing = [{ ...position(0, 0), elapsedMs: 0 }, { ...position(20, 200), elapsedMs: 200 }];
    expect(valueAt(timingRuns(t), 10)).toBeNull();
    t.timing[1] = { ...position(20, 50, 7), elapsedMs: 50 };
    expect(valueAt(timingRuns(t), 10)).toBeNull();
    const other = trace(); other.timing.forEach(row => row.segment = 99);
    expect(valueAt(deltaRuns(timingRuns(trace()), timingRuns(other)), 10)).toBe(0);
  });
  it('rejects ambiguous overlapping segments even if interval endpoints are unique', () => {
    const a = [[{ d: 0, v: 0, t: 0 }, { d: 20, v: 100, t: 100 }], [{ d: 5, v: 30, t: 200 }, { d: 15, v: 80, t: 250 }]];
    expect(intervalCost(a, timingRuns(trace()), { fromM: 0, toM: 20 })).toBeNull();
  });
  it('breaks delta curves at competing timing segments while retaining safe outside observations', () => {
    const point = (d: number, v = d * 5) => ({ d, v, t: null });
    const overlap = [point(5, 30), point(15, 80)];
    const a = [[point(0), point(20)], overlap];
    const b = [[point(0), point(20)]];
    const delta = deltaRuns(a, b);
    expect(valueAt(a, 10)).toBeNull();
    expect(valueAt(delta, 10)).toBeNull();
    expect(valueAt(delta, 0)).toBe(0);
    expect(valueAt(delta, 20)).toBe(0);
    const detailedA = [[point(0), point(4), point(16), point(20)], overlap];
    const detailed = deltaRuns(detailedA, b);
    expect(valueAt(detailed, 2)).toBe(0);
    expect(valueAt(detailed, 18)).toBe(0);
    expect(valueAt(detailed, 5)).toBeNull();
    expect(valueAt(detailed, 10)).toBeNull();
    expect(valueAt(detailed, 15)).toBeNull();
    expect(pathFor(detailed, { fromM: 0, toM: 20 }, -1, 1).match(/ M /g)).toHaveLength(2);
  });
  it('retains 10000 exact legacy singleton segments without quadratic scanning', () => {
    const a = Array.from({ length: 10000 }, (_, i) => [{ d: i, v: i * 5, t: null }]);
    const b = Array.from({ length: 10000 }, (_, i) => [{ d: i, v: i * 6, t: null }]);
    const started = performance.now();
    const delta = deltaRuns(a, b);
    const duration = performance.now() - started;
    expect(delta).toHaveLength(10000);
    expect(delta.every(run => run.length === 1)).toBe(true);
    expect(delta[9999][0].v).toBeCloseTo(9.999);
    // Broad regression guard: the previous repeated global scans took seconds.
    expect(duration).toBeLessThan(1000);
    console.info(`10000 singleton delta segments: ${duration.toFixed(1)} ms`);
  });
  it('blocks unknown or mismatched coordinates and honours 1m tolerance', () => {
    const a = trace(), b = trace();
    b.trackId = null; expect(compatibility(a, b).ok).toBe(false);
    b.trackId = 0; b.trackLengthM = 1001; expect(compatibility(a, b).ok).toBe(true);
    b.trackLengthM = 1001.1; expect(compatibility(a, b).ok).toBe(false);
    b.trackLengthM = 1000; b.gameYear = 25; expect(compatibility(a, b).ok).toBe(false);
    b.gameYear = null; expect(compatibility(a, b).ok).toBe(true);
  });
  it('retains a native 60Hz one-sample pulse and duplicate-distance controls', () => {
    const t = trace();
    t.controls = Array.from({ length: 7 }, (_, i) => ({ ...t.controls[0], ...position(i * 10 / 3, i * 100 / 6), brake: i === 2 ? 1 : 0 }));
    const runs = channelRuns(t, 'brake');
    expect(runs.flat()).toHaveLength(7); expect(runs[0][2].v).toBe(1);
    expect(pathFor(runs, { fromM: 3, toM: 10 }, 0, 1)).toContain('6.00');
    t.controls[2].distanceM = t.controls[1].distanceM;
    expect(channelRuns(t, 'brake').flat()).toHaveLength(7);
  });
  it('never creates fractional gear or forward-fills 2Hz status', () => {
    const t = trace(); t.controls[1].gear = 4;
    expect(valueAt(channelRuns(t, 'gear'), 5, true)).toBe(3);
    t.status = [{ ...position(0, 0), fuelKg: 0, ersJ: 0 }, { ...position(100, 500), fuelKg: 50, ersJ: 1e6 }];
    expect(valueAt(channelRuns(t, 'fuelKg'), 0)).toBe(0);
    expect(valueAt(channelRuns(t, 'fuelKg'), 50)).toBeNull();
  });
  it('does not create synthetic range-edge values or connect native gaps', () => {
    const runs = sampleRuns([{ ...position(5, 0), v: 2 }, { ...position(10, 50), v: 3 }], r => r.v);
    expect(valueAt(runs, 0)).toBeNull();
    expect(pathFor(runs, { fromM: 6, toM: 9 }, 0, 3)).toBe('');
  });
});

describe('partial recordings and presentation', () => {
  it('keeps recorded but unaligned channels distinct from not recorded', () => {
    const t = trace(); t.controls.forEach(row => row.distanceM = null);
    expect(channelRecorded(t, 'speedKph')).toBe(true);
    expect(channelRuns(t, 'speedKph')).toEqual([]);
    expect(channelRecorded(undefined, 'speedKph')).toBe(false);
    expect(channelRecorded(t, 'fuelKg')).toBe(false);
  });
  it('uses top-level lap summaries without inventing dynamics', () => {
    const result = normalizeSessionAnalysisResult({ laps: [{ lapNum: 1, valid: true, lapTimeMs: 90000 }] });
    expect(result.comparison?.laps).toHaveLength(1);
    expect(result.comparison?.laps[0].understeerPct).toBeNull();
    expect(result.comparison?.laps[0].sector1Ms).toBeNull();
    expect(result.comparison?.laps[0].trace.speed).toEqual([]);
  });
  it('keeps duplicate apex numbers and unknown layouts honest', () => {
    const t = trace(); t.trackId = 8;
    expect(knownApexes(t).filter(a => a.number === 1)).toHaveLength(2);
    t.trackId = 42; expect(knownApexes(t)).toEqual([]);
  });
  it('preserves each native map X/Z pair when distances repeat', () => {
    const a = trace();
    a.motion = [{ ...position(10, 0), xM: 1, zM: 1 }, { ...position(10, 16), xM: 2, zM: 2 }];
    const html = renderToStaticMarkup(<ObservedMap a={a} range={{ fromM: 0, toM: 20 }} cursor={0} theme={theme} />);
    expect(html).toContain('d="M 190.00 20.00 L 450.00 280.00"');
    // Looking up Z by distance used to fabricate (1, 2) for the first row.
    expect(html).not.toContain('M 190.00 280.00');
  });
  it('renders accessible native traces and real map coordinates without closing paths', () => {
    const a = trace(); a.motion = [{ ...position(0, 0), xM: 5, zM: 10 }, { ...position(10, 50), xM: 15, zM: 20 }];
    const html = renderToStaticMarkup(<ObservedMap a={a} range={{ fromM: 0, toM: 20 }} cursor={5} theme={theme} />);
    expect(html).toContain('10.00'); expect(html).toContain('15.00'); expect(html).toContain('Observed track positions');
    expect(html).not.toMatch(/d="[^"]*Z/);
    const chart = renderToStaticMarkup(<TraceChart title="Brake" unit="0–1" a={channelRuns(a, 'brake')} range={{ fromM: 0, toM: 20 }} cursor={5} setCursor={() => {}} theme={theme} />);
    const compareMap = renderToStaticMarkup(<ObservedMap b={a} range={{ fromM: 0, toM: 20 }} cursor={5} theme={theme} />);
    expect(compareMap).toContain('Compare cursor: 10.00 X, 15.00 Z');
    expect(compareMap).toContain('Baseline cursor: unavailable');
    expect(chart).toContain('Baseline — solid'); expect(chart).toContain('Compare – dashed'); expect(chart).toContain('role="img"');
  });
});

function phaseTrace(): SelectedLapTrace {
  const t = trace(); t.trackLengthM = 10000;
  t.controls = Array.from({ length: 151 }, (_, i): ControlSample => ({ ...position(i * 10, i * 50), speedKph: 100 + Math.abs(i - 55), brake: i >= 30 && i < 50 ? .6 : 0, throttle: i >= 60 ? 1 : .2, gear: 3, rpm: 9000, steer: 0 }));
  t.timing = t.controls.map(r => ({ ...r, elapsedMs: r.sessionTimeMs }));
  return t;
}
describe('labelled phase heuristics and bounded practice actions', () => {
  it('observes persistent transitions and produces at most three supported experiments', () => {
    const a = phaseTrace(), b = phaseTrace(); b.timing.forEach(r => r.elapsedMs! *= 1.1);
    const observations = observePhases(a, b);
    expect(observations[0].landmarks.join(' ')).toContain('brake onset 300.0');
    expect(observations[0].landmarks.join(' ')).toContain('brake release 500.0');
    expect(observations[0].landmarks.join(' ')).toContain('throttle reapplication 600.0');
    const actions = practiceActions(a, b, observations); expect(actions).toHaveLength(3);
    expect(actions.every(action => action.costS! > 0 && action.experiment)).toBe(true);
    b.valid = false; expect(practiceActions(a, b, observations)).toEqual([]);
  });
  it('ignores one-frame brake spikes, missing landmarks, gaps, and nonpositive costs', () => {
    const a = phaseTrace(), b = phaseTrace();
    a.controls.forEach(row => row.brake = row.distanceM === 300 ? 1 : 0);
    expect(observePhases(a, b)[0].landmarks).toEqual([]);
    const c = phaseTrace(); c.controls[31].sessionTimeMs = null;
    expect(observePhases(c, b)[0].landmarks).toEqual([]);
    expect(practiceActions(b, b, observePhases(b, b))).toEqual([]);
  });
});

describe('trace request ownership keys and error states', () => {
  it('keys include URL, generation, lap and exact range while normalizing URL', () => {
    const key = traceRequestKey('http://localhost:1/', 0, 'dir', 1, null);
    expect(key).toBe(traceRequestKey(' http://localhost:1 ', 0, 'dir', 1, null));
    expect(key).not.toBe(traceRequestKey('http://localhost:2', 0, 'dir', 1, null));
    expect(key).not.toBe(traceRequestKey('http://localhost:1', 1, 'dir', 1, null));
    expect(key).not.toBe(traceRequestKey('http://localhost:1', 0, 'dir', 2, null));
    expect(key).not.toBe(traceRequestKey('http://localhost:1', 0, 'dir', 1, { fromM: 0, toM: 100 }));
  });
  it('distinguishes old plain404 from structured missing-lap404 and preserves 413 extent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('404 page not found', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'not_found', message: 'Completed lap missing' } }), { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'trace_too_large', message: 'Choose window', extent: { fromM: 0, toM: 1000 } } }), { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect((await fetchTrace('http://test', 'dir', 1, null, signal)).error?.code).toBe('unsupported');
    expect((await fetchTrace('http://test', 'dir', 1, null, signal)).error?.code).toBe('not_found');
    expect((await fetchTrace('http://test', 'dir', 1, null, signal)).error?.extent?.toM).toBe(1000);
  });
  it('still rejects malformed JSON200 and forwards AbortSignal without logging expected cancellation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.includes('client-log') ? new Response('{}') : new Response('bad json')));
    await expect(fetchTrace('http://test', 'dir', 1, null, new AbortController().signal)).rejects.toThrow('invalid JSON');
    const controller = new AbortController(); controller.abort();
    const aborted = new DOMException('Aborted', 'AbortError');
    const mock = vi.fn().mockRejectedValue(aborted); vi.stubGlobal('fetch', mock);
    await expect(fetchJsonWithSenderDebug('http://test', '/trace', 'test', { init: { signal: controller.signal } })).rejects.toBe(aborted);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
