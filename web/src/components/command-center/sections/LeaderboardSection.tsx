import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
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

// --- Stable Selectors ---

const selectDrivers = (s: any) => s.pitwallState?.drivers ?? EMPTY_DRIVERS;
const selectSession = (s: any) => s.pitwallState?.session ?? null;
const selectPlayerIndex = (s: any) => s.pitwallState?.playerIndex ?? 0;

// --- Components ---

const DriverRow = memo(({
  driver,
  isPlayer,
  idx,
  paceDelta,
  paceWindowLaps,
  showStints,
  showLast,
}: {
  driver: DriverInfo;
  isPlayer: boolean;
  idx: number;
  paceDelta: PaceDeltaResult;
  paceWindowLaps: number;
  showStints: boolean;
  showLast: boolean;
}) => {
  const gap = idx === 0 ? 'LEADER' : formatGapToLeader(driver.deltaToRaceLeader);
  const damageAlert = getDamageAlertInfo(driver, isPlayer);

  return (
    <tr className={`${styles.row} ${isPlayer ? styles.playerRow : ''}`}>
      <td className={styles.colPos}>
        <span className={styles.position}>{driver.position}</span>
      </td>
      <td className={styles.colDriver}>
        <div className={styles.driverCell}>
          <TeamColorBar teamId={driver.teamId} position="left" />
          <div className={styles.driverInfo}>
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
                >!</span>
              )}
              {damageAlert.showWingGone && (
                <span
                  className={styles.wingAlert}
                  style={{
                    backgroundColor: damageAlert.wingColor,
                    color: damageAlert.wingTextColor,
                  }}
                  title="Wing damage"
                >W</span>
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
        <TyreIcon compound={driver.tireCompound} age={driver.tireAge} size="small" />
      </td>
      {showStints && (
        <td className={styles.colPits}>
          <div className={styles.stintLog}>
            {buildStintLog(driver).map((compound, idx) => (
              <span key={idx} className={styles.stintDot} style={{ color: getTyreColor(compound) }}>
                {getTyreShortLabel(compound)}
              </span>
            ))}
          </div>
        </td>
      )}
      {showLast && (
        <td className={styles.colLap}>
          <span className={styles.lapTime}>{formatLapTime(driver.lastLapTime)}</span>
        </td>
      )}
      <td className={styles.colSector}>
        <span className={styles.sector}>{driver.sector1TimeMs > 0 ? formatSectorTime(driver.sector1TimeMs) : '--'}</span>
      </td>
      <td className={styles.colSector}>
        <span className={styles.sector}>{driver.sector2TimeMs > 0 ? formatSectorTime(driver.sector2TimeMs) : '--'}</span>
      </td>
      <td className={styles.colSector}>
        <span className={styles.sector}>{formatSector3Time(driver)}</span>
      </td>
      <td className={styles.colPace}>
        <span className={`${styles.paceValue} ${getPaceClassName(paceDelta.deltaMs)}`}>
          {formatPaceDelta(paceDelta, paceWindowLaps)}
        </span>
      </td>
    </tr>
  );
});

