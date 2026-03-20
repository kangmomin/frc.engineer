import { useState, useMemo, useRef, useEffect, useCallback, memo, useSyncExternalStore } from 'react';
import type {
  SessionInfo,
  DriverInfo,
  TrackMapData,
  MarshalZone,
  RaceControlNotification,
} from '../../../types/telemetry';
import { getTeamColor } from '../../../constants/teamColors';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './TrackMapSection.module.css';

// --- Custom-equality selector hook (zustand v5 doesn't support equality fn) ---

function useStoreWithEq<T>(
  selector: (state: ReturnType<typeof useTelemetryStore.getState>) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const prev = useRef<T>(selector(useTelemetryStore.getState()));
  const getSnapshot = useCallback(() => {
    const next = selector(useTelemetryStore.getState());
    if (isEqual(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  }, [selector, isEqual]);
  return useSyncExternalStore(useTelemetryStore.subscribe, getSnapshot);
}

function trackMapEqual(a?: TrackMapData, b?: TrackMapData): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.minX === b.minX &&
    a.maxX === b.maxX &&
    a.minZ === b.minZ &&
    a.maxZ === b.maxZ &&
    a.points.length === b.points.length
  );
}

function marshalZonesEqual(a?: MarshalZone[], b?: MarshalZone[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].flag !== b[i].flag) return false;
  }
  return true;
}

// Stable selectors for useStoreWithEq (must not be inline to avoid getSnapshot churn)
const selectTrackMap = (s: ReturnType<typeof useTelemetryStore.getState>) => s.pitwallState?.trackMap;
const selectMarshalZones = (s: ReturnType<typeof useTelemetryStore.getState>) => s.pitwallState?.session?.marshalZones;

export function TrackMapSection() {
  // Primitive selectors — re-render only when actual values change
  const hasSession = useTelemetryStore((s) => s.pitwallState?.session != null);
  const trackName = useTelemetryStore((s) => s.pitwallState?.session?.trackName ?? 'Track');
  const sessionType = useTelemetryStore((s) => s.pitwallState?.session?.sessionType ?? 'No Session');
  const trackTemp = useTelemetryStore((s) => s.pitwallState?.session?.trackTemp ?? 0);
  const airTemp = useTelemetryStore((s) => s.pitwallState?.session?.airTemp ?? 0);
  const trackLength = useTelemetryStore((s) => s.pitwallState?.session?.trackLength ?? 0);

  const trackMap = useStoreWithEq(selectTrackMap, trackMapEqual);
  const marshalZones = useStoreWithEq(selectMarshalZones, marshalZonesEqual);

  const turns = useMemo(() => (trackMap ? detectTurns(trackMap) : []), [trackMap]);

  // currentTurn via store subscription + throttled setState (no positions in React state)
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const lastTurnUpdate = useRef(0);

  useEffect(() => {
    if (turns.length === 0) {
      setCurrentTurn(null);
      return;
    }

    const unsub = useTelemetryStore.subscribe((state) => {
      const now = performance.now();
      if (now - lastTurnUpdate.current < 500) return; // 500ms throttle

      const positions = state.pitwallState?.positions;
      const pIdx = state.pitwallState?.playerIndex ?? 0;
      if (!positions) return;

      const playerPos = positions.find((p) => p.index === pIdx);
      if (!playerPos) return;

      let nearestNum: number | null = null;
      let minDist = Infinity;
      for (const t of turns) {
        const dx = playerPos.x - t.apexX;
        const dz = playerPos.z - t.apexZ;
        const d = dx * dx + dz * dz;
        if (d < minDist) {
          minDist = d;
          nearestNum = t.num;
        }
      }

      // Only setState if turn actually changed
      lastTurnUpdate.current = now;
      setCurrentTurn((prev) => prev === nearestNum ? prev : nearestNum);
    });

    return unsub;
  }, [turns]);

  return (
    <div className={styles.container}>
      <SectionHeader
        title={trackName}
        subtitle={sessionType}
      />

      <div className={styles.content}>
        <div className={styles.trackArea}>
          <TrackCanvasMemo
            trackMap={trackMap}
            marshalZones={marshalZones}
            turns={turns}
          />
        </div>

        <div className={styles.trackFooter}>
          <TrackFooter
            hasSession={hasSession}
            trackTemp={trackTemp}
            airTemp={airTemp}
            trackLength={trackLength}
            currentTurn={currentTurn}
          />
        </div>
      </div>
    </div>
  );
}

