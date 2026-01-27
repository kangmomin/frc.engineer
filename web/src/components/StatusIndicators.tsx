import { memo } from 'react';
import styles from './StatusIndicators.module.css';

interface StatusIndicatorsProps {
  drs: boolean;
  sector: number;
  lapInvalid: boolean;
}

export const StatusIndicators = memo(function StatusIndicators({
  drs,
  sector,
  lapInvalid,
}: StatusIndicatorsProps) {
  return (
    <div className={styles.container}>
      <div className={`${styles.badge} ${drs ? styles.drsActive : styles.drsInactive}`}>
        DRS
      </div>

      <div className={styles.sectorContainer}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`${styles.sector} ${sector + 1 === s ? styles.sectorActive : ''}`}
          >
            S{s}
          </div>
        ))}
      </div>

      {lapInvalid && (
        <div className={`${styles.badge} ${styles.invalid}`}>
          LAP INVALID
        </div>
      )}
    </div>
  );
});
