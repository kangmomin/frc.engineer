import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import styles from './SharedComponents.module.css';

interface TyreIconProps {
  compound: string;
  age?: number;
  size?: 'small' | 'medium' | 'large';
  showAge?: boolean;
}

export function TyreIcon({ compound, age, size = 'medium', showAge = true }: TyreIconProps) {
  const color = getTyreColor(compound);
  const label = getTyreShortLabel(compound);

  return (
    <div className={`${styles.tyreIcon} ${styles[size]}`}>
      <div
        className={styles.tyreCircle}
        style={{ borderColor: color, color }}
      >
        {label}
      </div>
      {showAge && age !== undefined && (
        <span className={styles.tyreAge}>{age}L</span>
      )}
    </div>
  );
}
