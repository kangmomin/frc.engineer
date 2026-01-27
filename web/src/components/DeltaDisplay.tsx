import { memo } from 'react';
import { formatDelta } from '../utils/formatters';
import styles from './DeltaDisplay.module.css';

interface DeltaDisplayProps {
  deltaPersonalBest: number;
  deltaCarInFront?: number;
}

export const DeltaDisplay = memo(function DeltaDisplay({
  deltaPersonalBest,
  deltaCarInFront,
}: DeltaDisplayProps) {
  const deltaValue = formatDelta(deltaPersonalBest);
  const isFaster = deltaPersonalBest < 0;
  const isSlower = deltaPersonalBest > 0;

  const deltaClass = isFaster
    ? styles.faster
    : isSlower
    ? styles.slower
    : styles.neutral;

  return (
    <div className={styles.container}>
      <div className={styles.label}>DELTA</div>
      <div className={`${styles.value} ${deltaClass}`}>{deltaValue}</div>
      {deltaCarInFront !== undefined && deltaCarInFront !== 0 && (
        <div className={styles.secondary}>
          <span className={styles.secondaryLabel}>Car Ahead:</span>
          <span className={deltaCarInFront < 0 ? styles.faster : styles.slower}>
            {formatDelta(deltaCarInFront)}
          </span>
        </div>
      )}
    </div>
  );
});
