import type { DriverInfo, SessionInfo } from '../../types/telemetry';
import styles from './PitStrategy.module.css';

interface PitStrategyProps {
  drivers: DriverInfo[];
  playerIndex: number;
  session: SessionInfo | null;
}

// Estimated pit lane time loss in seconds
const PIT_TIME_LOSS = 22;

export function PitStrategy({ drivers, playerIndex, session }: PitStrategyProps) {
  const player = drivers[playerIndex];

  if (!player || !session || session.trackLength === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>PIT STRATEGY</div>
        <div className={styles.noData}>No pit data</div>
      </div>
    );
  }

  const trackLength = session.trackLength;

  // Estimate avg lap time from player's last lap (fallback: 90s)
  const avgLapTime = player.lastLapTime > 0 ? player.lastLapTime / 1000 : 90;

  // Build sorted list of active drivers by position
  const sorted = [...drivers]
    .filter((d) => d.position > 0)
    .sort((a, b) => a.position - b.position);

  // Calculate gap to each driver using lap distance difference
  // Positive gap = they are ahead
  // Calculate absolute distance using lap number + lap distance to handle lapped cars
  const playerAbsDist = (player.currentLapNum - 1) * trackLength + player.lapDistance;

  const gaps = sorted.map((d) => {
    if (d.index === player.index) return { driver: d, gapSec: 0 };
    const dAbsDist = (d.currentLapNum - 1) * trackLength + d.lapDistance;
    const distDiff = dAbsDist - playerAbsDist;
    const gapSec = (distDiff / trackLength) * avgLapTime;
    return { driver: d, gapSec: Math.abs(gapSec) };
  });

  // Predicted return position: after pitting, player loses ~22s.
  // Count how many cars would be ahead after the time loss.
  const playerCurrentPos = player.position;
  let returnPosition = 1;
  for (const g of gaps) {
    if (g.driver.index === player.index) continue;
    // If gap to this car (from player's perspective) is less than pit loss,
    // this car will be ahead after pitting
    if (g.gapSec < PIT_TIME_LOSS) {
      returnPosition++;
    }
  }

  const posLoss = returnPosition - playerCurrentPos;

  // Find car ahead for undercut check
  const carAhead = sorted.find((d) => d.position === playerCurrentPos - 1);
  const gapToAhead = carAhead
    ? gaps.find((g) => g.driver.index === carAhead.index)?.gapSec ?? null
    : null;
  const undercutPossible = gapToAhead !== null && gapToAhead < 2.5;

  // Traffic near return position: drivers within 5s of projected return gap
  const returnGapThreshold = PIT_TIME_LOSS;
  const traffic = gaps
    .filter((g) => {
      if (g.driver.index === player.index) return false;
      return Math.abs(g.gapSec - returnGapThreshold) < 5;
    })
    .sort((a, b) => a.gapSec - b.gapSec)
    .slice(0, 5);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>PIT STRATEGY</div>

      <div className={styles.row}>
        <span className={styles.label}>Current pos</span>
        <span className={styles.value}>P{playerCurrentPos}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Pit stops</span>
        <span className={styles.value}>{player.numPitStops}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Return pos</span>
        <span className={`${styles.returnPosition} ${posLoss > 0 ? styles.positionLoss : styles.positionSame}`}>
          P{returnPosition} {posLoss > 0 ? `(-${posLoss})` : ''}
        </span>
      </div>

      {undercutPossible && (
        <div className={styles.undercutAlert}>
          Undercut possible — gap to P{playerCurrentPos - 1}: {gapToAhead!.toFixed(1)}s
        </div>
      )}

      <hr className={styles.separator} />

      {traffic.length > 0 && (
        <>
          <div className={styles.subheader}>Traffic near return</div>
          <div className={styles.trafficList}>
            {traffic.map((t) => {
              const gapClass = t.gapSec < 1 ? styles.gapDanger
                : t.gapSec < 3 ? styles.gapWarn
                : styles.gapSafe;
              return (
                <div key={t.driver.index} className={styles.trafficItem}>
                  <span className={styles.trafficName}>
                    P{t.driver.position} {t.driver.name}
                  </span>
                  <span className={`${styles.trafficGap} ${gapClass}`}>
                    {t.gapSec.toFixed(1)}s
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
