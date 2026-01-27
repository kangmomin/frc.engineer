import { memo, useMemo } from 'react';
import { clamp } from '../utils/formatters';
import styles from './RPMBar.module.css';

interface RPMBarProps {
  rpm: number;
  maxRpm?: number;
  revLights: number;
}

const LED_COUNT = 15;

export const RPMBar = memo(function RPMBar({
  rpm,
  maxRpm = 15000,
  revLights,
}: RPMBarProps) {
  const rpmPercentage = clamp((rpm / maxRpm) * 100, 0, 100);

  // Calculate which LEDs should be lit based on revLights (0-100)
  const litLeds = useMemo(() => {
    const clampedRevLights = clamp(revLights, 0, 100);
    const count = Math.round((clampedRevLights / 100) * LED_COUNT);
    return count;
  }, [revLights]);

  // Determine LED colors: green -> yellow -> red
  const getLedColor = (index: number): string => {
    const position = index / LED_COUNT;
    if (position < 0.4) return 'green';
    if (position < 0.7) return 'yellow';
    return 'red';
  };

  return (
    <div className={styles.container}>
      <div className={styles.rpmText}>{rpm.toLocaleString()} RPM</div>
      <div className={styles.barContainer}>
        <div className={styles.ledBar}>
          {Array.from({ length: LED_COUNT }, (_, i) => (
            <div
              key={i}
              className={`${styles.led} ${styles[getLedColor(i)]} ${
                i < litLeds ? styles.lit : ''
              }`}
            />
          ))}
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progress}
            style={{ width: `${rpmPercentage}%` }}
          />
        </div>
      </div>
    </div>
  );
});
