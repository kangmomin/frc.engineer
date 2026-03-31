import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor, getTeamName } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../constants/tyreCompounds';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { DriverInfo, SessionInfo, WeatherForecast } from '../../types/telemetry';
import { formatLapTime } from '../../utils/formatters';
import styles from './CommentaryDashboard.module.css';

const MAX_ERS_ENERGY = 4_000_000;

interface CommentaryDashboardProps {
  onSwitchToCockpit: () => void;
  remoteAction?: {
    label: string;
    onClick: () => void;
    active?: boolean;
  };
}

// ── Accumulator types ──

interface LapRecord {
  lapNum: number;
  timeMs: number;
}

interface DriverAccState {
  lapHistory: LapRecord[];
  bestSector1Ms: number;
  bestSector2Ms: number;
  bestSector3Ms: number;
  raceTopSpeed: number;
}

interface PrevDriverSnapshot {
  currentLapNum: number;
  lastLapTime: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
}

// ── Accumulator hook ──

function useCommentaryAccumulator(drivers: DriverInfo[], session: SessionInfo | null) {
  const [accMap, setAccMap] = useState<Map<number, DriverAccState>>(() => new Map());
  const prevRef = useRef<Map<number, PrevDriverSnapshot>>(new Map());
  const sessionKeyRef = useRef('');

  // Reset on session change
  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      setAccMap(new Map());
      prevRef.current = new Map();
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  // Process each tick
  useEffect(() => {
    if (drivers.length === 0) return;

    let changed = false;

    setAccMap((prev) => {
      const next = new Map(prev);

      for (const driver of drivers) {
        const idx = driver.index;
        const prevSnap = prevRef.current.get(idx);
        let acc = next.get(idx) ?? {
          lapHistory: [],
          bestSector1Ms: 0,
          bestSector2Ms: 0,
          bestSector3Ms: 0,
          raceTopSpeed: 0,
        };

        let accChanged = false;

        // Lap completion: currentLapNum increased
        if (prevSnap && driver.currentLapNum > prevSnap.currentLapNum && prevSnap.lastLapTime > 0) {
          acc = { ...acc, lapHistory: [...acc.lapHistory, { lapNum: prevSnap.currentLapNum, timeMs: prevSnap.lastLapTime }] };
          accChanged = true;

          // Sector 3 from previous tick data
          if (prevSnap.sector1TimeMs > 0 && prevSnap.sector2TimeMs > 0) {
            const s3 = prevSnap.lastLapTime - prevSnap.sector1TimeMs - prevSnap.sector2TimeMs;
            if (s3 > 0 && (acc.bestSector3Ms === 0 || s3 < acc.bestSector3Ms)) {
              acc = { ...acc, bestSector3Ms: s3 };
            }
          }
        }

        // Best sector 1
        if (driver.sector1TimeMs > 0 && (acc.bestSector1Ms === 0 || driver.sector1TimeMs < acc.bestSector1Ms)) {
          acc = { ...acc, bestSector1Ms: driver.sector1TimeMs };
          accChanged = true;
        }
        // Best sector 2
        if (driver.sector2TimeMs > 0 && (acc.bestSector2Ms === 0 || driver.sector2TimeMs < acc.bestSector2Ms)) {
          acc = { ...acc, bestSector2Ms: driver.sector2TimeMs };
          accChanged = true;
        }

        // Race top speed
        if (driver.topSpeed > acc.raceTopSpeed) {
          acc = { ...acc, raceTopSpeed: driver.topSpeed };
          accChanged = true;
        }

        if (accChanged) {
          next.set(idx, acc);
          changed = true;
        } else if (!next.has(idx)) {
          next.set(idx, acc);
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    // Update prev snapshots
    const nextPrev = new Map<number, PrevDriverSnapshot>();
    for (const driver of drivers) {
      nextPrev.set(driver.index, {
        currentLapNum: driver.currentLapNum,
        lastLapTime: driver.lastLapTime,
        sector1TimeMs: driver.sector1TimeMs,
        sector2TimeMs: driver.sector2TimeMs,
      });
    }
    prevRef.current = nextPrev;
  }, [drivers]);

  return accMap;
}

// ── Main component ──

export function CommentaryDashboard({ onSwitchToCockpit, remoteAction }: CommentaryDashboardProps) {
  const { pitwallState, connectionState, playbackActive } = useTelemetryStore(
    useShallow((s) => ({
      pitwallState: s.pitwallState,
      connectionState: s.connectionState,
      playbackActive: s.playbackActive,
    })),
  );

  const session = pitwallState?.session ?? null;
  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );
  const accMap = useCommentaryAccumulator(drivers, session);

  const isQualifying = /^Q[1-3]$/i.test(session?.sessionType ?? '');
  const safetyCarLabel = getSafetyCarLabel(session?.safetyCar);
  const forecasts = session?.weatherForecast ?? [];

  // Qualifying sector top 10
  const sectorTop10 = useMemo(() => {
    if (!isQualifying) return null;
    const s1: { name: string; time: number }[] = [];
    const s2: { name: string; time: number }[] = [];
    const s3: { name: string; time: number }[] = [];

    for (const driver of drivers) {
      const acc = accMap.get(driver.index);
      if (acc?.bestSector1Ms) s1.push({ name: driver.name, time: acc.bestSector1Ms });
      if (acc?.bestSector2Ms) s2.push({ name: driver.name, time: acc.bestSector2Ms });
      if (acc?.bestSector3Ms) s3.push({ name: driver.name, time: acc.bestSector3Ms });
    }

    s1.sort((a, b) => a.time - b.time);
    s2.sort((a, b) => a.time - b.time);
    s3.sort((a, b) => a.time - b.time);

    return { s1: s1.slice(0, 10), s2: s2.slice(0, 10), s3: s3.slice(0, 10) };
  }, [isQualifying, drivers, accMap]);

  // Soft tire usage count
  const softUsageCount = useMemo(() => {
    if (!isQualifying) return 0;
    let count = 0;
    for (const driver of drivers) {
      const stints = driver.stintHistory ?? [];
      for (const stint of stints) {
        if (stint.compound.toLowerCase() === 'soft') count++;
      }
      if (driver.tireCompound.toLowerCase() === 'soft') {
        const alreadyCounted = stints.length > 0 && stints[stints.length - 1].compound.toLowerCase() === 'soft';
        if (!alreadyCounted) count++;
      }
    }
    return count;
  }, [isQualifying, drivers]);

  // Drivers with penalties
  const penaltyDrivers = useMemo(() => {
    return drivers.filter((d) =>
      d.penalties > 0 || d.numUnservedDriveThroughs > 0 || d.numUnservedStopGoPenalties > 0 || d.totalWarnings > 0,
    );
  }, [drivers]);

  return (
    <div className={styles.commentary}>
      <div className={styles.backdropGlow} />

      {/* Utility dock */}
      <div className={styles.utilityDock}>
        <button type="button" className={styles.dockButton} onClick={onSwitchToCockpit}>
          Cockpit
        </button>
        {remoteAction && (
          <button
            type="button"
            className={`${styles.dockButton} ${remoteAction.active ? styles.dockButtonActive : ''}`}
            onClick={remoteAction.onClick}
          >
            {remoteAction.label}
          </button>
        )}
      </div>

      {/* Top strip */}
      <div className={styles.topStrip}>
        <div className={`${styles.stripCard} ${styles.primary}`}>
          <span className={styles.stripLabel}>Track</span>
          <strong>{session?.trackName ?? 'No Session'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.neutral}`}>
          <span className={styles.stripLabel}>Session</span>
          <strong>{session?.sessionType ?? '--'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.neutral}`}>
          <span className={styles.stripLabel}>Lap</span>
          <strong>
            {drivers[0]?.currentLapNum ?? 0}/{session?.totalLaps ?? '--'}
          </strong>
        </div>
        <div className={`${styles.stripCard} ${styles.tertiary}`}>
          <span className={styles.stripLabel}>Weather</span>
          <strong>{formatWeather(session?.weather)}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.neutral}`}>
          <span className={styles.stripLabel}>Track / Air</span>
          <strong>
            {session ? `${session.trackTemp.toFixed(0)}° / ${session.airTemp.toFixed(0)}°` : '--'}
          </strong>
        </div>
        {safetyCarLabel && (
          <div className={`${styles.stripCard} ${styles.secondary}`}>
            <span className={styles.stripLabel}>Safety Car</span>
            <strong>{safetyCarLabel}</strong>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className={styles.leaderboardWrap}>
        {drivers.length === 0 ? (
          <div className={styles.emptyState}>Waiting for telemetry stream...</div>
        ) : (
          <table className={styles.leaderboard}>
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th>Team</th>
                <th>Fastest</th>
                <th>Tire</th>
                <th>ERS</th>
                <th>Gap</th>
                <th>Int</th>
                <th>Pits</th>
                <th>Pen</th>
                <th>Trap</th>
                <th>Vmax</th>
                <th>Lap Times</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const acc = accMap.get(driver.index);
                const ersPct = Math.round((driver.ersStoreEnergy / MAX_ERS_ENERGY) * 100);
                const intervalMs = driver.deltaToCarInFront ?? 0;
                const isBattle = intervalMs !== 0 && Math.abs(intervalMs) <= 1000;
                const penTotal = driver.penalties + (driver.numUnservedDriveThroughs * 5) + (driver.numUnservedStopGoPenalties * 10);

                return (
                  <tr key={driver.index} className={isBattle ? styles.battleHighlight : undefined}>
                    <td className={styles.posCell}>{String(driver.position).padStart(2, '0')}</td>
                    <td>
                      <span className={styles.driverCell}>
                        <span className={styles.teamStripe} style={{ background: getTeamColor(driver.teamId) }} />
                        {driver.name}
                      </span>
                    </td>
                    <td className={styles.teamCell}>{getTeamName(driver.teamId)}</td>
                    <td className={styles.fastestCell}>{formatLapTime(driver.bestLapTime)}</td>
                    <td>
                      <span className={styles.tyreBadge}>
                        <span className={styles.tyreDot} style={{ background: getTyreColor(driver.tireCompound) }} />
                        {getTyreShortLabel(driver.tireCompound)} {driver.tireAge}L
                      </span>
                    </td>
                    <td className={styles.ersCell}>{ersPct}%</td>
                    <td className={styles.gapCell}>
                      {driver.position === 1 ? 'LEADER' : formatGap(driver.deltaToRaceLeader)}
                    </td>
                    <td className={isBattle ? styles.battleInterval : styles.gapCell}>
                      {driver.position === 1 ? '--' : formatGap(intervalMs)}
                    </td>
                    <td className={styles.pitsCell}>{driver.numPitStops}</td>
                    <td className={styles.penCell}>{penTotal > 0 ? `+${penTotal}s` : '--'}</td>
                    <td className={styles.speedCell}>{driver.topSpeed > 0 ? `${driver.topSpeed}` : '--'}</td>
                    <td className={styles.speedCell}>{(acc?.raceTopSpeed ?? 0) > 0 ? `${acc!.raceTopSpeed}` : '--'}</td>
                    <td className={styles.lapTimesCell}>
                      <div className={styles.lapTimesRow}>
                        {(acc?.lapHistory ?? []).map((lap) => (
                          <span
                            key={lap.lapNum}
                            className={`${styles.lapChip} ${lap.timeMs === driver.bestLapTime ? styles.lapChipBest : ''}`}
                          >
                            L{lap.lapNum} {formatLapTime(lap.timeMs)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom panels */}
      <div className={styles.bottomPanels}>
        {/* Qualifying Sectors */}
        <div className={styles.panel}>
          <div className={styles.panelTitle}>
            {isQualifying ? 'Qualifying Sectors — Top 10' : 'Sector Analysis'}
          </div>
          {sectorTop10 ? (
            <>
              <div className={styles.sectorGrid}>
                <SectorColumn label="S1" entries={sectorTop10.s1} />
                <SectorColumn label="S2" entries={sectorTop10.s2} />
                <SectorColumn label="S3" entries={sectorTop10.s3} />
              </div>
              <div className={styles.softCount}>
                Soft tyres used: <strong>{softUsageCount}</strong> sets
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>Sector data available in qualifying sessions</div>
          )}
        </div>

        {/* Penalties */}
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Penalties &amp; Warnings</div>
          {penaltyDrivers.length === 0 ? (
            <div className={styles.emptyState}>No active penalties</div>
          ) : (
            penaltyDrivers.map((d) => (
              <div key={d.index} className={styles.penaltyRow}>
                <span className={styles.penaltyDriver}>{d.name}</span>
                <span>
                  {d.penalties > 0 && <span className={styles.penaltyDetail}>+{d.penalties}s </span>}
                  {d.numUnservedDriveThroughs > 0 && <span className={styles.penaltyDetail}>DT×{d.numUnservedDriveThroughs} </span>}
                  {d.numUnservedStopGoPenalties > 0 && <span className={styles.penaltyDetail}>SG×{d.numUnservedStopGoPenalties} </span>}
                  {d.totalWarnings > 0 && (
                    <span className={styles.warningBadge}>
                      W{d.totalWarnings}{d.cornerCuttingWarnings > 0 ? ` (TC${d.cornerCuttingWarnings})` : ''}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Weather Forecast */}
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Weather Forecast</div>
          {forecasts.length === 0 ? (
            <div className={styles.emptyState}>No forecast data</div>
          ) : (
            forecasts.slice(0, 8).map((f, i) => (
              <ForecastRow key={i} forecast={f} />
            ))
          )}
        </div>
      </div>

      {/* Connection overlay */}
      {connectionState !== 'connected' && !playbackActive && (
        <div className={styles.emptyState} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 10 }}>
          <strong style={{ color: 'var(--accent)' }}>Waiting for telemetry connection...</strong>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function SectorColumn({ label, entries }: { label: string; entries: { name: string; time: number }[] }) {
  return (
    <div className={styles.sectorColumn}>
      <h4>{label}</h4>
      {entries.map((e, i) => (
        <div key={e.name} className={styles.sectorEntry}>
          <span className={styles.sectorPos}>{i + 1}</span>
          <span className={styles.sectorName}>{e.name}</span>
          <span className={styles.sectorTime}>{formatSectorTime(e.time)}</span>
        </div>
      ))}
      {entries.length === 0 && <span className={styles.emptyState}>--</span>}
    </div>
  );
}

function ForecastRow({ forecast }: { forecast: WeatherForecast }) {
  return (
    <div className={styles.forecastRow}>
      <span className={styles.forecastTime}>+{forecast.timeOffset}m</span>
      <span className={styles.forecastWeather}>{forecast.weather.replace(/_/g, ' ')}</span>
      <span className={styles.forecastTemp}>{forecast.trackTemp.toFixed(0)}°</span>
      <span className={styles.forecastRain}>{forecast.rainPercentage}%</span>
    </div>
  );
}

// ── Helpers ──

function formatGap(ms: number | undefined): string {
  if (!ms) return '--';
  const seconds = Math.abs(ms) / 1000;
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return `+${m}m${s}`;
  }
  return `+${seconds.toFixed(3)}`;
}

function formatSectorTime(ms: number): string {
  if (ms <= 0) return '--';
  return (ms / 1000).toFixed(3);
}

function formatWeather(weather?: string): string {
  if (!weather) return '--';
  return weather.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSafetyCarLabel(safetyCar?: string): string | null {
  if (!safetyCar || safetyCar === 'none') return null;
  if (safetyCar === 'full') return 'SC';
  if (safetyCar === 'virtual') return 'VSC';
  if (safetyCar === 'formation') return 'Formation';
  return safetyCar.toUpperCase();
}
