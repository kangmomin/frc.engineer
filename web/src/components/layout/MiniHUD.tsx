import type { TelemetryData, PitwallState } from '../../types/telemetry';
import { formatDelta } from '../../utils/formatters';
import styles from './MiniHUD.module.css';

interface MiniHUDProps {
  data: TelemetryData;
  pitwallState: PitwallState | null;
}

export function MiniHUD({ data, pitwallState }: MiniHUDProps) {
  const playerDriver = pitwallState?.drivers.find(
    (d) => d.index === pitwallState.playerIndex
  );
  const tireCompound = playerDriver?.tireCompound ?? '--';
  const fuelInfo = `L${data.currentLap}`;
  const deltaMs = data.deltaPersonalBest;
  const deltaClass = deltaMs < 0 ? styles.faster : deltaMs > 0 ? styles.slower : '';

  return (
    <div className={styles.hud}>
      <div className={styles.item}>
        <span className={styles.label}>LAP</span>
        <span className={styles.value}>{data.currentLap || '--'}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>DELTA</span>
        <span className={`${styles.value} ${deltaClass}`}>
          {formatDelta(deltaMs)}
        </span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>POS</span>
        <span className={styles.value}>{data.position || '--'}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>TIRE</span>
        <span className={styles.value}>{tireCompound}</span>
      </div>
      <div className={styles.item}>
        <span className={styles.label}>INFO</span>
        <span className={styles.value}>{fuelInfo}</span>
      </div>
    </div>
  );
}
