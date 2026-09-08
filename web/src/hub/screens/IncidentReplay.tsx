import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { HubTheme } from '../theme';
import type { IncidentCarTuple, IncidentFrame, IncidentReplay as IncidentReplayValue, RaceAnalysisTrackOutline } from '../data/raceAnalysisTypes';
import {
  bodyScreenVector,
  createPlaybackState,
  decodeIncidentCar,
  frameIndexAt,
  localGridLinePositions,
  makeReplayMap,
  motionScreenVector,
  participantName,
  playbackActionForFocusedRegion,
  reducePlayback,
  relativeIncidentTimeMs,
  sortedReplayFrames,
  teamIdentity,
  telemetryFreshness,
  INITIAL_REPLAY_CAMERA,
  zoomReplayCamera,
  type PlaybackAction,
  type PlaybackRate,
  type ReplayMap,
} from './analysisPlayback';
import styles from './Analysis.module.css';

interface Props {
  t: HubTheme;
  replay: IncidentReplayValue;
  trackOutline: RaceAnalysisTrackOutline | null;
}

const WIDTH = 1_000;
const HEIGHT = 560;
const PADDING = 42;
const RATES: PlaybackRate[] = [0.25, 0.5, 1, 2];

export function IncidentReplay({ t, replay, trackOutline }: Props) {
  const frames = useMemo(() => sortedReplayFrames(replay.frames), [replay.frames]);
  const orderedReplay = useMemo(() => ({ ...replay, frames }), [frames, replay]);
  const timestamps = useMemo(() => frames.map((frame) => frame.tMs), [frames]);
  const [playback, setPlayback] = useState(() => createPlaybackState(timestamps));
  const [focus, setFocus] = useState<'track' | 'incident'>('incident');
  const [camera, setCamera] = useState(INITIAL_REPLAY_CAMERA);
  const [viewport, setViewport] = useState({ width: WIDTH, height: HEIGHT });
  const [dragging, setDragging] = useState(false);
  const mapElement = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const map = useMemo(() => makeReplayMap({ ...replay, frames }, trackOutline, focus), [frames, replay, trackOutline, focus]);
  const project = useMemo(() => {
    const base = projectionFor(map, viewport.width, viewport.height);
    return (x: number, z: number) => {
      const point = base(x, z);
      return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
    };
  }, [map, camera, viewport]);

  useEffect(() => {
    setPlayback(createPlaybackState(timestamps));
    setCamera(INITIAL_REPLAY_CAMERA);
    setFocus('incident');
  }, [replay.raceId, replay.index, timestamps]);

  useEffect(() => {
    if (!playback.playing) return undefined;
    let rafId = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      // React may evaluate the updater after `previous` changes. Capture the
      // elapsed value now or deferred ticks observe zero and playback stalls.
      const elapsedMs = previous === null ? 0 : now - previous;
      previous = now;
      setPlayback((state) => reducePlayback(state, { type: 'tick', elapsedMs }));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playback.playing]);

  useEffect(() => {
    const element = mapElement.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const point = mapPoint(element, event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      setCamera((current) => zoomReplayCamera(current, event.deltaY < 0 ? 1.2 : 1 / 1.2, point));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [frames.length]);

  useEffect(() => {
    const element = mapElement.current;
    if (!element) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width <= 0 || width === previousWidth) return;
      previousWidth = width;
      setViewport({ width, height: Math.max(280, Math.min(480, Math.round(width * 0.5))) });
      setCamera(INITIAL_REPLAY_CAMERA);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frames.length]);

  const fit = (next: 'track' | 'incident') => { setFocus(next); setCamera(INITIAL_REPLAY_CAMERA); };
  const zoom = (factor: number) => setCamera((current) => zoomReplayCamera(current, factor, { x: viewport.width / 2, y: viewport.height / 2 }));
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const dispatch = (action: PlaybackAction) => setPlayback((state) => reducePlayback(state, action));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Do not hijack keys while a nested button or slider is focused: playback
    // shortcuts belong solely to the explicitly focusable replay region.
    const action = playbackActionForFocusedRegion(event.key, event.currentTarget === event.target);
    if (!action) return;
    event.preventDefault();
    dispatch(action);
  };

  const selectedFrameIndex = frameIndexAt(frames, playback.playheadMs);
  const selectedFrame = selectedFrameIndex >= 0 ? frames[selectedFrameIndex] : null;
  const minimum = timestamps[0] ?? 0;
  const maximum = timestamps[timestamps.length - 1] ?? 0;
  const playable = maximum > minimum;
  const collisionPercent = maximum > minimum ? (replay.sessionTimeMs - minimum) / (maximum - minimum) * 100 : -1;

  return (
    <section className={styles.replay} tabIndex={0} onKeyDown={onKeyDown} aria-label="Incident replay. Focus here to use Space, arrow keys, Home and End.">
      <div className={styles.replayHeader}>
        <div><h3>Incident replay</h3><p className={styles.meta}>사고 시점 0.000s · 휠로 확대 · 드래그로 이동</p></div>
        <span className={styles.badge}>{replay.completeness.status}</span>
      </div>

      {frames.length === 0 ? (
        <p className={styles.empty}>This incident has no usable stored frames.</p>
      ) : (
        <>
          <div className={styles.mapToolbar}>
            <span className={styles.meta}>{focus === 'incident' ? '사고 구간' : '전체 트랙'}</span>
            <div className={styles.controls} aria-label="Map controls"><button type="button" aria-label="축소" onClick={() => zoom(1 / 1.5)} disabled={camera.zoom <= 0.5}>−</button><output aria-label="확대 배율">{camera.zoom.toFixed(3)}×</output><button type="button" aria-label="확대" onClick={() => zoom(1.5)} disabled={camera.zoom >= 16}>+</button><button type="button" onClick={() => fit('incident')}>사고 구간 맞춤</button>{trackOutline?.points.length ? <button type="button" onClick={() => fit('track')}>전체 트랙</button> : null}</div>
          </div>
          <div className={styles.svgWrap} ref={mapElement} data-dragging={dragging} onPointerDown={(event) => {
            if (event.button !== 0 || drag.current) return;
            const point = mapPoint(event.currentTarget, event.clientX, event.clientY);
            if (!point) return;
            drag.current = { pointerId: event.pointerId, ...point };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={(event) => {
            const previous = drag.current;
            if (!previous || previous.pointerId !== event.pointerId) return;
            const point = mapPoint(event.currentTarget, event.clientX, event.clientY);
            if (!point) return;
            setCamera((current) => ({ ...current, x: current.x + point.x - previous.x, y: current.y + point.y - previous.y }));
            drag.current = { pointerId: event.pointerId, ...point };
          }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
            <ReplaySvg t={t} replay={orderedReplay} outline={trackOutline} map={map} project={project} frame={selectedFrame} viewport={viewport} />
          </div>
          <div className={styles.replayGrid}>
            <div>
              <div className={styles.controls} aria-label="Replay controls">
                <button type="button" className={styles.playButton} aria-pressed={playback.playing} disabled={!playable} onClick={() => dispatch({ type: 'toggle' })}>{playback.playing ? 'Pause' : playback.playheadMs >= maximum && playable ? 'Replay' : 'Play'}</button>
                <button type="button" disabled={playback.playheadMs <= minimum} onClick={() => dispatch({ type: 'previous-frame' })} aria-label="Previous measured frame">← 이전 프레임</button>
                <button type="button" disabled={playback.playheadMs >= maximum} onClick={() => dispatch({ type: 'next-frame' })} aria-label="Next measured frame">다음 프레임 →</button>
                <button type="button" onClick={() => dispatch({ type: 'home' })}>처음</button>
                <button type="button" onClick={() => dispatch({ type: 'seek', playheadMs: replay.sessionTimeMs })}>사고 시점</button>
                <button type="button" onClick={() => dispatch({ type: 'end' })}>끝</button>
                {RATES.map((rate) => <button key={rate} type="button" aria-pressed={playback.rate === rate} onClick={() => dispatch({ type: 'rate', rate })}>{rate}×</button>)}
              </div>
              <label className={styles.timeline}>
                <span className={styles.timelineHeading}><span>Timeline</span><output>{relativeToCollision(playback.playheadMs, replay.sessionTimeMs)}</output></span>
                <span className={styles.timelineTrack}>
                  {collisionPercent >= 0 && collisionPercent <= 100 && <span className={styles.collisionMarker} style={{ left: `${collisionPercent}%` }} aria-hidden="true" />}
                <input
                  className={styles.slider} type="range" min={minimum} max={maximum} step="any" value={playback.playheadMs} disabled={!playable}
                  onChange={(event) => dispatch({ type: 'seek', playheadMs: Number(event.target.value) })}
                  aria-valuetext={`${relativeToCollision(playback.playheadMs, replay.sessionTimeMs)}; frame ${selectedFrameIndex + 1} of ${frames.length}`}
                />
                </span>
                <span className={styles.timelineHeading}><span>{relativeToCollision(minimum, replay.sessionTimeMs)}</span><span>{relativeToCollision(maximum, replay.sessionTimeMs)}</span></span>
              </label>
              <p className={styles.status}><span aria-live="polite">{playback.playing ? `Playing at ${playback.rate}×` : 'Paused'}</span> · frame {selectedFrameIndex + 1}/{frames.length} · 패널에 포커스 후 Space 재생, 방향키로 프레임 이동</p>
              {!playable && <p className={styles.status}>시간이 다른 프레임이 없어 정지 화면으로 표시합니다.</p>}
              {selectedFrame?.telemetryUnavailable === null && <p className={styles.status}>legacy freshness unknown — speed and input values are suppressed.</p>}
            </div>
            <TelemetryPanel frame={selectedFrame} replay={replay} />
          </div>
        </>
      )}
    </section>
  );
}

function ReplaySvg({ t, replay, outline, map, project, frame, viewport }: {
  t: HubTheme;
  replay: IncidentReplayValue;
  outline: RaceAnalysisTrackOutline | null;
  map: ReplayMap;
  project: (x: number, z: number) => { x: number; y: number };
  frame: IncidentFrame | null;
  viewport: { width: number; height: number };
}) {
  // Captured trajectories are static during playback. Rebuild them only when
  // changing the clip or camera, not on every animation frame (up to 24 cars).
  const trajectories = useMemo(() => replay.participants.map((participant, participantPosition) => (
    <Trajectory key={participant.idx} tuples={replay.frames.map((sourceFrame) => sourceFrame.cars[participantPosition])} color={teamIdentity(participant.teamId).color} project={project} />
  )), [replay.participants, replay.frames, project]);
  return (
    <svg className={styles.trackSvg} width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label={`${map.label}; collision participants and their trajectory`}>
      <defs>
        <marker id="analysis-body-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={t.t1} /></marker>
        <marker id="analysis-motion-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={t.acc} /></marker>
      </defs>
      {outline?.points.length ? <Outline points={outline.points} project={project} /> : <LocalGrid label={map.label} viewport={viewport} />}
      {trajectories}
      <text x={16} y={viewport.height - 18} fill={t.t2} fontSize="11">{replay.collisions.map(([first, second]) => `COLL Car #${first} ↔ Car #${second}`).join(' · ') || 'Collision participants unavailable'}</text>
      {frame && replay.participants.map((participant, participantPosition) => {
        const car = decodeIncidentCar(frame.cars[participantPosition]);
        return car ? <ReplayCar key={participant.idx} participant={participant} car={car} project={project} labelAbove={participantPosition % 2 === 0} width={viewport.width} /> : null;
      })}
    </svg>
  );
}

function Outline({ points, project }: { points: Array<[number, number]>; project: (x: number, z: number) => { x: number; y: number } }) {
  const d = points.map(([x, z], index) => {
    const point = project(x, z);
    return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');
  return <><path d={d} fill="none" stroke="currentColor" strokeWidth="3" opacity=".5" /><text x={PADDING} y={26} fontSize="13">Recorded track centreline</text></>;
}

function LocalGrid({ label, viewport }: { label: string; viewport: { width: number; height: number } }) {
  const { vertical, horizontal } = localGridLinePositions(viewport.width, viewport.height, PADDING);
  return <g opacity=".55">
    {vertical.map((value) => <line key={`v-${value}`} x1={value} x2={value} y1={PADDING} y2={viewport.height - PADDING} stroke="currentColor" strokeWidth="1" />)}
    {horizontal.map((value) => <line key={`h-${value}`} x1={PADDING} x2={viewport.width - PADDING} y1={value} y2={value} stroke="currentColor" strokeWidth="1" />)}
    <text x={PADDING} y={26} fontSize="13">{label}</text>
  </g>;
}

function Trajectory({ tuples, color, project }: {
  tuples: Array<IncidentCarTuple | null | undefined>;
  color: string;
  project: (x: number, z: number) => { x: number; y: number };
}) {
  const points = tuples.map(decodeIncidentCar).filter((car): car is NonNullable<typeof car> => car !== null);
  if (points.length < 2) return null;
  const d = points.map((car, index) => {
    const point = project(car.x, car.z);
    return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');
  return <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity=".72" />;
}

function ReplayCar({ participant, car, project, labelAbove, width }: {
  participant: IncidentReplayValue['participants'][number];
  car: NonNullable<ReturnType<typeof decodeIncidentCar>>;
  project: (x: number, z: number) => { x: number; y: number };
  labelAbove: boolean;
  width: number;
}) {
  const point = project(car.x, car.z);
  const body = bodyScreenVector(car.yawRad);
  const motion = motionScreenVector(car.vx, car.vz);
  const team = teamIdentity(participant.teamId);
  const name = participantName(participant.name, participant.idx);
  const label = `${name} · Car #${participant.idx} · ${team.label}${participant.isPlayer ? ' · PLAYER' : ''}`;
  const labelY = point.y + (labelAbove ? -30 : 30);
  const labelOnLeft = point.x > width * 0.6;
  const labelX = point.x + (labelOnLeft ? -14 : 14);
  return <g aria-label={label}>
    <circle cx={point.x} cy={point.y} r={participant.isPlayer ? 12 : 9} fill={team.color} stroke={participant.isPlayer ? '#111' : '#fff'} strokeWidth={participant.isPlayer ? 4 : 2} />
    <line x1={point.x} y1={point.y} x2={point.x + body.x * 24} y2={point.y + body.y * 24} stroke="#1a1d24" strokeWidth="3" markerEnd="url(#analysis-body-arrow)" />
    {motion && <line x1={point.x} y1={point.y} x2={point.x + motion.x * 31} y2={point.y + motion.y * 31} stroke="#e0a83d" strokeWidth="3" strokeDasharray="4 3" markerEnd="url(#analysis-motion-arrow)" />}
    <text x={labelX} y={labelY} textAnchor={labelOnLeft ? 'end' : 'start'} fontSize="12" fontWeight="700" fill="currentColor">{name.length > 16 ? `${name.slice(0, 15)}…` : name} · #{participant.idx}{participant.isPlayer ? ' ★' : ''}</text>
    <text x={labelX} y={labelY + 15} textAnchor={labelOnLeft ? 'end' : 'start'} fontSize="10" fill="currentColor">{team.label}</text>
  </g>;
}

function TelemetryPanel({ frame, replay }: { frame: IncidentFrame | null; replay: IncidentReplayValue }) {
  return (
    <div className={styles.telemetry}>
      <table aria-label="Incident vehicle telemetry">
        <thead><tr><th>Vehicle</th><th>Speed</th><th>Throttle</th><th>Brake</th><th>Steer</th><th>Gear</th></tr></thead>
        <tbody>{replay.participants.map((participant, position) => {
          const car = decodeIncidentCar(frame?.cars[position]);
          const freshness = frame ? telemetryFreshness(frame, participant.idx) : 'unavailable';
          const values = car && freshness === 'fresh' ? telemetryValues(car) : ['—', '—', '—', '—', '—'];
          const team = teamIdentity(participant.teamId);
          return <tr key={participant.idx} className={participant.isPlayer ? styles.player : undefined}>
            <td>{participantName(participant.name, participant.idx)} · Car #{participant.idx}<br /><span className={styles.telemetryLabel}>{team.label}{participant.isPlayer ? ' · PLAYER' : ''}</span></td>
            {values.map((value, index) => <td key={index}>{value}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function telemetryValues(car: NonNullable<ReturnType<typeof decodeIncidentCar>>): [string, string, string, string, string] {
  return [
    `${car.speedKmh.toFixed(3)} km/h`,
    `${(car.throttle * 100).toFixed(3)}%`,
    `${(car.brake * 100).toFixed(3)}%`,
    car.steer.toFixed(3),
    car.gear === -1 ? 'R' : String(car.gear),
  ];
}

function mapPoint(element: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const matrix = element.querySelector('svg')?.getScreenCTM();
  if (!matrix) return null;
  return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
}

function relativeToCollision(playheadMs: number, collisionMs: number): string {
  const delta = relativeIncidentTimeMs(playheadMs, collisionMs);
  return `${delta >= 0 ? '+' : ''}${(delta / 1000).toFixed(3)}s`;
}

function projectionFor(map: ReplayMap, width: number, height: number): (x: number, z: number) => { x: number; y: number } {
  const spanX = Math.max(1, map.bounds.maxX - map.bounds.minX);
  const spanY = Math.max(1, map.bounds.maxY - map.bounds.minY);
  const scale = Math.min((width - PADDING * 2) / spanX, (height - PADDING * 2) / spanY);
  const drawWidth = spanX * scale;
  const drawHeight = spanY * scale;
  const originX = (width - drawWidth) / 2;
  const originY = (height - drawHeight) / 2;
  return (x, z) => ({ x: originX + (x - map.bounds.minX) * scale, y: originY + (-z - map.bounds.minY) * scale });
}