// Exported for use in PaceAnalysisSection
export function WeatherBadge({ session }: { session: SessionInfo | null }) {
  if (!session) return null;

  const weatherEmoji = getWeatherEmoji(session.weather);
  const safetyCarClass = session.safetyCar !== 'none' ? styles.scActive : '';

  return (
    <div className={styles.weatherBadge}>
      <span className={styles.weatherIcon}>{weatherEmoji}</span>
      <span className={styles.temp}>{Math.round(session.trackTemp)}°C</span>
      {session.safetyCar !== 'none' && (
        <span className={`${styles.scBadge} ${safetyCarClass}`}>
          {session.safetyCar === 'virtual' ? 'VSC' : 'SC'}
        </span>
      )}
    </div>
  );
}

export function getWeatherEmoji(weather: string): string {
  // Normalize weather string (backend uses underscores, handle both formats)
  const normalized = weather.toLowerCase().replace(/_/g, ' ');
  const map: Record<string, string> = {
    clear: '☀️',
    'light cloud': '🌤️',
    overcast: '☁️',
    'light rain': '🌦️',
    'heavy rain': '🌧️',
    storm: '⛈️',
  };
  return map[normalized] ?? '☀️';
}

interface Turn {
  num: number;
  apexX: number;
  apexZ: number;
  x: number; // label position (offset from track)
  z: number;
}

/** Detect turns from track curvature. Returns stable array for a given trackMap. */
function detectTurns(trackMap: TrackMapData): Turn[] {
  if (trackMap.points.length < 20) return [];
  const pts = trackMap.points;
  const len = pts.length;

  const step = 5;
  const curvatures: number[] = new Array(len).fill(0);
  for (let i = step; i < len - step; i++) {
    const ax = pts[i].x - pts[i - step].x;
    const az = pts[i].z - pts[i - step].z;
    const bx = pts[i + step].x - pts[i].x;
    const bz = pts[i + step].z - pts[i].z;
    const angle1 = Math.atan2(az, ax);
    const angle2 = Math.atan2(bz, bx);
    let diff = angle2 - angle1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    curvatures[i] = Math.abs(diff);
  }

  const windowSize = 15;
  const smoothed: number[] = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(len - 1, i + windowSize); j++) {
      sum += curvatures[j];
      count++;
    }
    smoothed[i] = sum / count;
  }

  const threshold = 0.015;
  const minGap = Math.floor(len / 50);
  const peaks: { index: number; x: number; z: number }[] = [];

  for (let i = 1; i < len - 1; i++) {
    if (smoothed[i] > threshold && smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1].index >= minGap) {
        peaks.push({ index: i, x: pts[i].x, z: pts[i].z });
      } else if (smoothed[i] > smoothed[peaks[peaks.length - 1].index]) {
        peaks[peaks.length - 1] = { index: i, x: pts[i].x, z: pts[i].z };
      }
    }
  }

  const cx = (trackMap.minX + trackMap.maxX) / 2;
  const cz = (trackMap.minZ + trackMap.maxZ) / 2;
  const offset = 25;

  return peaks.map((p, i) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    return {
      num: i + 1,
      apexX: p.x,
      apexZ: p.z,
      x: p.x + (dx / dist) * offset,
      z: p.z + (dz / dist) * offset,
    };
  });
}

/** Map marshal zone flag number to color */
const FLAG_COLORS: Record<number, string> = {
  1: '#2ecc71', // green
  2: '#3498db', // blue
  3: '#f1c40f', // yellow
  4: '#e74c3c', // red
};

// --- Canvas coordinate transform (replaces SVG viewBox + preserveAspectRatio) ---

interface Transform {
  scale: number;
  offsetX: number;
  offsetZ: number;
  worldMinX: number;
  worldMinZ: number;
}

interface CarVisual {
  color: string;
  position: number;
  isPlayer: boolean;
}

