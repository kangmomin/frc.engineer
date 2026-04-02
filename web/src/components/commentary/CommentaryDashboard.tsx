import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor } from '../../constants/teamColors';
import { getTyreColor, getWearStatusColor } from '../../constants/tyreCompounds';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { DriverInfo, SessionInfo, WeatherForecast } from '../../types/telemetry';
import { formatDelta, formatLapTime } from '../../utils/formatters';
import styles from './CommentaryDashboard.module.css';

const MAX_ERS_ENERGY = 4_000_000;
const SECTOR_LABELS = ['S1', 'S2', 'S3'] as const;
type SectorBestTimes = [number, number, number];
type SectorDeltaTone = 'sectorPending' | 'sectorBest' | 'sectorGood' | 'sectorSlow';

interface CommentaryDashboardProps {
  onSwitchToCockpit: () => void;
  onSwitchToQualifying?: () => void;
  onGoHome?: () => void;
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
  prevLapSector1Ms: number;
  prevLapSector2Ms: number;
  prevLapSector3Ms: number;
  lastS3Ms: number; // most recent completed S3 (current or previous lap)
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
  const trackKeyRef = useRef('');

  // Reset on session change — preserve topSpeed across sessions on same track
  const trackKey = `${session?.trackId ?? ''}`;
  const sessionKey = `${trackKey}|${session?.sessionType ?? ''}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      const trackChanged = trackKeyRef.current !== trackKey;
      if (trackChanged) {
        setAccMap(new Map());
      } else {
        // Same track, different session (Q→Race): keep topSpeed, reset the rest
        setAccMap((prev) => {
          const next = new Map<number, DriverAccState>();
          for (const [idx, acc] of prev) {
            next.set(idx, {
              lapHistory: [],
              bestSector1Ms: 0,
              bestSector2Ms: 0,
              bestSector3Ms: 0,
              raceTopSpeed: acc.raceTopSpeed,
              prevLapSector1Ms: 0,
              prevLapSector2Ms: 0,
              prevLapSector3Ms: 0,
              lastS3Ms: 0,
            });
          }
          return next;
        });
      }
      prevRef.current = new Map();
    }
    sessionKeyRef.current = sessionKey;
    trackKeyRef.current = trackKey;
  }, [sessionKey, trackKey]);

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
          prevLapSector1Ms: 0,
          prevLapSector2Ms: 0,
          prevLapSector3Ms: 0,
          lastS3Ms: 0,
        };

        let accChanged = false;

        // Lap completion: currentLapNum increased
        if (prevSnap && driver.currentLapNum > prevSnap.currentLapNum && prevSnap.lastLapTime > 0) {
          const prevS3 = (prevSnap.sector1TimeMs > 0 && prevSnap.sector2TimeMs > 0)
            ? prevSnap.lastLapTime - prevSnap.sector1TimeMs - prevSnap.sector2TimeMs
            : 0;
          acc = {
            ...acc,
            lapHistory: [...acc.lapHistory, { lapNum: prevSnap.currentLapNum, timeMs: prevSnap.lastLapTime }],
            prevLapSector1Ms: prevSnap.sector1TimeMs,
            prevLapSector2Ms: prevSnap.sector2TimeMs,
            prevLapSector3Ms: prevS3 > 0 ? prevS3 : acc.prevLapSector3Ms,
            lastS3Ms: prevS3 > 0 ? prevS3 : acc.lastS3Ms,
          };
          accChanged = true;

          // Best sector 3
          if (prevS3 > 0 && (acc.bestSector3Ms === 0 || prevS3 < acc.bestSector3Ms)) {
            acc = { ...acc, bestSector3Ms: prevS3 };
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

export function CommentaryDashboard({ onSwitchToCockpit, onSwitchToQualifying, onGoHome, remoteAction }: CommentaryDashboardProps) {
  const { pitwallState, connectionState, playbackActive } = useTelemetryStore(
    useShallow((s) => ({
      pitwallState: s.pitwallState,
      connectionState: s.connectionState,
      playbackActive: s.playbackActive,
    })),
  );

  const session = pitwallState?.session ?? null;
  const playerIndex = pitwallState?.playerIndex ?? -1;
  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );
  const player = useMemo(() => drivers.find((d) => d.index === playerIndex) ?? null, [drivers, playerIndex]);
  const accMap = useCommentaryAccumulator(drivers, session);

  const isQualifying = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i.test(session?.sessionType ?? '');
  const safetyCarLabel = getSafetyCarLabel(session?.safetyCar);
  const forecasts = session?.weatherForecast ?? [];
  const sectorBestTimes = useMemo(() => getSectorBestTimes(drivers), [drivers]);


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
        {onGoHome && (
          <button type="button" className={styles.dockButton} onClick={onGoHome}>
            Home
          </button>
        )}
        <button type="button" className={styles.dockButton} onClick={onSwitchToCockpit}>
          Cockpit
        </button>
        {onSwitchToQualifying && (
          <button type="button" className={styles.dockButton} onClick={onSwitchToQualifying}>
            Quali
          </button>
        )}
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
        <div className={`${styles.stripCard} ${styles.stripNeutral}`}>
          <span className={styles.stripLabel}>Session</span>
          <strong>{session?.sessionType ?? '--'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.stripNeutral}`}>
          <span className={styles.stripLabel}>{isQualifying ? 'Time' : 'Lap'}</span>
          <strong>
            {isQualifying
              ? formatSessionTimeLeft(session?.sessionTimeLeft, session?.sessionDuration)
              : `${drivers[0]?.currentLapNum ?? 0}/${session?.totalLaps ?? '--'}`}
          </strong>
        </div>
        <div className={`${styles.stripCard} ${styles.tertiary}`}>
          <span className={styles.stripLabel}>Weather</span>
          <strong>{formatWeather(session?.weather)}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.stripNeutral}`}>
          <span className={styles.stripLabel}>Track / Air</span>
          <strong>
            {session ? `${session.trackTemp.toFixed(0)}° / ${session.airTemp.toFixed(0)}°` : '--'}
          </strong>
        </div>
        <div className={styles.stripCard}>
          <span className={styles.stripLabel}>Sector</span>
          <strong className={styles.trackStatusRow}>
            <span style={getSectorFlagColor(session?.marshalZones, 1)}>S1</span>
            <span style={getSectorFlagColor(session?.marshalZones, 2)}>S2</span>
            <span style={getSectorFlagColor(session?.marshalZones, 3)}>S3</span>
          </strong>
        </div>
        <div className={`${styles.stripCard} ${styles.secondary}`}>
          <span className={styles.stripLabel}>Status</span>
          <strong className={styles.scBadge}>
            {safetyCarLabel ?? 'CLR'}
          </strong>
        </div>
      </div>

      {/* Leaderboard */}
      <div className={styles.leaderboardWrap}>
        {drivers.length === 0 ? (
          <div className={styles.emptyState}>Waiting for telemetry stream...</div>
        ) : (
          <table className={styles.leaderboard}>
            <colgroup>
              <col style={{ width: 36 }} />   {/* Pos */}
              <col style={{ width: 110 }} />  {/* Driver */}
              <col style={{ width: 80 }} />   {/* Fastest */}
              <col style={{ width: 44 }} />   {/* Status */}
              <col style={{ width: 150 }} />  {/* Sector */}
              <col style={{ width: 60 }} />   {/* Tire */}
              <col style={{ width: 40 }} />   {/* Wear */}
              <col style={{ width: 48 }} />   {/* Life */}
              <col style={{ width: 40 }} />   {/* ERS */}
              <col style={{ width: 68 }} />   {/* Gap */}
              <col style={{ width: 64 }} />   {/* Int */}
              <col style={{ width: 40 }} />   {/* Pen */}
              <col />                         {/* Lap Times — fills remaining */}
              <col style={{ width: 32 }} />   {/* Pits */}
              <col style={{ width: 40 }} />   {/* Trap */}
              <col style={{ width: 40 }} />   {/* Vmax */}
            </colgroup>
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th>Fastest</th>
                <th>Status</th>
                <th>Sector</th>
                <th>Tire</th>
                <th>Wear</th>
                <th>Life</th>
                <th>ERS</th>
                <th>Gap</th>
                <th>Int</th>
                <th>Pen</th>
                <th>Lap Times</th>
                <th>Pits</th>
                <th>Trap</th>
                <th>Vmax</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const acc = accMap.get(driver.index);
                const ersPct = driver.ersActualReady ? driver.ersActualPct : Math.round((driver.ersStoreEnergy / MAX_ERS_ENERGY) * 100);
                const intervalMs = driver.deltaToCarInFront ?? 0;
                const isBattle = intervalMs !== 0 && Math.abs(intervalMs) <= 1000;
                const penTotal = driver.penalties + (driver.numUnservedDriveThroughs * 5) + (driver.numUnservedStopGoPenalties * 10);
                const isOut = driver.resultStatus >= 4; // 4=DNF, 5=DSQ, 6=not classified, 7=retired
                const isPlayer = driver.index === playerIndex;
                const isTeammate = !isPlayer && player != null && driver.teamId === player.teamId;
                const rowClass = [
                  isBattle ? styles.battleHighlight : '',
                  isOut ? styles.driverOut : '',
                  isPlayer ? styles.playerRow : '',
                  isTeammate ? styles.teammateRow : '',
                ].filter(Boolean).join(' ');

                return (
                  <tr key={driver.index} className={rowClass}>
                    <td className={styles.posCell}>{String(driver.position).padStart(2, '0')}</td>
                    <td className={styles.driverCell}>
                      <span className={styles.teamBar} style={{ background: getTeamColor(driver.teamId) }} />
                      {driver.name}
                    </td>
                    <td className={styles.fastestCell}>{formatLapTime(driver.bestLapTime)}</td>
                    <td className={styles.statusCell}>
                      <span className={driver.driverStatus === 1 ? styles.statusFlying : ''}>
                        {getDriverStatusLabel(driver.driverStatus)}
                      </span>
                    </td>
                    <td>
                      <SectorDeltaCell driver={driver} sectorBestTimes={sectorBestTimes} />
                    </td>
                    <td>
                      <span className={styles.tyreBadge}>
                        {(driver.stintHistory ?? []).map((stint, si) => (
                          <span key={si} className={styles.stintDot} style={{ background: getTyreColor(stint.compound) }} title={`${stint.compound} ${stint.laps}L`} />
                        ))}
                        <span className={styles.tyreDot} style={{ background: getTyreColor(driver.tireCompound) }} />
                        {driver.tireAge}
                      </span>
                    </td>
                    <td className={styles.wearCell} style={driver.tyreSetWear != null ? { color: getWearStatusColor(driver.tyreSetWear) } : undefined}>
                      {driver.tyreSetWear != null ? `${driver.tyreSetWear}%` : '--'}
                    </td>
                    <td className={styles.lifeCell}>
                      {driver.tyreLifeSpan != null && driver.tyreUsableLife != null
                        ? `${driver.tyreLifeSpan}/${driver.tyreUsableLife}`
                        : '--'}
                    </td>
                    <td className={styles.ersCell}>{ersPct}%</td>
                    <td className={styles.gapCell}>
                      {driver.position === 1 ? 'LEADER' : formatGap(driver.deltaToRaceLeader)}
                    </td>
                    <td className={isBattle ? styles.battleInterval : styles.gapCell}>
                      {driver.position === 1 ? '--' : formatGap(intervalMs)}
                    </td>
                    <td className={styles.penCell}>{penTotal > 0 ? `+${penTotal}s` : '--'}</td>
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
                    <td className={styles.pitsCell}>{driver.numPitStops}</td>
                    <td className={styles.speedCell}>{driver.topSpeed > 0 ? `${driver.topSpeed}` : '--'}</td>
                    <td className={styles.speedCell}>{(acc?.raceTopSpeed ?? 0) > 0 ? `${acc!.raceTopSpeed}` : '--'}</td>
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

// ── Driver Status Badge ──

function getDriverStatusLabel(status: number): string {
  switch (status) {
    case 0: return 'GAR';
    case 1: return 'FLY';
    case 2: return 'IN';
    case 3: return 'OUT';
    case 4: return 'TRK';
    default: return '--';
  }
}

function SectorDeltaCell({ driver, sectorBestTimes }: { driver: DriverInfo; sectorBestTimes: SectorBestTimes }) {
  const sectorTimes = getDriverSectorTimes(driver);

  return (
    <span className={styles.sectorCell}>
      {SECTOR_LABELS.map((label, index) => {
        const sectorTime = sectorTimes[index];
        const bestTime = sectorBestTimes[index];
        const delta = sectorTime > 0 && bestTime > 0 ? sectorTime - bestTime : null;
        const title = sectorTime > 0 ? `${label} ${formatLapTime(sectorTime)}` : `${label} pending`;

        return (
          <span
            key={label}
            className={`${styles.sectorChip} ${styles[getSectorDeltaTone(delta)]}`}
            title={title}
          >
            <span className={styles.sectorChipLabel}>{label}</span>
            <span className={styles.sectorChipValue}>{formatSectorDelta(delta)}</span>
          </span>
        );
      })}
    </span>
  );
}

function formatSessionTimeLeft(seconds?: number, duration?: number): string {
  const value = (seconds != null && seconds > 0) ? seconds : duration;
  if (value == null || value <= 0) return '--:--';
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function normalizeSectorTime(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  return Math.round(value);
}

function getDriverSector3TimeMs(driver: DriverInfo): number {
  const lapTime = Math.round(driver.lastLapTime ?? 0);
  const sector1 = normalizeSectorTime(driver.sector1TimeMs);
  const sector2 = normalizeSectorTime(driver.sector2TimeMs);
  if (lapTime <= 0 || sector1 <= 0 || sector2 <= 0) return 0;
  const sector3 = lapTime - sector1 - sector2;
  if (sector3 <= 0 || sector3 >= lapTime) return 0;
  return sector3;
}

function getDriverSectorTimes(driver: DriverInfo): SectorBestTimes {
  return [
    normalizeSectorTime(driver.sector1TimeMs),
    normalizeSectorTime(driver.sector2TimeMs),
    getDriverSector3TimeMs(driver),
  ];
}

function getSectorBestTimes(drivers: DriverInfo[]): SectorBestTimes {
  const bestTimes: SectorBestTimes = [0, 0, 0];
  for (const driver of drivers) {
    const sectorTimes = getDriverSectorTimes(driver);
    sectorTimes.forEach((sectorTime, index) => {
      if (sectorTime <= 0) return;
      if (bestTimes[index] === 0 || sectorTime < bestTimes[index]) {
        bestTimes[index] = sectorTime;
      }
    });
  }
  return bestTimes;
}

function formatSectorDelta(deltaMs: number | null): string {
  if (deltaMs == null) return '--';
  return formatDelta(deltaMs);
}

function getSectorDeltaTone(deltaMs: number | null): SectorDeltaTone {
  if (deltaMs == null) return 'sectorPending';
  if (deltaMs <= 0) return 'sectorBest';
  if (deltaMs <= 250) return 'sectorGood';
  return 'sectorSlow';
}

// ── Track Status ──

const SECTOR_FLAG_COLORS: Record<number, string> = {
  1: '#22c55e', 2: '#3b82f6', 3: '#eab308', 4: '#ef4444',
};

function getSectorFlagColor(zones: { start: number; flag: number }[] | undefined, sector: number): React.CSSProperties | undefined {
  if (!zones) return undefined;
  const lo = (sector - 1) / 3;
  const hi = sector / 3;
  for (const z of zones) {
    if (z.start >= lo && z.start < hi && z.flag >= 1) {
      return { color: SECTOR_FLAG_COLORS[z.flag] };
    }
  }
  return undefined;
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
