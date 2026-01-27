import type { DriverInfo, SessionInfo } from '../../types/telemetry';
import styles from './FuelStrategy.module.css';

interface FuelStrategyProps {
  drivers: DriverInfo[];
  playerIndex: number;
  session: SessionInfo | null;
}

const FUEL_MIX_LABELS = ['LEAN', 'STANDARD', 'RICH', 'MAX'];
const FUEL_MIX_STYLES = [styles.mixLean, styles.mixStandard, styles.mixRich, styles.mixMax];

const ERS_DEPLOY_LABELS = ['NONE', 'MEDIUM', 'HOTLAP', 'OVERTAKE'];
const ERS_DEPLOY_STYLES = [styles.ersNone, styles.ersMedium, styles.ersHotlap, styles.ersOvertake];

// Max ERS store energy in joules (4 MJ)
const ERS_MAX_ENERGY = 4_000_000;

export function FuelStrategy({ drivers, playerIndex, session }: FuelStrategyProps) {
  const driver = drivers[playerIndex];

  if (!driver) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>FUEL & ENERGY</div>
        <div className={styles.noData}>No fuel data</div>
      </div>
    );
  }

  const totalLaps = session?.totalLaps ?? 0;
  const remainingLaps = totalLaps > 0 ? totalLaps - driver.currentLapNum + 1 : 0;
  const targetFuel = remainingLaps > 0 ? driver.fuelInTank / remainingLaps : 0;
  const fuelDelta = remainingLaps > 0 ? driver.fuelRemainingLaps - remainingLaps : 0;

  const deltaClass = fuelDelta > 0.5 ? styles.deltaPositive
    : fuelDelta < -0.5 ? styles.deltaNegative
    : styles.deltaNeutral;

  const ersPercent = Math.min(100, (driver.ersStoreEnergy / ERS_MAX_ENERGY) * 100);
  const deployMode = Math.max(0, Math.min(driver.ersDeployMode, 3));

  return (
    <div className={styles.panel}>
      <div className={styles.header}>FUEL & ENERGY</div>

      <div className={styles.fuelRow}>
        <span className={styles.fuelLabel}>Fuel</span>
        <span className={styles.fuelValue}>{driver.fuelInTank.toFixed(2)} kg</span>
      </div>

      <div className={styles.fuelRow}>
        <span className={styles.fuelLabel}>Laps remaining</span>
        <span className={styles.fuelValue}>{driver.fuelRemainingLaps.toFixed(1)}</span>
      </div>

      {remainingLaps > 0 && (
        <>
          <div className={styles.fuelRow}>
            <span className={styles.fuelLabel}>Target / lap</span>
            <span className={styles.fuelValue}>{targetFuel.toFixed(2)} kg</span>
          </div>
          <div className={styles.fuelRow}>
            <span className={styles.fuelLabel}>Delta</span>
            <span className={`${styles.fuelDelta} ${deltaClass}`}>
              {fuelDelta > 0 ? '+' : ''}{fuelDelta.toFixed(1)} laps
            </span>
          </div>
        </>
      )}

      <div className={styles.fuelRow}>
        <span className={styles.fuelLabel}>Mix</span>
        <span className={`${styles.mixIndicator} ${FUEL_MIX_STYLES[driver.fuelMix] ?? styles.mixStandard}`}>
          {FUEL_MIX_LABELS[driver.fuelMix] ?? 'UNKNOWN'}
        </span>
      </div>

      <hr className={styles.separator} />

      <div className={styles.ersSection}>
        <div className={styles.fuelRow}>
          <span className={styles.fuelLabel}>ERS Store</span>
          <span className={styles.fuelValue}>{ersPercent.toFixed(0)}%</span>
        </div>
        <div className={styles.ersBarContainer}>
          <div className={styles.ersBar} style={{ width: `${ersPercent}%` }} />
        </div>
        <div className={styles.fuelRow}>
          <span className={styles.fuelLabel}>Deploy</span>
          <span className={`${styles.ersDeployMode} ${ERS_DEPLOY_STYLES[deployMode]}`}>
            {ERS_DEPLOY_LABELS[deployMode]}
          </span>
        </div>
        <div className={styles.fuelRow}>
          <span className={styles.fuelLabel}>Harvested</span>
          <span className={styles.fuelValue}>{(driver.ersHarvestedThisLap / 1000).toFixed(0)} kJ</span>
        </div>
        <div className={styles.fuelRow}>
          <span className={styles.fuelLabel}>Deployed</span>
          <span className={styles.fuelValue}>{(driver.ersDeployedThisLap / 1000).toFixed(0)} kJ</span>
        </div>
      </div>
    </div>
  );
}