function recalcTransform(canvasW: number, canvasH: number, tm: TrackMapData): Transform {
  const padding = 50;
  const worldMinX = tm.minX - padding;
  const worldMinZ = tm.minZ - padding;
  const worldW = tm.maxX - tm.minX + padding * 2;
  const worldH = tm.maxZ - tm.minZ + padding * 2;
  const scale = Math.min(canvasW / worldW, canvasH / worldH);
  return {
    scale,
    offsetX: (canvasW - worldW * scale) / 2,
    offsetZ: (canvasH - worldH * scale) / 2,
    worldMinX,
    worldMinZ,
  };
}

/** Parse SVG M/L/Z path commands and replay onto canvas context */
function tracePath(ctx: CanvasRenderingContext2D, d: string, t: Transform) {
  const tokens = d.match(/[MLZ]|[-+]?\d*\.?\d+/g);
  if (!tokens) return;
  let i = 0;
  while (i < tokens.length) {
    switch (tokens[i]) {
      case 'M': {
        const cx = (+tokens[i + 1] - t.worldMinX) * t.scale + t.offsetX;
        const cz = (+tokens[i + 2] - t.worldMinZ) * t.scale + t.offsetZ;
        ctx.moveTo(cx, cz);
        i += 3;
        break;
      }
      case 'L': {
        const cx = (+tokens[i + 1] - t.worldMinX) * t.scale + t.offsetX;
        const cz = (+tokens[i + 2] - t.worldMinZ) * t.scale + t.offsetZ;
        ctx.lineTo(cx, cz);
        i += 3;
        break;
      }
      case 'Z':
        ctx.closePath();
        i += 1;
        break;
      default:
        i += 1;
    }
  }
}

const RACING_FONT = "'Orbitron', 'Rajdhani', monospace";

interface TrackCanvasProps {
  trackMap?: TrackMapData;
  marshalZones?: MarshalZone[];
  turns: Turn[];
}

