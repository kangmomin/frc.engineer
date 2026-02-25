import { useEffect, useMemo, useRef, useState } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { getTeamName } from '../../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import { SectionHeader } from '../shared/SectionHeader';
import { TyreIcon } from '../shared/TyreIcon';
import { TeamColorBar } from '../shared/TeamColorBar';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './LeaderboardSection.module.css';

const EMPTY_DRIVERS: DriverInfo[] = [];
const WING_GONE_THRESHOLD = 75;
const DEFAULT_PACE_WINDOW_LAPS = 3;
const MIN_PACE_WINDOW_LAPS = 1;
const MAX_PACE_WINDOW_LAPS = 20;
const MAX_DELTA_HISTORY_LAPS = 80;
const PACE_NEUTRAL_THRESHOLD_MS = 50;

interface DriverDeltaSnapshot {
  lapNumber: number;
  deltaToLeaderMs: number;
}

interface PaceDeltaResult {
  deltaMs: number | null;
  lapsUsed: number;
  estimated: boolean;
}

function normalizeDeltaToLeader(driver: DriverInfo): number | null {
  if (driver.position === 1) return 0;
  if (driver.deltaToRaceLeader === undefined || driver.deltaToRaceLeader === null) return null;
  if (!Number.isFinite(driver.deltaToRaceLeader) || driver.deltaToRaceLeader < 0) return null;
  return driver.deltaToRaceLeader;
}

