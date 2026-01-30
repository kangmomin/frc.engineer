import type { DriverInfo } from '../../types/telemetry';
import styles from './CarStatusPanel.module.css';

interface CarStatusPanelProps {
  driver: DriverInfo | null;
}

const TIRE_LABELS = ['FL', 'FR', 'RL', 'RR'];
const FUEL_MIX_NAMES = ['Lean', 'Standard', 'Rich', 'Max'];
const ERS_MODE_NAMES = ['None', 'Medium', 'Hotlap', 'Overtake'];

function wearClass(pct: number) {
  if (pct < 30) return styles.wearGood;
  if (pct < 60) return styles.wearMedium;
  return styles.wearBad;
}

function dmgClass(val: number) {
  if (val === 0) return styles.dmgOk;
  if (val < 30) return styles.dmgWarn;
  return styles.dmgCrit;
}

export function CarStatusPanel({ driver }: CarStatusPanelProps) {
  if (!driver) return <div className={styles.panel}>No driver data</div>;

  const ersPercent = (driver.ersStoreEnergy / 4_000_000) * 100;

  return (
    <div className={styles.panel}>
      {/* Tires */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Tyres — {driver.tireCompound} (Age {driver.tireAge})
        </div>
        <div className={styles.tireGrid}>
          {TIRE_LABELS.map((label, i) => (
            <div key={label} className={styles.tire}>
              <div className={styles.tireLabel}>{label}</div>
              <div className={`${styles.tireWear} ${wearClass(driver.tireWear[i] ?? 0)}`}>
                {(driver.tireWear[i] ?? 0).toFixed(0)}%
              </div>
              <div className={styles.tireTemp}>
                {(driver.tireTemp[i] ?? 0).toFixed(0)}°C
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Damage */}
      {driver.damage && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Damage</div>
          {(
            [
              ['Front L Wing', driver.damage.frontLeftWing],
              ['Front R Wing', driver.damage.frontRightWing],
              ['Rear Wing', driver.damage.rearWing],
              ['Floor', driver.damage.floor],
              ['Sidepod', driver.damage.sidepod],
              ['Engine', driver.damage.engine],
              ['Gearbox', driver.damage.gearbox],
            ] as [string, number][]
          ).map(([name, val]) => (
            <div key={name} className={styles.damageRow}>
              <span>{name}</span>
              <span className={`${styles.damageValue} ${dmgClass(val)}`}>{val}%</span>
            </div>
          ))}
          {driver.damage.drsFault && <div className={styles.damageRow}>DRS Fault</div>}
          {driver.damage.ersFault && <div className={styles.damageRow}>ERS Fault</div>}
        </div>
      )}

      {/* Fuel */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Fuel</div>
        <div className={styles.statRow}>
          <span>In Tank</span>
          <span className={styles.statValue}>{driver.fuelInTank.toFixed(2)} kg</span>
        </div>
        <div className={styles.statRow}>
          <span>Remaining</span>
          <span className={styles.statValue}>{driver.fuelRemainingLaps.toFixed(1)} laps</span>
        </div>
        <div className={styles.statRow}>
          <span>Mix</span>
          <span className={styles.statValue}>{FUEL_MIX_NAMES[driver.fuelMix] ?? driver.fuelMix}</span>
        </div>
      </div>

      {/* ERS */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>ERS</div>
        <div className={styles.statRow}>
          <span>Store</span>
          <span className={styles.statValue}>{ersPercent.toFixed(0)}%</span>
        </div>
        <div className={styles.bar}>
          <div
            className={styles.barFill}
            style={{
              width: `${Math.min(ersPercent, 100)}%`,
              background: ersPercent > 50 ? 'var(--green)' : ersPercent > 20 ? 'var(--yellow)' : 'var(--red)',
            }}
          />
        </div>
        <div className={styles.statRow}>
          <span>Mode</span>
          <span className={styles.statValue}>{ERS_MODE_NAMES[driver.ersDeployMode] ?? driver.ersDeployMode}</span>
        </div>
      </div>
    </div>
  );
}
