import { TelemetryData } from '../../types/telemetry';
import { formatDelta, formatGear } from '../../utils/formatters';
import styles from './CompactDataPanel.module.css';

interface CompactDataPanelProps {
  data: TelemetryData;
}

export function CompactDataPanel({ data }: CompactDataPanelProps) {
  const deltaClass = data.deltaPersonalBest < 0 ? styles.faster :
                     data.deltaPersonalBest > 0 ? styles.slower : styles.neutral;

  return (
    <div className={styles.panel}>
      <div className={styles.item}>
        <span className={styles.label}>Speed</span>
        <span className={styles.value}>{data.speed}</span>
        <span className={styles.unit}>km/h</span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Gear</span>
        <span className={styles.value}>{formatGear(data.gear)}</span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Throttle</span>
        <div className={styles.barContainer}>
          <div
            className={styles.barThrottle}
            style={{ width: `${data.throttle * 100}%` }}
          />
        </div>
        <span className={styles.percent}>{Math.round(data.throttle * 100)}%</span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Brake</span>
        <div className={styles.barContainer}>
          <div
            className={styles.barBrake}
            style={{ width: `${data.brake * 100}%` }}
          />
        </div>
        <span className={styles.percent}>{Math.round(data.brake * 100)}%</span>
      </div>

      <div className={`${styles.item} ${deltaClass}`}>
        <span className={styles.label}>Delta</span>
        <span className={styles.value}>{formatDelta(data.deltaPersonalBest)}</span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Lap</span>
        <span className={styles.value}>{data.currentLap || '-'}</span>
      </div>

      <div className={styles.item}>
        <span className={styles.label}>Position</span>
        <span className={styles.value}>P{data.position || '-'}</span>
      </div>
    </div>
  );
}
