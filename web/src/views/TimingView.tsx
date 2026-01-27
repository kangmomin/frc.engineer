import type { TelemetryData, PitwallState, LapDataResponse } from '../types/telemetry';
import { Leaderboard } from '../components/pitwall/Leaderboard';
import styles from './TimingView.module.css';

interface TimingViewProps {
  pitwallState: PitwallState | null;
  data: TelemetryData;
  lapData: LapDataResponse | null;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return `${minutes}:${seconds.padStart(6, '0')}`;
}

export function TimingView({ pitwallState, data, lapData }: TimingViewProps) {
  return (
    <div className={styles.timing}>
      <section className={styles.leaderboard}>
        <Leaderboard
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </section>
      <section className={styles.lapInfo}>
        <div className={styles.lapInfoCard}>
          <div className={styles.lapInfoItem}>
            <span className={styles.lapInfoLabel}>Best Lap</span>
            <span className={styles.lapInfoValue}>
              {lapData?.bestLapTime && lapData.bestLapTime > 0
                ? formatTime(lapData.bestLapTime)
                : '--:--.---'}
            </span>
          </div>
          <div className={styles.lapInfoItem}>
            <span className={styles.lapInfoLabel}>Last Lap</span>
            <span className={styles.lapInfoValue}>
              {data.lastLapTime > 0 ? formatTime(data.lastLapTime) : '--:--.---'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
