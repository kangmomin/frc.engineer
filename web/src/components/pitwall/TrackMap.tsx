import { useMemo } from 'react';
import type { CarPosition, DriverInfo } from '../../types/telemetry';
import styles from './TrackMap.module.css';

interface TrackMapProps {
  positions: CarPosition[];
  drivers: DriverInfo[];
  playerIndex: number;
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

const PADDING = 50;

export function TrackMap({ positions, drivers, playerIndex }: TrackMapProps) {
  const driverMap = useMemo(() => {
    const map = new Map<number, DriverInfo>();
    for (const d of drivers) {
      map.set(d.index, d);
    }
    return map;
  }, [drivers]);

  // Filter out inactive cars sitting at origin (0,0,0)
  const activePositions = useMemo(
    () => positions.filter((p) => p.x !== 0 || p.z !== 0),
    [positions],
  );

  const viewBox = useMemo(() => {
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
  }, [activePositions]);

  if (activePositions.length === 0 || !viewBox) {
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
          {/* Player glow filter */}
          <defs>
            <filter id="playerGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

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