function TrackCanvas({ trackMap, marshalZones, turns }: TrackCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<Transform | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const carVisuals = useRef<Map<number, CarVisual>>(new Map());
  const driverMapRef = useRef<{ arr: DriverInfo[]; map: Map<number, DriverInfo> }>({ arr: [], map: new Map() });
  const animPos = useRef<Map<number, {
    x: number; z: number;
    tgtX: number; tgtZ: number;
  }>>(new Map());
  const rafId = useRef(0);
  const staticDirty = useRef(true);
  const drawStaticLayerRef = useRef<() => void>(() => {});

  // Clear on track change
  useEffect(() => {
    animPos.current.clear();
    carVisuals.current.clear();
  }, [trackMap]);

  // --- Memoized geometry data (unchanged from SVG version) ---

  const sectorData = useMemo(() => {
    if (!trackMap || trackMap.points.length < 2) return [];
    const pts = trackMap.points;
    const sectorPoints: Map<number, { x: number; z: number }[]> = new Map();
    for (const pt of pts) {
      if (!sectorPoints.has(pt.sector)) sectorPoints.set(pt.sector, []);
      sectorPoints.get(pt.sector)!.push({ x: pt.x, z: pt.z });
    }

    const result: { sector: number; path: string; midX: number; midZ: number }[] = [];
    let currentSector = pts[0].sector;
    let d = `M ${pts[0].x} ${pts[0].z}`;

    for (let i = 1; i < pts.length; i++) {
      if (pts[i].sector !== currentSector) {
        d += ` L ${pts[i].x} ${pts[i].z}`;
        const sp = sectorPoints.get(currentSector)!;
        const mid = sp[Math.floor(sp.length / 2)];
        result.push({ sector: currentSector, path: d, midX: mid.x, midZ: mid.z });
        currentSector = pts[i].sector;
        d = `M ${pts[i].x} ${pts[i].z}`;
      } else {
        d += ` L ${pts[i].x} ${pts[i].z}`;
      }
    }
    d += ` L ${pts[0].x} ${pts[0].z}`;
    const sp = sectorPoints.get(currentSector)!;
    const mid = sp[Math.floor(sp.length / 2)];
    result.push({ sector: currentSector, path: d, midX: mid.x, midZ: mid.z });
    return result;
  }, [trackMap]);

  const drsZones = useMemo(() => {
    if (!trackMap || trackMap.points.length < 2) return [];
    const pts = trackMap.points;
    const zones: { path: string; midX: number; midZ: number }[] = [];
    let inDrs = false;
    let d = '';
    let zonePoints: { x: number; z: number }[] = [];

    for (let i = 0; i < pts.length; i++) {
      if (pts[i].drs === 1 && !inDrs) {
        inDrs = true;
        d = `M ${pts[i].x} ${pts[i].z}`;
        zonePoints = [{ x: pts[i].x, z: pts[i].z }];
      } else if (pts[i].drs === 1 && inDrs) {
        d += ` L ${pts[i].x} ${pts[i].z}`;
        zonePoints.push({ x: pts[i].x, z: pts[i].z });
      } else if (pts[i].drs === 0 && inDrs) {
        inDrs = false;
        if (zonePoints.length > 1) {
          const mid = zonePoints[Math.floor(zonePoints.length / 2)];
          zones.push({ path: d, midX: mid.x, midZ: mid.z });
        }
      }
    }
    if (inDrs && zonePoints.length > 1) {
      const mid = zonePoints[Math.floor(zonePoints.length / 2)];
      zones.push({ path: d, midX: mid.x, midZ: mid.z });
    }
    return zones;
  }, [trackMap]);

  const sectorFlags = useMemo(() => {
    const flags: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    if (!marshalZones || !trackMap || trackMap.points.length === 0) return flags;
    const totalPts = trackMap.points.length;
    for (const mz of marshalZones) {
      if (mz.flag <= 0) continue;
      const ptIdx = Math.min(Math.floor(mz.start * totalPts), totalPts - 1);
      const sector = trackMap.points[ptIdx].sector;
      if (mz.flag > flags[sector]) flags[sector] = mz.flag;
    }
    return flags;
  }, [marshalZones, trackMap]);

  const trackPath = useMemo(() => {
    if (!trackMap || trackMap.points.length < 2) return '';
    const pts = trackMap.points;
    let d = `M ${pts[0].x} ${pts[0].z}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].z}`;
    }
    d += ' Z';
    return d;
  }, [trackMap]);

  // Mark static layer dirty when geometry or flag data changes
  useEffect(() => { staticDirty.current = true; }, [trackPath, sectorData, drsZones, sectorFlags, turns]);

  // Static layer draw function — kept in ref so rAF tick always calls the latest version
  drawStaticLayerRef.current = () => {
    const off = offscreenRef.current;
    const t = transformRef.current;
    if (!off || !t) return;
    const { w, h, dpr } = sizeRef.current;
    const ctx = off.getContext('2d')!;

    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Track outline background
    if (trackPath) {
      ctx.beginPath();
      tracePath(ctx, trackPath, t);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 20 * t.scale;
      ctx.stroke();
    }

    // Sector paths (colored when flagged)
    for (const s of sectorData) {
      const flag = sectorFlags[s.sector] ?? 0;
      ctx.beginPath();
      tracePath(ctx, s.path, t);
      ctx.strokeStyle = flag > 0 ? (FLAG_COLORS[flag] ?? 'rgba(255,255,255,0.5)') : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 12 * t.scale;
      ctx.stroke();
    }

    // DRS zones
    ctx.globalAlpha = 0.5;
    for (const zone of drsZones) {
      ctx.beginPath();
      tracePath(ctx, zone.path, t);
      ctx.strokeStyle = '#00e600';
      ctx.lineWidth = 16 * t.scale;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Text labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Sector labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `700 ${16 * t.scale}px ${RACING_FONT}`;
    for (const s of sectorData) {
      const sx = (s.midX - t.worldMinX) * t.scale + t.offsetX;
      const sz = (s.midZ - t.worldMinZ) * t.scale + t.offsetZ;
      ctx.fillText(`S${s.sector + 1}`, sx, sz);
    }

    // DRS labels
    ctx.fillStyle = '#00e600';
    ctx.font = `700 ${10 * t.scale}px ${RACING_FONT}`;
    for (const zone of drsZones) {
      const dx = (zone.midX - t.worldMinX) * t.scale + t.offsetX;
      const dz = (zone.midZ - t.worldMinZ) * t.scale + t.offsetZ;
      ctx.fillText('DRS', dx, dz);
    }

    // Turn labels
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `600 ${10 * t.scale}px ${RACING_FONT}`;
    for (const turn of turns) {
      const tx = (turn.x - t.worldMinX) * t.scale + t.offsetX;
      const tz = (turn.z - t.worldMinZ) * t.scale + t.offsetZ;
      ctx.fillText(`T${turn.num}`, tx, tz);
    }

    ctx.restore();
    staticDirty.current = false;
  };

  // ResizeObserver — HiDPI canvas sizing + transform recalculation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (w === 0 || h === 0) return;

      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;

      if (!offscreenRef.current) {
        offscreenRef.current = document.createElement('canvas');
      }
      offscreenRef.current.width = w * dpr;
      offscreenRef.current.height = h * dpr;

      if (trackMap) {
        transformRef.current = recalcTransform(w, h, trackMap);
      }
      staticDirty.current = true;
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [trackMap]);

  // Redraw static layer after web fonts load
  useEffect(() => {
    document.fonts.ready.then(() => { staticDirty.current = true; });
  }, []);

  // Store subscription — update animation targets and car visuals (no React state)
  useEffect(() => {
    const unsub = useTelemetryStore.subscribe((state) => {
      const positions = state.pitwallState?.positions ?? [];
      const drivers = state.pitwallState?.drivers ?? [];
      const pIdx = state.pitwallState?.playerIndex ?? 0;

      const dmRef = driverMapRef.current;
      if (drivers !== dmRef.arr) {
        dmRef.arr = drivers;
        dmRef.map.clear();
        for (const d of drivers) dmRef.map.set(d.index, d);
      }
      const dm = dmRef.map;

      const activeIndices = new Set<number>();
      for (const p of positions) {
        activeIndices.add(p.index);

        // Animation targets
        if (!animPos.current.has(p.index)) {
          animPos.current.set(p.index, { x: p.x, z: p.z, tgtX: p.x, tgtZ: p.z });
        } else {
          const s = animPos.current.get(p.index)!;
          if ((p.x - s.x) ** 2 + (p.z - s.z) ** 2 > 10000) {
            s.x = p.x;
            s.z = p.z;
          }
          s.tgtX = p.x;
          s.tgtZ = p.z;
        }

        const driver = dm.get(p.index);
        if (!driver) continue;
        carVisuals.current.set(p.index, {
          color: getTeamColor(driver.teamId),
          position: driver.position,
          isPlayer: p.index === pIdx,
        });
      }

      // Prune departed cars
      if (animPos.current.size > activeIndices.size) {
        for (const idx of animPos.current.keys()) {
          if (!activeIndices.has(idx)) {
            animPos.current.delete(idx);
            carVisuals.current.delete(idx);
          }
        }
      }
    });
    return unsub;
  }, []);

  // rAF tick — lerp interpolation + canvas draw
  useEffect(() => {
    let lastTime = performance.now();

    function tick(time: number) {
      const dtMs = Math.min(time - lastTime, 100);
      lastTime = time;
      const smoothing = 1 - Math.exp(-dtMs * 0.015);

      // Lerp positions
      for (const [, state] of animPos.current) {
        let newX = state.x + (state.tgtX - state.x) * smoothing;
        let newZ = state.z + (state.tgtZ - state.z) * smoothing;
        if (Math.abs(state.tgtX - newX) < 0.01 && Math.abs(state.tgtZ - newZ) < 0.01) {
          newX = state.tgtX;
          newZ = state.tgtZ;
        }
        state.x = newX;
        state.z = newZ;
      }

      // Draw
      const canvas = canvasRef.current;
      const t = transformRef.current;
      if (!canvas || !t) {
        rafId.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId.current = requestAnimationFrame(tick);
        return;
      }

      const { w, h, dpr } = sizeRef.current;

      // Redraw static layer if dirty (data changed, resize, font load)
      if (staticDirty.current) drawStaticLayerRef.current();

      // Composite: blit static layer then draw dynamic cars on top
      ctx.clearRect(0, 0, w * dpr, h * dpr);
      if (offscreenRef.current) ctx.drawImage(offscreenRef.current, 0, 0);

      // Draw cars
      ctx.save();
      ctx.scale(dpr, dpr);

      for (const [idx, car] of carVisuals.current) {
        const pos = animPos.current.get(idx);
        if (!pos) continue;

        const cx = (pos.x - t.worldMinX) * t.scale + t.offsetX;
        const cz = (pos.z - t.worldMinZ) * t.scale + t.offsetZ;

        // Player outer glow ring
        if (car.isPlayer) {
          ctx.beginPath();
          ctx.arc(cx, cz, 22 * t.scale, 0, Math.PI * 2);
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 2 * t.scale;
          ctx.globalAlpha = 0.4;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Car dot
        const r = (car.isPlayer ? 16 : 12) * t.scale;
        ctx.beginPath();
        ctx.arc(cx, cz, r, 0, Math.PI * 2);
        ctx.fillStyle = car.color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.strokeStyle = car.isPlayer ? '#00FF00' : 'white';
        ctx.lineWidth = (car.isPlayer ? 4 : 2) * t.scale;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Position number
        const fontSize = (car.isPlayer ? 13 : 11) * t.scale;
        ctx.font = `bold ${fontSize}px ${RACING_FONT}`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(car.position), cx, cz);
      }

      ctx.restore();
      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  if (!trackMap || trackMap.points.length === 0) {
    return (
      <div className={styles.noTrack}>
        <span>No track data available</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className={styles.trackCanvas} />;
}

const TrackCanvasMemo = memo(TrackCanvas);

export interface WeatherTimelineProps {
  forecasts: SessionInfo['weatherForecast'];
}

// Exported for use in PaceAnalysisSection
export function WeatherTimeline({ forecasts }: WeatherTimelineProps) {
  if (!forecasts || forecasts.length === 0) {
    return <div className={styles.noForecast}>No forecast data</div>;
  }

  return (
    <div className={styles.forecastList}>
      {forecasts.map((fc, idx) => {
        const hasRain = fc.rainPercentage > 0;
        const isHighRain = fc.rainPercentage >= 50;
        const rainClass = isHighRain ? styles.highRain : hasRain ? styles.hasRain : '';

        return (
          <div key={idx} className={`${styles.forecastItem} ${rainClass}`}>
            <span className={styles.forecastTime}>
              {idx === 0 ? 'Now' : `+${fc.timeOffset}m`}
            </span>
            <span className={styles.forecastWeather}>
              {getWeatherEmoji(fc.weather)}
            </span>
            <div className={styles.forecastDetails}>
              {hasRain && (
                <span className={styles.forecastRain}>
                  {fc.rainPercentage}%
                </span>
              )}
              <span className={styles.forecastTemp}>
                {Math.round(fc.trackTemp)}°
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface RaceControlLogProps {
  notifications: RaceControlNotification[];
}

// Exported for use in PaceAnalysisSection
export function RaceControlLog({ notifications }: RaceControlLogProps) {
  if (notifications.length === 0) {
    return (
      <div className={styles.noNotifications}>
        No race control messages
      </div>
    );
  }

  return (
    <div className={styles.notificationList}>
      {notifications.slice(0, 5).map((n) => {
        const penaltyMatch = n.severity === 'critical' && n.category === 'penalty' ? n.message.match(/\((\d+)s\)/) : null;
        return (
          <div
            key={n.id}
            className={`${styles.notification} ${styles[n.severity]}`}
          >
            <span className={styles.notificationTime}>
              {formatTime(n.timestamp)}
            </span>
            <span className={styles.notificationMessage}>{n.message}</span>
            {penaltyMatch && (
              <span className={styles.penaltyBadge}>+{penaltyMatch[1]}s</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface TrackFooterProps {
  hasSession: boolean;
  trackTemp: number;
  airTemp: number;
  trackLength: number;
  currentTurn: number | null;
}

function TrackFooter({ hasSession, trackTemp, airTemp, trackLength, currentTurn }: TrackFooterProps) {
  if (!hasSession) return null;

  return (
    <div className={styles.footerGrid}>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Track</span>
        <span className={styles.footerValue}>{trackTemp}°C</span>
      </div>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Air</span>
        <span className={styles.footerValue}>{airTemp}°C</span>
      </div>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Length</span>
        <span className={styles.footerValue}>{(trackLength / 1000).toFixed(2)}km</span>
      </div>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Turn</span>
        <span className={styles.footerValue}>{currentTurn != null ? `T${currentTurn}` : '-'}</span>
      </div>
    </div>
  );
}
