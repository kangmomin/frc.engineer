import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './PitRejoinRadar.module.css';

export function PitRejoinRadar() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  
  if (!pitwallState || !pitwallState.session) {
    return null;
  }

  const { session, drivers, playerIndex } = pitwallState;
  const player = drivers[playerIndex];
  
  if (!player) return null;

  const rejoinPos = session.pitStopRejoinPosition || 0;
  if (rejoinPos === 0) return null;

  // Find cars around the rejoin position
  // Note: position is 1-indexed in the data
  const carInFront = drivers.find(d => d.position === rejoinPos - 1);
  const carBehind = drivers.find(d => d.position === rejoinPos);

  // Traffic density logic:
  // If the gap between carInFront and carBehind is small (< 2.0s), it's traffic.
  // This is a simplification but fits the requirements.
  const gapAhead = carInFront ? (carBehind ? (carBehind.deltaToCarInFront ?? 2000) / 1000 : 2.0) : 5.0;
  const isTraffic = gapAhead < 1.5;

  return (
    <div className={`${styles.container} ${isTraffic ? styles.traffic : styles.cleanAir}`}>
      <div className={styles.header}>PIT REJOIN RADAR</div>
      <div className={styles.mainInfo}>
        <div className={styles.label}>ESTIMATED REJOIN POSITION</div>
        <div className={styles.position}>P{rejoinPos}</div>
      </div>
      
      <div className={styles.radarGrid}>
        <div className={styles.carInfo}>
          <div className={styles.labelSmall}>AHEAD</div>
          <div className={styles.driverName}>{carInFront?.name || 'CLEAR'}</div>
          <div className={styles.gap}>{carInFront ? `+${gapAhead.toFixed(1)}s` : '--'}</div>
        </div>
        
        <div className={styles.playerCar}>
          <div className={styles.playerLabel}>YOU</div>
          <div className={styles.statusLabel}>{isTraffic ? 'TRAFFIC' : 'CLEAN AIR'}</div>
        </div>
        
        <div className={styles.carInfo}>
          <div className={styles.labelSmall}>BEHIND</div>
          <div className={styles.driverName}>{carBehind?.name || 'CLEAR'}</div>
          <div className={styles.gap}>{carBehind ? `-${((carBehind.deltaToCarInFront ?? 0) / 1000).toFixed(1)}s` : '--'}</div>
        </div>
      </div>
    </div>
  );
}
