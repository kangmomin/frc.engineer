import { useState, useMemo } from 'react';
import type { PitwallState, DriverInfo } from '../../types/telemetry';
import styles from './PitWindowPredictor.module.css';

interface PitWindowPredictorProps {
  pitwallState: PitwallState | null;
}

const DEFAULT_PIT_LOSS = 22000; // 22 seconds in ms

function getDriverName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : name.toUpperCase();
}

export function PitWindowPredictor({ pitwallState }: PitWindowPredictorProps) {
  const [showResult, setShowResult] = useState(false);

  const prediction = useMemo(() => {
    if (!pitwallState?.drivers?.length) return null;

    const player = pitwallState.drivers[pitwallState.playerIndex];
    if (!player) return null;

    // Guard: need valid delta data to predict
    if (player.deltaToRaceLeader == null && player.position !== 1) return null;

    const sorted = [...pitwallState.drivers]
      .filter(d => d.position > 0)
      .sort((a, b) => a.position - b.position);

    // Pit loss time: use actual if available, else fallback
    const pitLoss = player.pitLaneTime && player.pitLaneTime > 0
      ? player.pitLaneTime
      : DEFAULT_PIT_LOSS;

    const playerDelta = player.deltaToRaceLeader ?? 0;

    // Filter out lapped cars (different lap count from player)
    const driversWithGap = sorted
      .filter(d => d.currentLapNum >= player.currentLapNum - 1)
      .map(d => {
        const gap = (d.deltaToRaceLeader ?? 0) - playerDelta;
        return { driver: d, gap };
      });

    // After pitting, player loses pitLoss ms. Find where they'd slot in.
    const playerGapAfterPit = pitLoss; // extra time lost

    let returnPosition = 1;
    let driverAhead: DriverInfo | null = null;
    let driverBehind: DriverInfo | null = null;

    for (const { driver, gap } of driversWithGap) {
      if (driver.index === player.index) continue;
      // gap < 0 means driver is ahead; gap > 0 means behind
      // After pit, player effectively adds pitLoss to their gap
      const effectiveGap = -gap + playerGapAfterPit; // positive = this driver is still ahead
      if (effectiveGap > 0) {
        // This driver would still be ahead
        returnPosition = driver.position + 1;
        driverAhead = driver;
      } else if (!driverBehind) {
        driverBehind = driver;
      }
    }

    // Traffic: drivers within ±5s of return position
    const trafficWindow = 5000;
    const traffic = driversWithGap.filter(({ driver, gap }) => {
      if (driver.index === player.index) return false;
      const effectiveGap = Math.abs(-gap + playerGapAfterPit);
      return effectiveGap < trafficWindow;
    });

    const congestion = traffic.length >= 4 ? 'high' : traffic.length >= 2 ? 'medium' : 'low';

    return {
      currentPosition: player.position,
      returnPosition,
      driverAhead,
      driverBehind,
      pitLoss,
      traffic: traffic.map(t => t.driver),
      congestion,
    };
  }, [pitwallState]);

  const handleBoxNow = () => setShowResult(true);

  if (!pitwallState?.drivers?.length) {
    return (
      <div className={styles.predictor}>
        <div className={styles.header}>
          <span className={styles.title}>Pit Window Predictor</span>
        </div>
        <span className={styles.noData}>Waiting for data...</span>
      </div>
    );
  }

  return (
    <div className={styles.predictor}>
      <div className={styles.header}>
        <span className={styles.title}>Pit Window Predictor</span>
        <button className={styles.boxButton} onClick={handleBoxNow}>
          BOX NOW
        </button>
      </div>
      {showResult && prediction && (
        <div className={styles.result}>
          <div>
            Pit loss: <span className={styles.highlight}>{(prediction.pitLoss / 1000).toFixed(1)}s</span>
          </div>
          <div>
            Return position: <span className={styles.highlight}>P{prediction.returnPosition}</span>
            {prediction.driverAhead && (
              <> behind {getDriverName(prediction.driverAhead.name)}</>
            )}
            {prediction.driverBehind && (
              <>, ahead of {getDriverName(prediction.driverBehind.name)}</>
            )}
          </div>
          <div>
            Traffic:{' '}
            <span className={
              prediction.congestion === 'high' ? styles.congestionHigh :
              prediction.congestion === 'medium' ? styles.congestionMedium :
              styles.congestionLow
            }>
              {prediction.congestion.toUpperCase()}
            </span>
            {prediction.traffic.length > 0 && (
              <> ({prediction.traffic.map(d => getDriverName(d.name)).join(', ')})</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
