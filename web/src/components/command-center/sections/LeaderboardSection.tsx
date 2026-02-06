import { useMemo } from 'react';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { SectionHeader } from '../shared/SectionHeader';
import { TyreIcon } from '../shared/TyreIcon';
import { TeamColorBar } from '../shared/TeamColorBar';
import styles from './LeaderboardSection.module.css';

interface LeaderboardSectionProps {
  drivers: DriverInfo[];
  session: SessionInfo | null;
  playerIndex: number;
}

export function LeaderboardSection({ drivers, session, playerIndex }: LeaderboardSectionProps) {
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
              <th className={styles.colPits}>Pit</th>
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
                      <span className={styles.driverName}>
                        {formatDriverName(driver.name, driver.index)}
                      </span>
                    </div>
                  </td>
                  <td className={styles.colGap}>
                    <span className={styles.gap}>{gap}</span>
                  </td>
                  <td className={styles.colTyre}>
                    <TyreIcon
                      compound={driver.tireCompound}
                      age={driver.tireAge}
                      size="small"
                    />
                  </td>
                  <td className={styles.colPits}>
                    <span className={styles.pits}>{driver.numPitStops}</span>
                  </td>
                  <td className={styles.colLap}>
                    <span className={styles.lapTime}>
                      {formatLapTime(driver.lastLapTime)}
                    </span>
                  </td>
                  <td className={styles.colSector}>
                    <span className={styles.sector}>--</span>
                  </td>
                  <td className={styles.colSector}>
                    <span className={styles.sector}>--</span>
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

function formatDriverName(fullName: string, carIndex?: number): string {
  const trimmed = fullName?.trim() ?? '';
  if (!trimmed) {
    return carIndex !== undefined ? `P${carIndex}` : 'PLY';
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return parts[parts.length - 1].substring(0, 3).toUpperCase();
  }
  return trimmed.substring(0, 3).toUpperCase();
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
