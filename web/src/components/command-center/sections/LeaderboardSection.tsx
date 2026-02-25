import { useMemo } from 'react';
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

export function LeaderboardSection() {
  const drivers = useTelemetryStore((state) => state.pitwallState?.drivers ?? EMPTY_DRIVERS);
  const session = useTelemetryStore((state) => state.pitwallState?.session ?? null);
  const playerIndex = useTelemetryStore((state) => state.pitwallState?.playerIndex ?? 0);
  // Sort drivers by position
  const sortedDrivers = useMemo(() => {
    return [...drivers].sort((a, b) => a.position - b.position);
  }, [drivers]);

  const leader = sortedDrivers[0];

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Leaderboard"
        subtitle={session ? `Lap ${leader?.currentLapNum ?? 0}/${session.totalLaps}` : undefined}
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
            </tr>
          </thead>
          <tbody>
            {sortedDrivers.map((driver, idx) => {
              const isPlayer = driver.index === playerIndex;
              const gap = idx === 0 ? 'LEADER' : formatGapToLeader(driver.deltaToRaceLeader);
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
                    <span className={styles.sector}>--</span>
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
