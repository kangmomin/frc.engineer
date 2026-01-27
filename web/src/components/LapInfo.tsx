import { memo } from 'react';
import { formatLapTime, formatPosition } from '../utils/formatters';
import styles from './LapInfo.module.css';

interface LapInfoProps {
  currentLap: number;
  currentLapTime: number;
  lastLapTime: number;
  bestLapTime: number;
  position: number;
}

export const LapInfo = memo(function LapInfo({
  currentLap,
  currentLapTime,
  lastLapTime,
  bestLapTime,
  position,
}: LapInfoProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerItem}>
          <span className={styles.label}>LAP</span>
          <span className={styles.headerValue}>{currentLap || '--'}</span>
        </div>
        <div className={styles.headerItem}>
          <span className={styles.label}>POS</span>
          <span className={styles.headerValue}>{formatPosition(position)}</span>
        </div>
      </div>

      <div className={styles.times}>
        <div className={styles.timeRow}>
          <span className={styles.timeLabel}>TIME</span>
          <span className={`${styles.timeValue} ${styles.currentTime}`}>
            {formatLapTime(currentLapTime)}
          </span>
        </div>
        <div className={styles.timeRow}>
          <span className={styles.timeLabel}>LAST</span>
          <span className={styles.timeValue}>{formatLapTime(lastLapTime)}</span>
        </div>
        <div className={styles.timeRow}>
          <span className={styles.timeLabel}>BEST</span>
          <span className={`${styles.timeValue} ${styles.bestTime}`}>
            {formatLapTime(bestLapTime)}
          </span>
        </div>
      </div>
    </div>
  );
});
