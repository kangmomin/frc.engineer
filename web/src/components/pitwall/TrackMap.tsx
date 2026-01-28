import { useMemo } from 'react';
import type { CarPosition, DriverInfo, MarshalZone, TrackMapData } from '../../types/telemetry';
import styles from './TrackMap.module.css';

interface TrackMapProps {
  positions: CarPosition[];
  drivers: DriverInfo[];
  playerIndex: number;
  trackMap?: TrackMapData;
  marshalZones?: MarshalZone[];
  trackLength?: number;
}

function teamColor(teamId: number): string {
  switch (teamId) {
    case 0: return '#00D2BE'; // Mercedes
    case 1: return '#DC0000'; // Ferrari
    case 2: return '#3671C6'; // Red Bull
    case 3: return '#FF8700'; // McLaren
    case 4: return '#006F62'; // Aston Martin
    case 5: return '#0090FF'; // Alpine
    case 6: return '#005AFF'; // Williams
    case 7: return '#6692FF'; // RB
    case 8: return '#52E252'; // Kick Sauber
    case 9: return '#B6BABD'; // Haas
    default: return '#888888';
  }
}

const SECTOR_COLORS: Record<number, string> = {
  0: '#ff4444', // S1 red
  1: '#4488ff', // S2 blue
  2: '#ffcc00', // S3 yellow
};

const DRS_COLOR = '#00cc44';
const PADDING = 50;

export function TrackMap({ positions, drivers, playerIndex, trackMap, marshalZones, trackLength }: TrackMapProps) {
  const driverMap = useMemo(() => {
    const map = new Map<number, DriverInfo>();
    for (const d of drivers) {
      map.set(d.index, d);
    }
    return map;
  }, [drivers]);

  const activePositions = useMemo(
    () => positions.filter((p) => p.x !== 0 || p.z !== 0),
    [positions],
  );

  const hasMap = trackMap && trackMap.points.length > 10;

  const viewBox = useMemo(() => {
    if (hasMap) {
      const tm = trackMap!;
      return {
        x: tm.minX - PADDING,
        y: tm.minZ - PADDING,
        w: tm.maxX - tm.minX + PADDING * 2,
        h: tm.maxZ - tm.minZ + PADDING * 2,
      };
    }
    if (activePositions.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of activePositions) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return {
      x: minX - PADDING,
      y: minZ - PADDING,
      w: maxX - minX + PADDING * 2,
      h: maxZ - minZ + PADDING * 2,
    };
  }, [hasMap, trackMap, activePositions]);

  // Build sector paths and DRS paths from track map points
  const { sectorPaths, drsPaths } = useMemo(() => {
    if (!hasMap) return { sectorPaths: [] as { d: string; color: string }[], drsPaths: [] as string[] };

    const pts = trackMap!.points;
    // Group consecutive points by sector
    const sectors: { d: string; color: string }[] = [];
    let currentSector = pts[0].sector;
    let pathParts: string[] = [`M${pts[0].x},${pts[0].z}`];

    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.sector !== currentSector) {
        // Close current sector path
        sectors.push({ d: pathParts.join(' '), color: SECTOR_COLORS[currentSector] ?? '#555' });
        currentSector = p.sector;
        // Start new path from previous point for continuity
        pathParts = [`M${pts[i - 1].x},${pts[i - 1].z}`, `L${p.x},${p.z}`];
      } else {
        pathParts.push(`L${p.x},${p.z}`);
      }
    }
    sectors.push({ d: pathParts.join(' '), color: SECTOR_COLORS[currentSector] ?? '#555' });

    // DRS zones: consecutive runs where drs=1
    const drs: string[] = [];
    let inDRS = false;
    let drsParts: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.drs === 1) {
        if (!inDRS) {
          inDRS = true;
          drsParts = [`M${p.x},${p.z}`];
        } else {
          drsParts.push(`L${p.x},${p.z}`);
        }
      } else if (inDRS) {
        inDRS = false;
        drs.push(drsParts.join(' '));
      }
    }
    if (inDRS) drs.push(drsParts.join(' '));

    return { sectorPaths: sectors, drsPaths: drs };
  }, [hasMap, trackMap]);

  // Marshal zone yellow flag overlay
  const yellowZones = useMemo(() => {
    if (!hasMap || !marshalZones || marshalZones.length === 0 || !trackLength) return null;

    const pts = trackMap!.points;
    const totalDist = trackLength;
    const sorted = [...marshalZones].sort((a, b) => a.start - b.start);

    return sorted.filter(z => z.flag === 3).map((zone, idx) => {
      const startFrac = zone.start;
      // End at next zone start or wrap
      const nextIdx = sorted.indexOf(zone) + 1;
      const endFrac = nextIdx < sorted.length ? sorted[nextIdx].start : 1.0;
      const startDist = startFrac * totalDist;
      const endDist = endFrac * totalDist;

      // Approximate: use point index proportional to distance
      const totalPts = pts.length;
      const startI = Math.floor((startDist / totalDist) * totalPts);
      const endI = Math.floor((endDist / totalDist) * totalPts);
      const seg = pts.slice(startI, endI + 1);
      if (seg.length < 2) return null;

      const d = seg.map((p, i) => (i === 0 ? `M${p.x},${p.z}` : `L${p.x},${p.z}`)).join(' ');
      return <path key={`yz-${idx}`} d={d} fill="none" stroke="#ffcc00" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" className={styles.yellowFlash} />;
    });
  }, [hasMap, trackMap, marshalZones, trackLength]);

  if ((activePositions.length === 0 && !hasMap) || !viewBox) {
    return (
      <div className={styles.panel}>
        <div className={styles.label}>Track Map</div>
        <div className={styles.empty}>Waiting for data...</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.label}>Track Map</div>
      <div className={styles.svgContainer}>
        <svg
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="playerGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Sector-colored track outline */}
          {sectorPaths.map((seg, i) => (
            <path key={`s-${i}`} d={seg.d} fill="none" stroke={seg.color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
          ))}

          {/* DRS zones overlay */}
          {drsPaths.map((d, i) => (
            <path key={`drs-${i}`} d={d} fill="none" stroke={DRS_COLOR} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
          ))}

          {/* Yellow flag zones */}
          {yellowZones}

          {/* Car position dots */}
          {positions.map((pos) => {
            const driver = driverMap.get(pos.index);
            const color = driver ? teamColor(driver.teamId) : '#888888';
            const isPlayer = pos.index === playerIndex;
            const r = isPlayer ? 6 : 4;
            const racePos = driver?.position;

            return (
              <g key={pos.index}>
                <circle
                  cx={pos.x}
                  cy={pos.z}
                  r={r}
                  fill={color}
                  filter={isPlayer ? 'url(#playerGlow)' : undefined}
                />
                {racePos != null && (
                  <text
                    x={pos.x + r + 3}
                    y={pos.z + 3}
                    fill="#ffffff"
                    fontSize={8}
                    fontFamily="sans-serif"
                  >
                    {racePos}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
