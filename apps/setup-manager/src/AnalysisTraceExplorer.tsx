import { useEffect, useMemo, useRef, useState } from 'react';
import { CHANNELS, channelRuns, channelRecorded, compatibility, deltaRuns, finite, intervalCost, timingRuns, valueAt, type Channel, type TraceRange, type TraceState } from './analysisTrace';
import { fetchTrace, traceRequestKey } from './analysisRequests';
import { knownApexes, observePhases, practiceActions } from './analysisPhases';
import { ObservedMap, TraceChart, type TraceTheme } from './AnalysisTraceCharts';

export function AnalysisTraceExplorer({ theme, url, generation, baselineDir, baselineLap, comparisonDir, comparisonLap }: {
  theme: TraceTheme; url: string; generation: number; baselineDir: string | null; baselineLap: number | null; comparisonDir: string | null; comparisonLap: number | null;
}) {
  const [range, setRange] = useState<TraceRange | null>(null);
  const [from, setFrom] = useState('0'), [to, setTo] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Channel[]>(['speedKph', 'throttle', 'brake']);
  const [states, setStates] = useState<Record<string, TraceState>>({});
  const requests = useRef(new Map<string, { controller: AbortController; state: TraceState }>());
  const selections = useMemo(() => [[baselineDir, baselineLap], [comparisonDir, comparisonLap]] as const, [baselineDir, baselineLap, comparisonDir, comparisonLap]);
  const keys = selections.map(([dir, lap]) => dir && lap ? traceRequestKey(url, generation, dir, lap, range) : null);
  useEffect(() => {
    let active = true;
    const activeKeys = new Set(keys.filter((k): k is string => !!k));
    for (const [key, entry] of requests.current) if (!activeKeys.has(key)) { entry.controller.abort(); requests.current.delete(key); }
    const next: Record<string, TraceState> = {};
    for (let i = 0; i < selections.length; i++) {
      const [dir, lap] = selections[i], key = keys[i];
      if (!dir || !lap || !key) continue;
      const cached = requests.current.get(key);
      if (cached) { next[key] = cached.state; continue; }
      const entry = { controller: new AbortController(), state: { loading: true } as TraceState };
      requests.current.set(key, entry); next[key] = entry.state;
      const owns = () => active && requests.current.get(key) === entry;
      void fetchTrace(url, dir, lap, range, entry.controller.signal).then(state => {
        if (!owns()) return;
        entry.state = state; setStates(current => ({ ...current, [key]: state }));
      }).catch(error => {
        if (!owns()) return;
        entry.state = { error: { code: 'request_failed', message: error instanceof Error ? error.message : 'Failed to load native trace.' } };
        setStates(current => ({ ...current, [key]: entry.state }));
      });
    }
    setStates(next);
    return () => { active = false; for (const entry of requests.current.values()) entry.controller.abort(); requests.current.clear(); };
  }, [url, generation, selections, range]);
  const aState = keys[0] ? states[keys[0]] : undefined, bState = keys[1] ? states[keys[1]] : undefined;
  const a = aState?.data, b = bState?.data;
  const check = compatibility(a, b);
  const extents = [a?.extent, b?.extent, aState?.error?.extent, bState?.error?.extent].filter((value): value is TraceRange => !!value);
  const extent = extents.length ? { fromM: Math.min(...extents.map(e => e.fromM)), toM: Math.max(...extents.map(e => e.toM)) } : undefined;
  const extentFrom = extent?.fromM, extentTo = extent?.toM;
  useEffect(() => {
    if (finite(extentFrom) && finite(extentTo) && !range) { setFrom(String(extentFrom)); setTo(String(extentTo)); setCursor(extentFrom); }
  }, [extentFrom, extentTo, range]);
  const view = range ?? extent;
  const timing = useMemo(() => [a ? timingRuns(a) : [], b ? timingRuns(b) : []], [a, b]);
  const delta = useMemo(() => check.ok ? deltaRuns(timing[0], timing[1]) : [], [timing, check.ok]);
  const channels = useMemo(() => CHANNELS.map(channel => ({ ...channel, a: channelRuns(a, channel.key), b: channelRuns(b, channel.key), recordedA: channelRecorded(a, channel.key), recordedB: channelRecorded(b, channel.key) })), [a, b]);
  const observations = useMemo(() => observePhases(a, b), [a, b]);
  const actions = useMemo(() => practiceActions(a, b, observations), [a, b, observations]);
  const apexes = useMemo(() => knownApexes(a), [a]);
  const inputRange = { fromM: Number(from), toM: Number(to) };
  const validRange = from.trim() !== '' && to.trim() !== '' && finite(inputRange.fromM) && finite(inputRange.toM) && inputRange.fromM >= (extent?.fromM ?? 0) && inputRange.fromM < inputRange.toM && (!extent || inputRange.toM <= extent.toM);
  const manualCost = check.ok && validRange ? intervalCost(timing[0], timing[1], inputRange) : null;
  const jump = (window: TraceRange, focus = window.fromM) => { setFrom(String(window.fromM)); setTo(String(window.toM)); setCursor(focus); setRange({ fromM: window.fromM, toM: window.toM }); };
  const inputStyle = { background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 4, padding: 7, maxWidth: '100%' };
  const buttonStyle = { ...inputStyle, cursor: 'pointer' };
  return <div style={{ display: 'grid', gap: 14, fontSize: 12 }}>
    <p>{check.message}</p>
    {[aState, bState].map((state, side) => <div key={side}>
      <strong>{side ? 'Compare – dashed' : 'Baseline — solid'}</strong>
      {state?.loading && <span role="status"> Loading native samples…</span>}
      {!state && <span> Select a completed lap.</span>}
      {state?.error && <div role="status">{state.error.message} ({state.error.code})</div>}
      {state?.data && <details><summary>Capture quality · lap {state.data.lapNum} · {state.data.valid ? 'valid' : 'invalid'} · player {state.data.playerIndex}</summary>
        <div>Track {state.data.trackId ?? 'unknown'} · length {state.data.trackLengthM ?? 'unknown'} m · format {state.data.packetFormat ?? 'unknown'} · year {state.data.gameYear ?? 'unknown'}</div>
        {(['timing', 'controls', 'motion', 'status'] as const).map(stream => { const q = state.data!.quality[stream]; return <div key={stream}>
          {stream}: {q.available ? `${q.alignedSamples}/${q.returnedSamples} aligned/returned (${q.capturedSamples} captured), ${q.method}` : 'Not recorded'} · median {q.medianIntervalMs ?? 'unknown'} ms · max skew {q.maxSkewMs ?? 'unknown'} ms / {q.maxSkewFrames ?? 'unknown'} frames
        </div>; })}
        <p>Each stream retains its own cadence. Alignment interpolates distance only within timing anchors ≤{state.data.quality.maxInterpolationGapMs} ms apart. Missing data stays missing; fuel and ERS are discrete observations.</p>
      </details>}
    </div>)}
    {[aState, bState].some(state => state?.error?.code === 'trace_too_large') && <div role="status">
      This lap exceeds the native sample or payload limit. Select a smaller distance window; no samples will be averaged or truncated.
      {extent && <button style={buttonStyle} onClick={() => jump({ fromM: extent.fromM, toM: Math.min(extent.toM, extent.fromM + (extent.toM - extent.fromM) / 4) })}>Load first quarter window</button>}
    </div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
      <label>From (m)<br /><input aria-label="Window from metres" type="number" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} /></label>
      <label>To (m)<br /><input aria-label="Window to metres" type="number" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} /></label>
      <button style={buttonStyle} disabled={!validRange} onClick={() => jump(inputRange)}>Load window</button>
      <button style={buttonStyle} disabled={!extent} onClick={() => { setRange(null); if (extent) { setFrom(String(extent.fromM)); setTo(String(extent.toM)); setCursor(extent.fromM); } }}>Reset full lap</button>
      <button style={buttonStyle} disabled={!extent} onClick={() => extent && jump({ fromM: Math.max(extent.fromM, cursor - 100), toM: Math.min(extent.toM, cursor + 100) }, cursor)}>Zoom ±100 m around cursor</button>
    </div>
    <div>Manual interval Δt change: {manualCost === null ? 'unavailable — both clocks must cover the entire interval continuously' : `${manualCost >= 0 ? '+' : ''}${manualCost.toFixed(3)} s`}.</div>
    {view && view.toM > view.fromM && <>
      <label>Shared distance cursor (m)<input aria-label="Shared distance cursor" type="range" min={view.fromM} max={view.toM} step="0.1" value={cursor} onChange={e => setCursor(Number(e.target.value))} style={{ width: '100%' }} /></label>
      <label>Cursor metres <input aria-label="Cursor metres" type="number" min={view.fromM} max={view.toM} step="0.1" value={Number(cursor.toFixed(2))} style={inputStyle} onChange={e => { if (e.target.value !== '' && finite(e.target.valueAsNumber)) setCursor(Math.max(view.fromM, Math.min(view.toM, e.target.valueAsNumber))); }} /></label>
      {apexes.length > 0 && <label>Known apex anchor <select aria-label="Known apex anchor" style={inputStyle} value="" onChange={e => { const apex = apexes[Number(e.target.value)]; if (apex) { setCursor(apex.distance); if (apex.distance < view.fromM || apex.distance > view.toM) jump({ fromM: Math.max(0, apex.distance - 100), toM: Math.min(a!.trackLengthM!, apex.distance + 100) }, apex.distance); } }}><option value="">Choose apex (not phase boundary)</option>{apexes.map((apex, i) => <option key={`${apex.number}-${i}`} value={i}>T{apex.number} · {apex.distance.toFixed(0)} m</option>)}</select></label>}
      {check.ok && <>
        <TraceChart derived title="Distance Δt (Compare − Baseline)" unit="s" a={delta} range={view} cursor={cursor} setCursor={setCursor} theme={theme} />
        <p>Cursor Δt: {valueAt(delta, cursor)?.toFixed(3) ?? 'unavailable'} s. Official finish Δt (lastLapTime, separate from the curve): {((b!.finish.elapsedMs - a!.finish.elapsedMs) / 1000).toFixed(3)} s.</p>
        <ObservedMap a={a} b={b} range={view} cursor={cursor} theme={theme} />
      </>}
      {!check.ok && <>{a && <ObservedMap a={a} range={view} cursor={cursor} theme={theme} />}{b && <ObservedMap b={b} range={view} cursor={cursor} theme={theme} />}</>}
      <fieldset style={{ border: `1px solid ${theme.border}`, display: 'flex', flexWrap: 'wrap', gap: 12 }}><legend>Native channels</legend>
        {channels.map(channel => { const available = channel.recordedA || channel.recordedB; return <label key={channel.key}><input type="checkbox" checked={selected.includes(channel.key)} disabled={!available} onChange={e => setSelected(current => e.target.checked ? [...current, channel.key] : current.filter(key => key !== channel.key))} /> {channel.label}{!available ? ' — Not recorded' : !channel.recordedA ? ' — Baseline unavailable' : !channel.recordedB ? ' — Compare unavailable' : !channel.a.length || !channel.b.length ? ' — Some recorded values lack distance alignment' : ''}</label>; })}
      </fieldset>
      {channels.filter(channel => selected.includes(channel.key)).map(channel => <TraceChart key={channel.key} title={channel.label} unit={channel.unit} a={channel.a} b={channel.b} range={view} cursor={cursor} setCursor={setCursor} theme={theme} step={channel.key === 'gear'} dots={channel.key === 'fuelKg' || channel.key === 'ersJ'} />)}
    </>}
    <details><summary>Observed landmarks and inferred phases</summary>
      <p>[Assumption] Brake onset &gt;10%, release ≤5%, throttle reapplication ≥80% after lower input; transitions must persist for 100 ms. Minimum speed is observed. Known apex neighborhoods provide labels, not official phase boundaries. Missing landmarks remain missing.</p>
      {!observations.length && <p>No compatible known-apex phase observations are available. Use the manual interval inputs.</p>}
      {observations.map((corner, index) => <div key={index}><strong>{corner.label}</strong><p>{corner.landmarks.join(' · ') || 'Landmarks unavailable in this window.'}</p>{corner.phases.map(phase => <p key={phase.label}>{phase.label}: {phase.fromM.toFixed(1)}–{phase.toM.toFixed(1)} m, {phase.costS === null ? 'clock coverage incomplete' : `${phase.costS.toFixed(3)} s Δt change`} — {phase.landmarks}.</p>)}</div>)}
    </details>
    <div><strong>Next practice experiments ({actions.length}/3)</strong>
      <p>Heuristic observations suggest experiments; they do not establish causality or guarantee improvement. Manual phase validation and actual re-drive effectiveness remain unverified. Invalid laps or incomplete timing intervals suppress automatic actions.</p>
      {actions.length === 0 && <p>No supported positive time-loss intervals for automatic practice actions.</p>}
      {actions.map((action, i) => <article key={`${action.corner}-${action.label}-${i}`} style={{ background: theme.surface2, padding: 12, marginTop: 8 }}>
        <strong>{action.corner} · {action.label}</strong>
        <p>Observed interval loss: +{action.costS!.toFixed(3)} s across {action.fromM.toFixed(1)}–{action.toM.toFixed(1)} m. {action.landmarks}.</p>
        <p>Experiment: {action.experiment}</p>
        <p>Remeasure: compare Δt change over this same interval on a valid lap under similar tyre, weather, and session conditions.</p>
        <button style={buttonStyle} onClick={() => jump(action)}>Inspect practice interval</button>
      </article>)}
    </div>
  </div>;
}
