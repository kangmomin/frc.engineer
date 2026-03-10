import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './SCWindowAlert.module.css';

export function SCWindowAlert() {
  const safetyCar = useTelemetryStore((state) => state.pitwallState?.session?.safetyCar);
  
  if (!safetyCar || safetyCar === 'none' || safetyCar === 'formation' || safetyCar === 'unknown') {
    return null;
  }

  const isVSC = safetyCar === 'virtual';

  return (
    <div className={`${styles.container} ${isVSC ? styles.vsc : styles.sc}`}>
      <div className={styles.warningIcon}>⚠️</div>
      <div className={styles.content}>
        <div className={styles.title}>{isVSC ? 'VIRTUAL SAFETY CAR' : 'SAFETY CAR'} ACTIVE</div>
        <div className={styles.message}>PIT LOSS REDUCED - CONSIDER BOX STRATEGY</div>
      </div>
    </div>
  );
}
