import { useMemo } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './MasterStrategyBoard.module.css';

export function MasterStrategyBoard() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);

  const strategyState = useMemo(() => {
    if (!pitwallState || !pitwallState.session) return null;

    const { session, drivers, playerIndex } = pitwallState;
    const player = drivers[playerIndex];
    if (!player) return null;

    // 1. Pit Window Radar Logic
    const rejoinPos = session.pitStopRejoinPosition || 0;
    const carInFrontAtRejoin = drivers.find(d => d.position === rejoinPos - 1);
    const carBehindAtRejoin = drivers.find(d => d.position === rejoinPos);
    
    // Gap check for traffic
    const gapAheadAtRejoin = carInFrontAtRejoin ? (carBehindAtRejoin ? (carBehindAtRejoin.deltaToCarInFront ?? 2000) / 1000 : 2.0) : 5.0;
    const isTraffic = gapAheadAtRejoin < 1.5;

    // 2. Undercut/Overcut Monitor
    const rivalAhead = drivers.find(d => d.position === player.position - 1);
    const rivalBehind = drivers.find(d => d.position === player.position + 1);
    
    // Check if any rival is on outlap (DriverStatus 3)
    const rivalOnOutlap = [rivalAhead, rivalBehind].find(d => d && d.driverStatus === 3);
    
    let alertText = "";
    let alertType: 'NONE' | 'UNDER' | 'OVER' = 'NONE';
    
    if (rivalOnOutlap) {
      if (rivalOnOutlap.position > player.position) {
        alertType = 'UNDER';
        alertText = `BOX TO COVER: ${rivalOnOutlap.name} attempted Undercut!`;
      } else {
        alertType = 'OVER';
        alertText = `OVERCUT POSSIBLE: ${rivalOnOutlap.name} pitted. Clean air ahead!`;
      }
    }

    // 3. Weather Impact
    const futureRain = session.weatherForecast?.some(f => f.timeOffset > 0 && f.timeOffset < 15 && f.rainPercentage > 40);
    const weatherAlert = futureRain ? "DELAY PIT - RAIN EXPECTED IN 5-10 MIN" : null;

    return {
      rejoinPos,
      carInFrontAtRejoin,
      carBehindAtRejoin,
      isTraffic,
      alertText,
      alertType,
      weatherAlert,
      currentLap: player.currentLapNum,
      targetLap: session.pitStopWindowIdealLap || 0
    };
  }, [pitwallState]);

  if (!strategyState) return null;

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeader}>🛑 MASTER STRATEGY BOARD</div>
      
      {/* 1. Alerts Section */}
      <div className={styles.alertsContainer}>
        {strategyState.alertType !== 'NONE' && (
          <div className={`${styles.strategyAlert} ${styles[strategyState.alertType.toLowerCase()]}`}>
            <span className={styles.alertIcon}>⚠️</span>
            <span className={styles.alertMessage}>{strategyState.alertText}</span>
          </div>
        )}
        
        {strategyState.weatherAlert && (
          <div className={styles.weatherAlert}>
            <span className={styles.alertIcon}>🌧️</span>
            <span className={styles.alertMessage}>{strategyState.weatherAlert}</span>
          </div>
        )}
      </div>

      <div className={styles.boardGrid}>
        {/* 2. Pit Radar */}
        <div className={styles.boardPanel}>
          <div className={styles.panelTitle}>PIT WINDOW RADAR</div>
          <div className={styles.radarInfo}>
            <div className={styles.rejoinStat}>
              <span className={styles.statLabel}>ESTIMATED REJOIN</span>
              <span className={styles.statValue}>P{strategyState.rejoinPos}</span>
            </div>
            <div className={`${styles.trafficBadge} ${strategyState.isTraffic ? styles.traffic : styles.clear}`}>
              {strategyState.isTraffic ? 'TRAFFIC' : 'CLEAN AIR'}
            </div>
          </div>
          <div className={styles.rejoinDetails}>
            <div className={styles.rejoinRow}>
              <span>Ahead:</span>
              <span className={styles.rejoinDriver}>{strategyState.carInFrontAtRejoin?.name || '--'}</span>
            </div>
            <div className={styles.rejoinRow}>
              <span>Behind:</span>
              <span className={styles.rejoinDriver}>{strategyState.carBehindAtRejoin?.name || '--'}</span>
            </div>
          </div>
        </div>

        {/* 3. Stint Planner */}
        <div className={styles.boardPanel}>
          <div className={styles.panelTitle}>STINT PLANNER</div>
          <div className={styles.plannerInfo}>
            <div className={styles.progressRow}>
              <div className={styles.lapIndicator}>
                <span className={styles.lapLabel}>CURRENT LAP</span>
                <span className={styles.lapValue}>{strategyState.currentLap}</span>
              </div>
              <div className={styles.lapSeparator}>→</div>
              <div className={styles.lapIndicator}>
                <span className={styles.lapLabel}>TARGET LAP</span>
                <span className={styles.lapValue}>{strategyState.targetLap}</span>
              </div>
            </div>
            
            <div className={styles.progressBar}>
              <div 
                className={styles.progressFill} 
                style={{ width: `${Math.min(100, (strategyState.currentLap / strategyState.targetLap) * 100)}%` }} 
              />
            </div>
            
            <div className={styles.stintStatus}>
              {strategyState.currentLap >= strategyState.targetLap 
                ? "WINDOW OPEN - BOX THIS LAP" 
                : `${strategyState.targetLap - strategyState.currentLap} LAPS TO PIT WINDOW`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