export function LeaderboardSection() {
  const drivers = useTelemetryStore(useShallow(selectDrivers));
  const session = useTelemetryStore(useShallow(selectSession));
  const playerIndex = useTelemetryStore(selectPlayerIndex);
  
  const [paceWindowInput, setPaceWindowInput] = useState<string>(String(DEFAULT_PACE_WINDOW_LAPS));
  const paceWindowLaps = useMemo(() => parsePaceWindowLaps(paceWindowInput), [paceWindowInput]);
  const [showStints, setShowStints] = useState(true);
  const [showLast, setShowLast] = useState(true);
  const deltaHistoryByDriver = useDriverDeltaHistory(drivers);

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
        subtitle={session ? `Lap ${leader?.currentLapNum ?? 0} / ${session.totalLaps}` : undefined}
        rightContent={(
          <div className={styles.colToggle}>
            <button
              className={`${styles.toggleBtn} ${showStints ? styles.toggleBtnActive : styles.toggleBtnInactive}`}
              onClick={() => setShowStints(v => !v)}
            >
              Stints
            </button>
            <button
              className={`${styles.toggleBtn} ${showLast ? styles.toggleBtnActive : styles.toggleBtnInactive}`}
              onClick={() => setShowLast(v => !v)}
            >
              Last
            </button>
            <div className={styles.paceInputWrap}>
              <span className={styles.paceInputLabel}>Pace Laps</span>
              <input
                className={styles.paceInput}
                type="number"
                min={MIN_PACE_WINDOW_LAPS}
                max={MAX_PACE_WINDOW_LAPS}
                value={paceWindowInput}
                onChange={(e) => setPaceWindowInput(e.target.value)}
                onBlur={() => setPaceWindowInput(String(parsePaceWindowLaps(paceWindowInput)))}
              />
            </div>
          </div>
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
              {showStints && <th className={styles.colPits}>Stints</th>}
              {showLast && <th className={styles.colLap}>Last</th>}
              <th className={styles.colSector}>S1</th>
              <th className={styles.colSector}>S2</th>
              <th className={styles.colSector}>S3</th>
              <th className={styles.colPace}>{`Delta ${paceWindowLaps}L`}</th>
            </tr>
          </thead>
          <tbody>
            {sortedDrivers.map((driver, idx) => (
              <DriverRow
                key={driver.index}
                driver={driver}
                isPlayer={driver.index === playerIndex}
                idx={idx}
                paceDelta={paceDeltaByDriver[driver.index] ?? { deltaMs: null, lapsUsed: 0, estimated: false }}
                paceWindowLaps={paceWindowLaps}
                showStints={showStints}
                showLast={showLast}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Utils ---

interface DriverDeltaSnapshot { lapNumber: number; deltaToLeaderMs: number; }
interface PaceDeltaResult { deltaMs: number | null; lapsUsed: number; estimated: boolean; }

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
          if (previousLap !== undefined && previousLap-lapNumber <= 1) continue;
          lastLapByDriverRef.current[driver.index] = lapNumber;
          next[driver.index] = [snapshot];
          changed = true;
          continue;
        }

        if (lapNumber > previousLap) {
          lastLapByDriverRef.current[driver.index] = lapNumber;
          const appended = [...snapshots, snapshot];
          next[driver.index] = appended.length > maxEntries ? appended.slice(-maxEntries) : appended;
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
  showAlert: boolean; alertColor: string; alertTextColor: string;
  showWingGone: boolean; wingColor: string; wingTextColor: string;
}

function getDamageAlertInfo(driver: DriverInfo, isPlayer: boolean): DamageAlertInfo {
  const none: DamageAlertInfo = {
    showAlert: false, alertColor: '#ffbf1f', alertTextColor: '#111',
    showWingGone: false, wingColor: '#ffbf1f', wingTextColor: '#111',
  };

  if (isPlayer || !driver.damage) return none;

  const { frontLeftWing, frontRightWing, rearWing, floor, diffuser, sidepod, engine, gearbox, drsFault, ersFault } = driver.damage;
  const maxDamage = Math.max(frontLeftWing, frontRightWing, rearWing, floor, diffuser, sidepod, engine, gearbox);
  const wingDamage = Math.max(frontLeftWing, frontRightWing, rearWing);
  const hasAnyDamage = maxDamage > 0 || drsFault || ersFault;

  if (!hasAnyDamage) return none;

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
  const t = Math.max(0, Math.min(1, value / 100));
  const r = Math.round(255 + (255 - 255) * t);
  const g = Math.round(191 + (59 - 191) * t);
  const b = Math.round(31 + (48 - 31) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatSectorTime(ms: number): string { return (ms / 1000).toFixed(3); }

function formatSector3Time(driver: DriverInfo): string {
  if (driver.lastLapTime <= 0 || driver.sector1TimeMs <= 0 || driver.sector2TimeMs <= 0) return '--';
  const s3 = driver.lastLapTime - driver.sector1TimeMs - driver.sector2TimeMs;
  return s3 > 0 ? formatSectorTime(s3) : '--';
}

function formatGapToLeader(deltaMs: number | undefined): string {
  if (deltaMs === undefined || deltaMs === 0) return '--';
  if (deltaMs >= 60000) {
    const m = Math.floor(deltaMs / 60000);
    const s = ((deltaMs % 60000) / 1000).toFixed(1);
    return `+${m}:${s.padStart(4, '0')}`;
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
  if (!history || history.length < 2) return estimatePaceFromLastLap(driverLastLapTime, leaderLastLapTime, lapWindow);

  const current = history[history.length - 1];
  const baselineLap = current.lapNumber - lapWindow;
  let baseline = history[0];
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].lapNumber <= baselineLap) {
      baseline = history[i];
      break;
    }
  }

  const lapsUsed = current.lapNumber - baseline.lapNumber;
  if (lapsUsed <= 0) return estimatePaceFromLastLap(driverLastLapTime, leaderLastLapTime, lapWindow);

  return { deltaMs: current.deltaToLeaderMs - baseline.deltaToLeaderMs, lapsUsed, estimated: false };
}

function formatPaceDelta(result: PaceDeltaResult, targetLaps: number): string {
  if (result.deltaMs === null) return '--';
  if (Math.abs(result.deltaMs) < PACE_NEUTRAL_THRESHOLD_MS) return 'EVEN';
  const s = result.deltaMs / 1000;
  const text = `${s > 0 ? '+' : ''}${s.toFixed(1)}s`;
  return result.estimated ? `~${text}` : result.lapsUsed < targetLaps ? `${text} (${result.lapsUsed}L)` : text;
}

function estimatePaceFromLastLap(driverLastLapTime: number, leaderLastLapTime: number, lapWindow: number): PaceDeltaResult {
  if (driverLastLapTime <= 0 || leaderLastLapTime <= 0) return { deltaMs: null, lapsUsed: 0, estimated: false };
  return { deltaMs: (driverLastLapTime - leaderLastLapTime) * lapWindow, lapsUsed: lapWindow, estimated: true };
}

function getPaceClassName(deltaMs: number | null): string {
  if (deltaMs === null || Math.abs(deltaMs) < PACE_NEUTRAL_THRESHOLD_MS) return styles.paceNeutral;
  return deltaMs < 0 ? styles.paceFaster : styles.paceSlower;
}
