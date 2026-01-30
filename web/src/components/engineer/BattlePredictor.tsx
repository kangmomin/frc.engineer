import type { DriverInfo } from '../../types/telemetry';
import styles from './BattlePredictor.module.css';

interface BattlePredictorProps {
  drivers: DriverInfo[];
  playerIndex: number;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '-';
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(3);
  return mins > 0 ? `${mins}:${secs.padStart(6, '0')}` : `${secs}s`;
}

function paceTag(deltaMs: number) {
  // Negative = we are faster (catching), positive = they are faster
  if (Math.abs(deltaMs) < 100) return { label: 'Stable', cls: styles.stable };
  if (deltaMs < 0) return { label: 'Catching', cls: styles.catching };
  return { label: 'Losing', cls: styles.losing };
}

export function BattlePredictor({ drivers, playerIndex }: BattlePredictorProps) {
  const player = drivers.find((d) => d.index === playerIndex);
  if (!player) return <div className={styles.predictor}>No player data</div>;

  const ahead = drivers.find((d) => d.position === player.position - 1);
  const behind = drivers.find((d) => d.position === player.position + 1);

  const rows: { label: string; driver: DriverInfo; gap: number | undefined; paceDelta: number }[] = [];

  if (ahead && player.lastLapTime > 0 && ahead.lastLapTime > 0) {
    rows.push({
      label: 'Ahead',
      driver: ahead,
      gap: player.deltaToCarInFront,
      paceDelta: player.lastLapTime - ahead.lastLapTime,
    });
  }

  if (behind && player.lastLapTime > 0 && behind.lastLapTime > 0) {
    rows.push({
      label: 'Behind',
      driver: behind,
      gap: behind.deltaToCarInFront,
      paceDelta: behind.lastLapTime - player.lastLapTime,
    });
  }

  return (
    <div className={styles.predictor}>
      <div className={styles.title}>Battle Predictor</div>
      {rows.length === 0 ? (
        <div className={styles.noBattle}>No battle data available</div>
      ) : (
        <div className={styles.battle}>
          {rows.map((r) => {
            const tag = paceTag(r.paceDelta);
            return (
              <div key={r.label} className={styles.row}>
                <span>{r.label}</span>
                <span className={styles.driverName}>{r.driver.name}</span>
                <span className={styles.gap}>
                  {r.gap != null ? `${r.gap.toFixed(3)}s` : '-'}
                </span>
                <span>Pace: {formatTime(r.driver.lastLapTime)}</span>
                <span className={`${styles.prediction} ${tag.cls}`}>{tag.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
