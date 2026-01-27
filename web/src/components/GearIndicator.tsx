import { memo } from 'react';
import { formatGear } from '../utils/formatters';
import styles from './GearIndicator.module.css';

interface GearIndicatorProps {
  gear: number;
}

export const GearIndicator = memo(function GearIndicator({ gear }: GearIndicatorProps) {
  const gearText = formatGear(gear);

  const gearClass =
    gear === -1
      ? styles.reverse
      : gear === 0
      ? styles.neutral
      : styles.forward;

  return (
    <div className={styles.container}>
      <div className={styles.label}>GEAR</div>
      <div className={`${styles.value} ${gearClass}`}>{gearText}</div>
    </div>
  );
});
