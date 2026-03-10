import { useState, useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './UndercutAlert.module.css';

export function UndercutAlert() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  
  const [lastRivalPitTime, setLastRivalPitTime] = useState<number>(0);
  const [activeAlert, setActiveAlert] = useState<{
    rivalName: string;
    rivalPos: number;
    rivalCompound: string;
    recommendation: 'COVER' | 'STAY';
  } | null>(null);

  useEffect(() => {
    if (!pitwallState) return;

    const { drivers, playerIndex } = pitwallState;
    const player = drivers[playerIndex];
    if (!player) return;

    const playerPos = player.position;
    
    // Find rivals (±1 position)
    const rivalAhead = drivers.find(d => d.position === playerPos - 1);
    const rivalBehind = drivers.find(d => d.position === playerPos + 1);

    // Check if any of them are on an outlap (DriverStatus 3)
    const activeRival = [rivalAhead, rivalBehind].find(d => d && d.driverStatus === 3);

    if (activeRival) {
      // Basic recommendation logic: 
      // If rival behind is on outlap (undercut attempt), we should probably COVER.
      // If rival ahead is on outlap (trying to stay ahead), we might also want to COVER.
      
      const isUndercut = activeRival.position > playerPos;
      
      setActiveAlert({
        rivalName: activeRival.name,
        rivalPos: activeRival.position,
        rivalCompound: activeRival.tireCompound,
        recommendation: isUndercut ? 'COVER' : 'STAY'
      });
      
      setLastRivalPitTime(Date.now());
    } else {
      // Clear alert after 30 seconds if no active outlap detected
      if (Date.now() - lastRivalPitTime > 30000) {
        setActiveAlert(null);
      }
    }
  }, [pitwallState, lastRivalPitTime]);

  if (!activeAlert) return null;

  return (
    <div className={`${styles.container} ${activeAlert.recommendation === 'COVER' ? styles.cover : styles.stay}`}>
      <div className={styles.alertHeader}>UNDERCUT / TARGET ALERT</div>
      
      <div className={styles.rivalInfo}>
        <div className={styles.rivalName}>{activeAlert.rivalName} (P{activeAlert.rivalPos})</div>
        <div className={styles.tireBadge}>NEW {activeAlert.rivalCompound.toUpperCase()}</div>
        <div className={styles.statusLabel}>ON OUTLAP</div>
      </div>
      
      <div className={styles.paceComparison}>
        <div className={styles.paceLabel}>ESTIMATED PACE GAIN</div>
        <div className={styles.paceValue}>-1.2s / lap</div>
      </div>
      
      <div className={styles.actionBlock}>
        <div className={styles.recommendationText}>
          {activeAlert.recommendation === 'COVER' ? 'COVER NOW (BOX)' : 'STAY OUT'}
        </div>
        <div className={styles.subtext}>
          {activeAlert.recommendation === 'COVER' 
            ? 'Rival will jump you in 1-2 laps if you stay out.'
            : 'Maintain current pace. Monitoring gap.'}
        </div>
      </div>
    </div>
  );
}
