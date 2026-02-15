import { useMemo } from 'react';
import type {
  SessionInfo,
  CarPosition,
  DriverInfo,
  TrackMapData,
  MarshalZone,
  RaceControlNotification,
} from '../../../types/telemetry';
import { getTeamColor } from '../../../constants/teamColors';
import { SectionHeader } from '../shared/SectionHeader';
import styles from './TrackMapSection.module.css';

interface TrackMapSectionProps {
  session: SessionInfo | null;
  positions: CarPosition[];
  drivers: DriverInfo[];
  trackMap?: TrackMapData;
  playerIndex: number;
}

export function TrackMapSection({
  session,
  positions,
  drivers,
  trackMap,
  playerIndex,
}: TrackMapSectionProps) {
  return (
    <div className={styles.container}>
      <SectionHeader
        title={session?.trackName ?? 'Track'}
        subtitle={session?.sessionType ?? 'No Session'}
      />

      <div className={styles.content}>
        {/* Track Canvas */}
        <div className={styles.trackArea}>
          <TrackCanvas
            positions={positions}
            drivers={drivers}
            trackMap={trackMap}
            playerIndex={playerIndex}
            marshalZones={session?.marshalZones}
          />
        </div>

        {/* Track Footer Info */}
        <div className={styles.trackFooter}>
          <TrackFooter session={session} />
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

/** Map marshal zone flag number to color */
const FLAG_COLORS: Record<number, string> = {
  1: '#2ecc71', // green
  2: '#3498db', // blue
  3: '#f1c40f', // yellow
  4: '#e74c3c', // red
};

interface TrackCanvasProps {
  positions: CarPosition[];
  drivers: DriverInfo[];
  trackMap?: TrackMapData;
  playerIndex: number;
  marshalZones?: MarshalZone[];
}

function TrackCanvas({ positions, drivers, trackMap, playerIndex, marshalZones }: TrackCanvasProps) {
  const driverMap = useMemo(() => {
    const map = new Map<number, DriverInfo>();
    drivers.forEach((d) => map.set(d.index, d));
    return map;
  }, [drivers]);

  // Calculate viewport and transform
  const viewBox = useMemo(() => {
    if (!trackMap) return '0 0 100 100';
    const padding = 50;
    const width = trackMap.maxX - trackMap.minX + padding * 2;
    const height = trackMap.maxZ - trackMap.minZ + padding * 2;
    return `${trackMap.minX - padding} ${trackMap.minZ - padding} ${width} ${height}`;
  }, [trackMap]);

  // Generate sector paths and midpoints for labels
  const sectorData = useMemo(() => {
    if (!trackMap || trackMap.points.length < 2) return [];
    const pts = trackMap.points;

    // Collect points per sector
    const sectorPoints: Map<number, { x: number; z: number }[]> = new Map();
    for (const pt of pts) {
      if (!sectorPoints.has(pt.sector)) sectorPoints.set(pt.sector, []);
      sectorPoints.get(pt.sector)!.push({ x: pt.x, z: pt.z });
    }

    // Build path and midpoint per sector
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

  // Determine highest-priority flag per sector from marshal zones
  const sectorFlags = useMemo(() => {
    const flags: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    if (!marshalZones || !trackMap || trackMap.points.length === 0) return flags;

    const totalPts = trackMap.points.length;
    for (const mz of marshalZones) {
      if (mz.flag <= 0) continue; // -1=invalid, 0=none
      const ptIdx = Math.min(Math.floor(mz.start * totalPts), totalPts - 1);
      const sector = trackMap.points[ptIdx].sector;
      // Keep highest flag per sector (4=red > 3=yellow > 2=blue > 1=green)
      if (mz.flag > flags[sector]) flags[sector] = mz.flag;
    }
    return flags;
  }, [marshalZones, trackMap]);

  // Full track path for the background outline
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

  if (!trackMap || trackMap.points.length === 0) {
    return (
      <div className={styles.noTrack}>
        <span>No track data available</span>
      </div>
    );
  }

  return (
    <svg viewBox={viewBox} className={styles.trackSvg} preserveAspectRatio="xMidYMid meet">
      {/* Track outline background */}
      <path
        d={trackPath}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sector paths: neutral by default, colored when flagged */}
      {sectorData.map((s, i) => {
        const flag = sectorFlags[s.sector] ?? 0;
        const color = flag > 0 ? (FLAG_COLORS[flag] ?? 'rgba(255,255,255,0.5)') : 'rgba(255,255,255,0.5)';
        return (
          <path
            key={i}
            d={s.path}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Sector labels */}
      {sectorData.map((s) => (
        <text
          key={`label-${s.sector}`}
          x={s.midX}
          y={s.midZ}
          textAnchor="middle"
          dominantBaseline="central"
          fill="rgba(255,255,255,0.6)"
          fontSize="16"
          fontWeight="700"
          fontFamily="var(--font-racing)"
        >
          S{s.sector + 1}
        </text>
      ))}

      {/* Car positions */}
      {positions.map((pos) => {
        const driver = driverMap.get(pos.index);
        if (!driver) return null;
        const color = getTeamColor(driver.teamId);
        const isPlayer = pos.index === playerIndex;

        return (
          <g key={pos.index}>
            {isPlayer && (
              <circle
                cx={pos.x}
                cy={pos.z}
                r={22}
                fill="none"
                stroke="#00FF00"
                strokeWidth={2}
                opacity="0.4"
              />
            )}
            <circle
              cx={pos.x}
              cy={pos.z}
              r={isPlayer ? 16 : 12}
              fill={color}
              stroke={isPlayer ? '#00FF00' : 'white'}
              strokeWidth={isPlayer ? 4 : 2}
              opacity="0.9"
            />
            <text
              x={pos.x}
              y={pos.z + (isPlayer ? 4 : 3.5)}
              textAnchor="middle"
              fill="white"
              fontSize={isPlayer ? 13 : 11}
              fontWeight="bold"
              fontFamily="var(--font-racing)"
            >
              {driver.position}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface WeatherTimelineProps {
  forecasts: SessionInfo['weatherForecast'];
}

// Exported for use in PaceAnalysisSection
export function WeatherTimeline({ forecasts }: WeatherTimelineProps) {
  if (!forecasts || forecasts.length === 0) {
    return <div className={styles.noForecast}>No forecast data</div>;
  }

  // Show all available forecasts (F1 provides up to 56 samples at 5-min intervals)
  // Group by significant time intervals: Now, +5, +10, +15, +20, +30, +45, +60m...
  const displayForecasts = forecasts;

  return (
    <div className={styles.forecastList}>
      {displayForecasts.map((fc, idx) => {
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
      {notifications.slice(0, 5).map((n) => (
        <div
          key={n.id}
          className={`${styles.notification} ${styles[n.severity]}`}
        >
          <span className={styles.notificationTime}>
            {formatTime(n.timestamp)}
          </span>
          <span className={styles.notificationMessage}>{n.message}</span>
        </div>
      ))}
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
  session: SessionInfo | null;
}

function TrackFooter({ session }: TrackFooterProps) {
  if (!session) return null;

  return (
    <div className={styles.footerGrid}>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Track</span>
        <span className={styles.footerValue}>{session.trackTemp}°C</span>
      </div>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Air</span>
        <span className={styles.footerValue}>{session.airTemp}°C</span>
      </div>
      <div className={styles.footerItem}>
        <span className={styles.footerLabel}>Length</span>
        <span className={styles.footerValue}>{(session.trackLength / 1000).toFixed(2)}km</span>
      </div>
    </div>
  );
}
