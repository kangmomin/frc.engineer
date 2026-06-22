import type { Tone } from './types';
import styles from './MetricTile.module.css';
import toneStyles from './tone.module.css';

export interface MetricTileProps {
  label: string;
  value: string;
  tone: Tone;
  note?: string;
  /** 좁은 패딩 + 작은 폰트 변형(기존 compactMetricTile). */
  compact?: boolean;
  className?: string;
}

export function MetricTile({ label, value, tone, note, compact, className }: MetricTileProps) {
  const classes = [styles.metricTile];
  if (compact) classes.push(styles.compact);
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')}>
      <span>{label}</span>
      <strong className={toneStyles[tone]}>{value}</strong>
      {note && <small className={styles.metricNote}>{note}</small>}
    </div>
  );
}
