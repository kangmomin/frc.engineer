import type { BattleAlert } from '../../types/telemetry';
import styles from './BattleAlertModal.module.css';

interface Props {
  alert: BattleAlert | null;
  onDismiss: () => void;
}

export function BattleAlertModal({ alert, onDismiss }: Props) {
  if (!alert) return null;

  const sideLabel = alert.side === 'ahead' ? 'Closing on car ahead' : 'Car behind closing';

  return (
    <div className={styles.backdrop} onClick={onDismiss}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>&#9888;</span>
          <h3 className={styles.title}>Battle Alert — {sideLabel}</h3>
        </div>

        <div className={styles.stats}>
          <span className={styles.label}>Driver Ahead</span>
          <span className={styles.value}>{alert.driverAhead}</span>

          <span className={styles.label}>Driver Behind</span>
          <span className={styles.value}>{alert.driverBehind}</span>

          <span className={styles.label}>Current Gap</span>
          <span className={styles.value}>{alert.gapSeconds.toFixed(3)}s</span>

          <span className={styles.label}>Closing Rate</span>
          <span className={styles.value}>{alert.closingRatePerLap.toFixed(3)}s / lap</span>

          <span className={styles.label}>Est. Overtake In</span>
          <span className={styles.value}>{alert.estOvertakeLap} lap{alert.estOvertakeLap !== 1 ? 's' : ''}</span>
        </div>

        <button className={styles.closeBtn} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
