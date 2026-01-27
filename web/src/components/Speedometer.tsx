import { memo } from 'react';
import styles from './Speedometer.module.css';

interface SpeedometerProps {
  speed: number;
}

export const Speedometer = memo(function Speedometer({ speed }: SpeedometerProps) {
  return (
    <div className={styles.container}>
      <div className={styles.value}>{speed}</div>
      <div className={styles.unit}>km/h</div>
    </div>
  );
});
