import { useTelemetryStore } from '../../store/telemetryStore';
import { getTeamName, getTeamColor } from '../../constants/teamColors';
import { getTyreColor } from '../../constants/tyreCompounds';
import { TeamColorBar } from './shared/TeamColorBar';
import { formatLapTime } from '../../utils/formatters';
import styles from './RaceResultModal.module.css';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function RaceResultModal() {
  const raceResult = useTelemetryStore((s) => s.raceResult);
  const clearRaceResult = useTelemetryStore((s) => s.clearRaceResult);

  if (!raceResult) return null;

  const { track, session, player, drivers } = raceResult;
  const sorted = [...drivers].sort((a, b) => a.position - b.position);

  return (
    <div className={styles.overlay} onClick={clearRaceResult}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <div className={styles.trackName}>{track.trackName || 'Unknown Track'}</div>
            <div className={styles.sessionType}>{session.sessionType || 'Race'}</div>
          </div>
          <button className={styles.dismissBtn} onClick={clearRaceResult}>
            Close
          </button>
        </div>

        {/* Player result */}
        <div className={styles.playerCard} style={{ borderLeftColor: getTeamColor(player.teamId), borderLeftWidth: 3 }}>
          <div className={styles.positionBig}>
            {player.finalPosition}
            <span className={styles.positionSuffix}>{ordinal(player.finalPosition).replace(String(player.finalPosition), '')}</span>
          </div>
          <div className={styles.playerDetails}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Driver</span>
              <span className={styles.statValue}>{player.name}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Team</span>
              <span className={styles.statValue}>{getTeamName(player.teamId)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Laps</span>
              <span className={styles.statValue}>{player.completedLaps}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Best Lap</span>
              <span className={styles.statValue}>{formatLapTime(player.bestLapMs)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Last Lap</span>
              <span className={styles.statValue}>{formatLapTime(player.lastLapMs)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Pit Stops</span>
              <span className={styles.statValue}>{player.pitStops}</span>
            </div>
          </div>
        </div>

        {/* All drivers table */}
        <div className={styles.tableSection}>
          <h3 className={styles.tableTitle}>Classification</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colPos}>P</th>
                  <th>Driver</th>
                  <th>Laps</th>
                  <th>Best Lap</th>
                  <th>Pits</th>
                  <th>Tire</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr
                    key={d.driverIndex}
                    className={`${styles.row} ${d.driverIndex === player.driverIndex ? styles.playerRow : ''}`}
                  >
                    <td className={styles.colPos}>
                      <span className={styles.position}>{d.position}</span>
                    </td>
                    <td>
                      <div className={styles.driverCell}>
                        <TeamColorBar teamId={d.teamId} />
                        <div>
                          <div className={styles.driverName}>{d.name}</div>
                          <div className={styles.teamName}>{getTeamName(d.teamId)}</div>
                        </div>
                      </div>
                    </td>
                    <td>{d.completedLaps}</td>
                    <td className={styles.lapTime}>{formatLapTime(d.bestLapMs)}</td>
                    <td>{d.pitStops}</td>
                    <td>
                      <span className={styles.tire} style={{ color: getTyreColor(d.tireCompound) }}>
                        {d.tireCompound || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
