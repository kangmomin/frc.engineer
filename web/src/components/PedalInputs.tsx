import { memo } from 'react';
import { toPercentage, clamp } from '../utils/formatters';
import styles from './PedalInputs.module.css';

interface PedalInputsProps {
  throttle: number;
  brake: number;
}

export const PedalInputs = memo(function PedalInputs({
  throttle,
  brake,
}: PedalInputsProps) {
  const throttlePercent = clamp(toPercentage(throttle), 0, 100);
  const brakePercent = clamp(toPercentage(brake), 0, 100);

  return (
    <div className={styles.container}>
      <div className={styles.pedalGroup}>
        <div className={styles.label}>THROTTLE</div>
        <div className={styles.barContainer}>
          <div
            className={`${styles.bar} ${styles.throttle}`}
            style={{ width: `${throttlePercent}%` }}
          />
        </div>
        <div className={styles.value}>{throttlePercent}%</div>
      </div>
      <div className={styles.pedalGroup}>
        <div className={styles.label}>BRAKE</div>
        <div className={styles.barContainer}>
          <div
            className={`${styles.bar} ${styles.brake}`}
            style={{ width: `${brakePercent}%` }}
          />
        </div>
        <div className={styles.value}>{brakePercent}%</div>
      </div>
    </div>
  );
});