function useDriverDeltaHistory(drivers: DriverInfo[], maxEntries: number = MAX_DELTA_HISTORY_LAPS) {
  const [historyByDriver, setHistoryByDriver] = useState<Record<number, DriverDeltaSnapshot[]>>({});
  const lastLapByDriverRef = useRef<Record<number, number>>({});

  useEffect(() => {
    if (drivers.length === 0) {
      setHistoryByDriver({});
      lastLapByDriverRef.current = {};
      return;
    }

    setHistoryByDriver((prev) => {
      let changed = false;
      const next: Record<number, DriverDeltaSnapshot[]> = { ...prev };
      const activeDriverIds = new Set(drivers.map((driver) => driver.index));

      for (const key of Object.keys(next)) {
        const driverIndex = Number(key);
        if (!activeDriverIds.has(driverIndex)) {
          delete next[driverIndex];
          delete lastLapByDriverRef.current[driverIndex];
          changed = true;
        }
      }

      for (const driver of drivers) {
        const deltaToLeaderMs = normalizeDeltaToLeader(driver);
        if (deltaToLeaderMs === null) continue;

        const lapNumber = driver.currentLapNum;
        const previousLap = lastLapByDriverRef.current[driver.index];
        const snapshots = next[driver.index] ?? [];
        const snapshot: DriverDeltaSnapshot = { lapNumber, deltaToLeaderMs };

        if (previousLap === undefined || lapNumber < previousLap) {
          if (previousLap !== undefined && previousLap-lapNumber <= 1) {
            // Ignore one-lap transient jitter around line-crossing packets.
            continue;
          }
          lastLapByDriverRef.current[driver.index] = lapNumber;
          next[driver.index] = [snapshot];
          changed = true;
          continue;
        }

        if (lapNumber > previousLap) {
          lastLapByDriverRef.current[driver.index] = lapNumber;
          const appended = [...snapshots, snapshot];
          next[driver.index] =
            appended.length > maxEntries ? appended.slice(-maxEntries) : appended;
          changed = true;
          continue;
        }

        if (snapshots.length === 0) {
          next[driver.index] = [snapshot];
          changed = true;
          continue;
        }

        const lastSnapshot = snapshots[snapshots.length - 1];
        if (lastSnapshot && lastSnapshot.lapNumber === lapNumber && lastSnapshot.deltaToLeaderMs !== deltaToLeaderMs) {
          const updated = [...snapshots];
          updated[updated.length - 1] = snapshot;
          next[driver.index] = updated;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [drivers, maxEntries]);

  return historyByDriver;
}

export function LeaderboardSection() {
  const drivers = useTelemetryStore((state) => state.pitwallState?.drivers ?? EMPTY_DRIVERS);
  const session = useTelemetryStore((state) => state.pitwallState?.session ?? null);
  const playerIndex = useTelemetryStore((state) => state.pitwallState?.playerIndex ?? 0);
  const [paceWindowInput, setPaceWindowInput] = useState<string>(String(DEFAULT_PACE_WINDOW_LAPS));

  const paceWindowLaps = useMemo(
    () => parsePaceWindowLaps(paceWindowInput),
    [paceWindowInput],
  );

  const deltaHistoryByDriver = useDriverDeltaHistory(drivers);

  // Sort drivers by position
  const sortedDrivers = useMemo(() => {
    return [...drivers].sort((a, b) => a.position - b.position);
  }, [drivers]);

  const leader = sortedDrivers[0];

  const paceDeltaByDriver = useMemo(() => {
    const paceMap: Record<number, PaceDeltaResult> = {};
    const leaderLastLapTime = sortedDrivers[0]?.lastLapTime ?? 0;
    for (const driver of sortedDrivers) {
      paceMap[driver.index] = calculatePaceDelta(
        deltaHistoryByDriver[driver.index],
        paceWindowLaps,
        driver.lastLapTime,
        leaderLastLapTime,
        driver.position === 1,
      );
    }
    return paceMap;
  }, [sortedDrivers, deltaHistoryByDriver, paceWindowLaps]);

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Leaderboard"
        subtitle={session ? `Lap ${leader?.currentLapNum ?? 0}/${session.totalLaps}` : undefined}
        rightContent={(
          <label className={styles.paceInputWrap}>
            <span className={styles.paceInputLabel}>Pace Laps</span>
            <input
              className={styles.paceInput}
              type="number"
              min={MIN_PACE_WINDOW_LAPS}
              max={MAX_PACE_WINDOW_LAPS}
              step={1}
              value={paceWindowInput}
              onChange={(e) => setPaceWindowInput(e.target.value)}
              onBlur={() => setPaceWindowInput(String(parsePaceWindowLaps(paceWindowInput)))}
              aria-label="Lap window for pace comparison"
            />
          </label>
        )}
      />

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colPos}>P</th>
              <th className={styles.colDriver}>Driver</th>
              <th className={styles.colGap}>Gap</th>
              <th className={styles.colTyre}>Tyre</th>
              <th className={styles.colPits}>Stints</th>
              <th className={styles.colLap}>Last</th>
              <th className={styles.colSector}>S1</th>
              <th className={styles.colSector}>S2</th>
              <th className={styles.colSector}>S3</th>
              <th className={styles.colPace}>{`Delta ${paceWindowLaps}L`}</th>
            </tr>
          </thead>
          <tbody>
            {sortedDrivers.map((driver, idx) => {
              const isPlayer = driver.index === playerIndex;
              const gap = idx === 0 ? 'LEADER' : formatGapToLeader(driver.deltaToRaceLeader);
              const paceDelta = paceDeltaByDriver[driver.index] ?? { deltaMs: null, lapsUsed: 0, estimated: false };
              const damageAlert = getDamageAlertInfo(driver, isPlayer);

              return (
                <tr
                  key={driver.index}
                  className={`${styles.row} ${isPlayer ? styles.playerRow : ''}`}
                >
                  <td className={styles.colPos}>
                    <span className={styles.position}>{driver.position}</span>
                  </td>
                  <td className={styles.colDriver}>
                    <div className={styles.driverCell}>
                      <TeamColorBar teamId={driver.teamId} position="left" />
                      <div className={isPlayer ? styles.playerDriverInfo : styles.driverInfo}>
                        <div className={styles.nameRow}>
                          <span className={isPlayer ? styles.playerFullName : styles.fullName}>
                            {driver.name?.trim() || `P${driver.index}`}
                          </span>
                          {damageAlert.showAlert && (
                            <span
                              className={styles.damageAlert}
                              style={{
                                backgroundColor: damageAlert.alertColor,
                                color: damageAlert.alertTextColor,
                              }}
                              title="Damage detected"
                              aria-label="Damage detected"
                            >
                              !
                            </span>
                          )}
                          {damageAlert.showWingGone && (
                            <span
                              className={styles.wingAlert}
                              style={{
                                backgroundColor: damageAlert.wingColor,
                                color: damageAlert.wingTextColor,
                              }}
                              title="Wing damage"
                              aria-label="Wing damage"
                            >
                              W
                            </span>
                          )}
                        </div>
                        <span className={isPlayer ? styles.playerTeamName : styles.teamName}>
                          {getTeamName(driver.teamId)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={styles.colGap}>
                    <div className={styles.gapCell}>
                      <span className={styles.gap}>{gap}</span>
                      {driver.deltaToCarInFront != null && driver.deltaToCarInFront > 0 && driver.deltaToCarInFront <= 1000 && (
                        <span className={styles.drsBadge}>DRS</span>
                      )}
                    </div>
                  </td>
                  <td className={styles.colTyre}>
                    <TyreIcon
                      compound={driver.tireCompound}
                      age={driver.tireAge}
                      size="small"
                    />
                  </td>
                  <td className={styles.colPits}>
                    <div className={styles.stintLog}>
                      {buildStintLog(driver).map((compound, idx) => (
                        <span
                          key={idx}
                          className={styles.stintDot}
                          style={{ color: getTyreColor(compound) }}
                        >
                          {getTyreShortLabel(compound)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={styles.colLap}>
                    <span className={styles.lapTime}>
                      {formatLapTime(driver.lastLapTime)}
                    </span>
                  </td>
                  <td className={styles.colSector}>
                    <span className={styles.sector}>
                      {driver.sector1TimeMs > 0 ? formatSectorTime(driver.sector1TimeMs) : '--'}
                    </span>
                  </td>
                  <td className={styles.colSector}>
                    <span className={styles.sector}>
                      {driver.sector2TimeMs > 0 ? formatSectorTime(driver.sector2TimeMs) : '--'}
                    </span>
                  </td>
                  <td className={styles.colSector}>
                    <span className={styles.sector}>
                      {formatSector3Time(driver)}
                    </span>
                  </td>
                  <td className={styles.colPace}>
                    <span className={`${styles.paceValue} ${getPaceClassName(paceDelta.deltaMs)}`}>
                      {formatPaceDelta(paceDelta, paceWindowLaps)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildStintLog(driver: DriverInfo): string[] {
  const compounds: string[] = [];
  if (driver.stintHistory) {
    for (const stint of driver.stintHistory) {
      compounds.push(stint.compound);
    }
  }
  if (driver.tireCompound && driver.tireCompound !== 'unknown') {
    compounds.push(driver.tireCompound);
  }
  return compounds;
}

interface DamageAlertInfo {
  showAlert: boolean;
  alertColor: string;
  alertTextColor: string;
  showWingGone: boolean;
  wingColor: string;
  wingTextColor: string;
}

function getDamageAlertInfo(driver: DriverInfo, isPlayer: boolean): DamageAlertInfo {
  const none: DamageAlertInfo = {
    showAlert: false,
    alertColor: '#ffbf1f',
    alertTextColor: '#111',
    showWingGone: false,
    wingColor: '#ffbf1f',
    wingTextColor: '#111',
  };

  // Per request, only show markers for other cars.
  if (isPlayer || !driver.damage) {
    return none;
  }

  const {
    frontLeftWing,
    frontRightWing,
    rearWing,
    floor,
    diffuser,
    sidepod,
    engine,
    gearbox,
    drsFault,
    ersFault,
  } = driver.damage;

  const maxDamage = Math.max(
    frontLeftWing,
    frontRightWing,
    rearWing,
    floor,
    diffuser,
    sidepod,
    engine,
    gearbox
  );
  const wingDamage = Math.max(frontLeftWing, frontRightWing, rearWing);
  const hasAnyDamage = maxDamage > 0 || drsFault || ersFault;

  if (!hasAnyDamage) {
    return none;
  }

  // Faults are treated as highly severe even if percentage damage is low.
  const alertSeverity = Math.max(maxDamage, drsFault || ersFault ? 90 : 0);
  const showWingGone = wingDamage >= WING_GONE_THRESHOLD;

  return {
    showAlert: true,
    alertColor: damageToHeatColor(alertSeverity),
    alertTextColor: alertSeverity >= 60 ? '#fff' : '#111',
    showWingGone,
    wingColor: damageToHeatColor(wingDamage),
    wingTextColor: wingDamage >= 60 ? '#fff' : '#111',
  };
}

function damageToHeatColor(value: number): string {
  // 0% -> yellow, 100% -> red
  const t = clamp01(value / 100);
  const start = { r: 255, g: 191, b: 31 }; // #ffbf1f
  const end = { r: 255, g: 59, b: 48 }; // #ff3b30
  const r = Math.round(start.r + (end.r - start.r) * t);
  const g = Math.round(start.g + (end.g - start.g) * t);
  const b = Math.round(start.b + (end.b - start.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function formatSectorTime(ms: number): string {
  const seconds = ms / 1000;
  return seconds.toFixed(3);
}

function formatSector3Time(driver: DriverInfo): string {
  if (driver.lastLapTime <= 0 || driver.sector1TimeMs <= 0 || driver.sector2TimeMs <= 0) {
    return '--';
  }

  const sector3Ms = driver.lastLapTime - driver.sector1TimeMs - driver.sector2TimeMs;
  if (sector3Ms <= 0) {
    return '--';
  }

  return formatSectorTime(sector3Ms);
}

function formatGapToLeader(deltaMs: number | undefined): string {
  if (deltaMs === undefined || deltaMs === 0) return '--';
  if (deltaMs >= 60000) {
    // More than 1 minute: show as +1 LAP or time
    const minutes = Math.floor(deltaMs / 60000);
    const seconds = ((deltaMs % 60000) / 1000).toFixed(1);
    return `+${minutes}:${seconds.padStart(4, '0')}`;
  }
  return `+${(deltaMs / 1000).toFixed(1)}`;
}

function parsePaceWindowLaps(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_PACE_WINDOW_LAPS;
  return Math.min(MAX_PACE_WINDOW_LAPS, Math.max(MIN_PACE_WINDOW_LAPS, parsed));
}

function calculatePaceDelta(
  history: DriverDeltaSnapshot[] | undefined,
  lapWindow: number,
  driverLastLapTime: number,
  leaderLastLapTime: number,
  isLeader: boolean,
): PaceDeltaResult {
  if (isLeader) return { deltaMs: 0, lapsUsed: lapWindow, estimated: false };

  if (!history || history.length < 2) {
    return estimatePaceFromLastLap(driverLastLapTime, leaderLastLapTime, lapWindow);
  }

  const current = history[history.length - 1];
  const baselineLap = current.lapNumber - lapWindow;
  let baseline: DriverDeltaSnapshot | null = null;

  for (let i = history.length - 2; i >= 0; i--) {
    const entry = history[i];
    if (entry.lapNumber <= baselineLap) {
      baseline = entry;
      break;
    }
  }

  if (!baseline) {
    baseline = history[0];
  }

  const lapsUsed = current.lapNumber - baseline.lapNumber;
  if (lapsUsed <= 0) {
    return estimatePaceFromLastLap(driverLastLapTime, leaderLastLapTime, lapWindow);
  }

  return {
    deltaMs: current.deltaToLeaderMs - baseline.deltaToLeaderMs,
    lapsUsed,
    estimated: false,
  };
}

function formatPaceDelta(result: PaceDeltaResult, targetLaps: number): string {
  if (result.deltaMs === null) return '--';
  const deltaMs = result.deltaMs;
  if (Math.abs(deltaMs) < PACE_NEUTRAL_THRESHOLD_MS) return 'EVEN';

  const deltaSeconds = deltaMs / 1000;
  const signedSeconds = deltaSeconds > 0 ? `+${deltaSeconds.toFixed(1)}` : deltaSeconds.toFixed(1);
  let paceText = `${signedSeconds}s`;
  if (result.estimated) {
    paceText = `~${paceText}`;
  }
  if (result.lapsUsed < targetLaps) {
    return `${paceText} (${result.lapsUsed}L)`;
  }
  return paceText;
}

function estimatePaceFromLastLap(
  driverLastLapTime: number,
  leaderLastLapTime: number,
  lapWindow: number,
): PaceDeltaResult {
  if (driverLastLapTime <= 0 || leaderLastLapTime <= 0) {
    return { deltaMs: null, lapsUsed: 0, estimated: false };
  }

  return {
    deltaMs: (driverLastLapTime - leaderLastLapTime) * lapWindow,
    lapsUsed: lapWindow,
    estimated: true,
  };
}

function getPaceClassName(deltaMs: number | null): string {
  if (deltaMs === null || Math.abs(deltaMs) < PACE_NEUTRAL_THRESHOLD_MS) {
    return styles.paceNeutral;
  }
  return deltaMs < 0 ? styles.paceFaster : styles.paceSlower;
}
