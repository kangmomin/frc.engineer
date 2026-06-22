import type { Tone } from './types';
import styles from './StatRibbon.module.css';
import toneStyles from './tone.module.css';

export interface StatRibbonProps {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  /** 좁은 패딩 + 작은 값 폰트 변형(기존 lapRibbon). */
  dense?: boolean;
  className?: string;
}

export function StatRibbon({ label, value, detail, tone, dense, className }: StatRibbonProps) {
  const classes = [styles.ribbonCard, toneStyles[tone]];
  if (dense) classes.push(styles.dense);
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')}>
      <div className={styles.ribbonLabel}>{label}</div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
