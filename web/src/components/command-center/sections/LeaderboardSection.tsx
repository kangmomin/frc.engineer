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
                        <span className={isPlayer ? styles.playerFullName : styles.fullName}>
                          {driver.name?.trim() || `P${driver.index}`}
                        </span>
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
