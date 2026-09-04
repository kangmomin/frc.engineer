import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
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
  const timestamps = useMemo(() => frames.map((frame) => frame.tMs), [frames]);
  const [playback, setPlayback] = useState(() => createPlaybackState(timestamps));
  const map = useMemo(() => makeReplayMap({ ...replay, frames }, trackOutline), [frames, replay, trackOutline]);
  const project = useMemo(() => projectionFor(map), [map]);

  useEffect(() => {
    setPlayback(createPlaybackState(timestamps));
  }, [replay.raceId, replay.index, timestamps]);

  useEffect(() => {
    if (!playback.playing) return undefined;
    let rafId = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      if (previous !== null) setPlayback((state) => reducePlayback(state, { type: 'tick', elapsedMs: now - previous! }));
      previous = now;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playback.playing]);

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

  return (
    <section className={styles.replay} tabIndex={0} onKeyDown={onKeyDown} aria-label="Incident replay. Focus here to use Space, arrow keys, Home and End.">
      <div className={styles.replayHeader}>
        <div><h3>Incident replay</h3><p className={styles.meta}>Collision 0 ms · measured timestamps · focus this panel for keyboard controls</p></div>
        <span className={styles.badge}>{replay.completeness.status}</span>
      </div>

      {frames.length === 0 ? (
        <p className={styles.empty}>This incident has no usable stored frames.</p>
      ) : (
        <>
          <div className={styles.svgWrap}>
            <ReplaySvg t={t} replay={replay} outline={trackOutline} map={map} project={project} frame={selectedFrame} />
          </div>
          <div className={styles.replayGrid}>
            <div>
              <div className={styles.controls} aria-label="Replay controls">
                <button type="button" aria-pressed={playback.playing} onClick={() => dispatch({ type: 'toggle' })}>{playback.playing ? 'Pause' : 'Play'}</button>
                <button type="button" onClick={() => dispatch({ type: 'previous-frame' })} aria-label="Previous measured frame">Previous frame</button>
                <button type="button" onClick={() => dispatch({ type: 'next-frame' })} aria-label="Next measured frame">Next frame</button>
                <button type="button" onClick={() => dispatch({ type: 'home' })}>Home</button>
                <button type="button" onClick={() => dispatch({ type: 'end' })}>End</button>
                {RATES.map((rate) => <button key={rate} type="button" aria-pressed={playback.rate === rate} onClick={() => dispatch({ type: 'rate', rate })}>{rate}×</button>)}
              </div>
              <label className={styles.status}>
                Timeline
                <input
                  className={styles.slider} type="range" min={minimum} max={maximum} step="any" value={playback.playheadMs}
                  onChange={(event) => dispatch({ type: 'seek', playheadMs: Number(event.target.value) })}
                  aria-valuetext={`${relativeToCollision(playback.playheadMs, replay.sessionTimeMs)}; frame ${selectedFrameIndex + 1} of ${frames.length}`}
                />
              </label>
              <p className={styles.status} aria-live="polite">{playback.playing ? `Playing at ${playback.rate}×` : 'Paused'} · {relativeToCollision(playback.playheadMs, replay.sessionTimeMs)} · frame {selectedFrameIndex + 1}/{frames.length}</p>
              {selectedFrame?.telemetryUnavailable === null && <p className={styles.status}>legacy freshness unknown — speed and input values are suppressed.</p>}
            </div>
            <TelemetryPanel frame={selectedFrame} replay={replay} />
          </div>
        </>
      )}
    </section>
  );
}

