import { formatDelta } from '../../../utils/formatters';
import styles from './SharedComponents.module.css';

interface DeltaTextProps {
  deltaMs: number;
  showSign?: boolean;
  size?: 'small' | 'medium' | 'large';
}

export function DeltaText({ deltaMs, showSign = true, size = 'medium' }: DeltaTextProps) {
  const isFaster = deltaMs < 0;
  const isSlower = deltaMs > 0;
  const colorClass = isFaster ? styles.faster : isSlower ? styles.slower : styles.neutral;

  const displayValue = showSign ? formatDelta(deltaMs) : Math.abs(deltaMs / 1000).toFixed(3);

  return (
    <span className={`${styles.deltaText} ${colorClass} ${styles[size]}`}>
      {displayValue}
    </span>
  );
}