function ReplaySvg({ t, replay, outline, map, project, frame }: {
  t: HubTheme;
  replay: IncidentReplayValue;
  outline: RaceAnalysisTrackOutline | null;
  map: ReplayMap;
  project: (x: number, z: number) => { x: number; y: number };
  frame: IncidentFrame | null;
}) {
  return (
    <svg className={styles.trackSvg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${map.label}; collision participants and their trajectory`}>
      <defs>
        <marker id="analysis-body-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={t.t1} /></marker>
        <marker id="analysis-motion-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={t.acc} /></marker>
      </defs>
      {outline?.points.length ? <Outline points={outline.points} project={project} /> : <LocalGrid label={map.label} />}
      {replay.participants.map((participant, participantPosition) => (
        <Trajectory key={participant.idx} tuples={replay.frames.map((sourceFrame) => sourceFrame.cars[participantPosition])} color={teamIdentity(participant.teamId).color} project={project} />
      ))}
      <text x={PADDING} y={HEIGHT - 18} fill={t.t2} fontSize="13">{replay.collisions.map(([first, second]) => `COLL Car #${first} ↔ Car #${second}`).join(' · ') || 'Collision participants unavailable'}</text>
      {frame && replay.participants.map((participant, participantPosition) => {
        const car = decodeIncidentCar(frame.cars[participantPosition]);
        return car ? <ReplayCar key={participant.idx} participant={participant} car={car} project={project} /> : null;
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

function LocalGrid({ label }: { label: string }) {
  const { vertical, horizontal } = localGridLinePositions(WIDTH, HEIGHT, PADDING);
  return <g opacity=".55">
    {vertical.map((value) => <line key={`v-${value}`} x1={value} x2={value} y1={PADDING} y2={HEIGHT - PADDING} stroke="currentColor" strokeWidth="1" />)}
    {horizontal.map((value) => <line key={`h-${value}`} x1={PADDING} x2={WIDTH - PADDING} y1={value} y2={value} stroke="currentColor" strokeWidth="1" />)}
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

function ReplayCar({ participant, car, project }: {
  participant: IncidentReplayValue['participants'][number];
  car: NonNullable<ReturnType<typeof decodeIncidentCar>>;
  project: (x: number, z: number) => { x: number; y: number };
}) {
  const point = project(car.x, car.z);
  const body = bodyScreenVector(car.yawRad);
  const motion = motionScreenVector(car.vx, car.vz);
  const team = teamIdentity(participant.teamId);
  const name = participantName(participant.name, participant.idx);
  const label = `${name} · Car #${participant.idx} · ${team.label}${participant.isPlayer ? ' · PLAYER' : ''}`;
  return <g aria-label={label}>
    <circle cx={point.x} cy={point.y} r={participant.isPlayer ? 12 : 9} fill={team.color} stroke={participant.isPlayer ? '#111' : '#fff'} strokeWidth={participant.isPlayer ? 4 : 2} />
    <line x1={point.x} y1={point.y} x2={point.x + body.x * 24} y2={point.y + body.y * 24} stroke="#1a1d24" strokeWidth="3" markerEnd="url(#analysis-body-arrow)" />
    {motion && <line x1={point.x} y1={point.y} x2={point.x + motion.x * 31} y2={point.y + motion.y * 31} stroke="#e0a83d" strokeWidth="3" strokeDasharray="4 3" markerEnd="url(#analysis-motion-arrow)" />}
    <text x={point.x + 14} y={point.y - 14} fontSize="12" fontWeight="700">{name} · Car #{participant.idx}{participant.isPlayer ? ' ★ PLAYER' : ''}</text>
    <text x={point.x + 14} y={point.y + 2} fontSize="10">{team.label}</text>
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
    `${car.speedKmh.toFixed(0)} km/h`,
    `${Math.round(car.throttle * 100)}%`,
    `${Math.round(car.brake * 100)}%`,
    car.steer.toFixed(2),
    car.gear === -1 ? 'R' : String(car.gear),
  ];
}

function relativeToCollision(playheadMs: number, collisionMs: number): string {
  const delta = relativeIncidentTimeMs(playheadMs, collisionMs);
  return `${delta >= 0 ? '+' : ''}${(delta / 1000).toFixed(3)}s`;
}

function projectionFor(map: ReplayMap): (x: number, z: number) => { x: number; y: number } {
  const spanX = Math.max(1, map.bounds.maxX - map.bounds.minX);
  const spanY = Math.max(1, map.bounds.maxY - map.bounds.minY);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const drawWidth = spanX * scale;
  const drawHeight = spanY * scale;
  const originX = (WIDTH - drawWidth) / 2;
  const originY = (HEIGHT - drawHeight) / 2;
  return (x, z) => ({ x: originX + (x - map.bounds.minX) * scale, y: originY + (-z - map.bounds.minY) * scale });
}
