import { useMemo } from 'react';
import { DriverInfo, CarDamage } from '../../../types/telemetry';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './StrategyHealthSection.module.css';

// Typical pit stop time in seconds (pit lane entry to exit)
const PIT_STOP_TIME_SECONDS = 22;

interface PitSimulationResult {
  currentPosition: number;
  estimatedPosition: number;
  positionsLost: number;
  nearbyDrivers: Array<{
    name: string;
    position: number;
    gap: number;
    wouldOvertake: boolean;
  }>;
}

function calculatePitSimulation(
  driver: DriverInfo,
  drivers: DriverInfo[]
): PitSimulationResult {
  const currentPosition = driver.position;
  const sortedDrivers = [...drivers].sort((a, b) => a.position - b.position);

  // Find drivers behind that could overtake during pit stop
  const driversBehind = sortedDrivers.filter(d => d.position > currentPosition);

  let estimatedPosition = currentPosition;
  const nearbyDrivers: PitSimulationResult['nearbyDrivers'] = [];

  for (const d of driversBehind) {
    // Calculate cumulative gap to this driver
    const cumulativeGap = getCumulativeGap(driver, d, sortedDrivers);

    const wouldOvertake = cumulativeGap < PIT_STOP_TIME_SECONDS;

    if (wouldOvertake) {
      estimatedPosition++;
    }

    // Only show drivers within relevant range (up to 5 positions behind)
    if (d.position <= currentPosition + 5) {
      nearbyDrivers.push({
        name: d.name,
        position: d.position,
        gap: cumulativeGap,
        wouldOvertake,
      });
    }
  }

  return {
    currentPosition,
    estimatedPosition,
    positionsLost: estimatedPosition - currentPosition,
    nearbyDrivers,
  };
}

// Calculate cumulative gap between two drivers (returns seconds)
function getCumulativeGap(
  driver: DriverInfo,
  behindDriver: DriverInfo,
  sortedDrivers: DriverInfo[]
): number {
  let gap = 0;
  for (const d of sortedDrivers) {
    if (d.position > driver.position && d.position <= behindDriver.position) {
      // deltaToCarInFront is in milliseconds from backend, convert to seconds
      const gapSec = d.deltaToCarInFront != null && d.deltaToCarInFront > 0
        ? d.deltaToCarInFront / 1000
        : 1.5; // Default 1.5s if no data
      gap += gapSec;
    }
  }
  return gap;
}

// Damage component display configuration
const DAMAGE_COMPONENTS: Array<{
  key: keyof CarDamage;
  label: string;
  shortLabel: string;
}> = [
    { key: 'frontLeftWing', label: 'Front Left Wing', shortLabel: 'FL Wing' },
    { key: 'frontRightWing', label: 'Front Right Wing', shortLabel: 'FR Wing' },
    { key: 'rearWing', label: 'Rear Wing', shortLabel: 'Rear Wing' },
    { key: 'floor', label: 'Floor', shortLabel: 'Floor' },
    { key: 'diffuser', label: 'Diffuser', shortLabel: 'Diffuser' },
    { key: 'sidepod', label: 'Sidepod', shortLabel: 'Sidepod' },
    { key: 'engine', label: 'Engine', shortLabel: 'Engine' },
    { key: 'gearbox', label: 'Gearbox', shortLabel: 'Gearbox' },
  ];

function getDamageColor(value: number): string {
  if (value < 20) return 'var(--accent-green)';
  if (value <= 50) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}

function getDamageLevel(value: number): 'safe' | 'warning' | 'danger' {
  if (value < 20) return 'safe';
  if (value <= 50) return 'warning';
  return 'danger';
}

interface DamageBarProps {
  label: string;
  value: number;
}

function DamageBar({ label, value }: DamageBarProps) {
  const level = getDamageLevel(value);
  const color = getDamageColor(value);

  return (
    <div className={styles.damageItem}>
      <div className={styles.damageHeader}>
        <span className={styles.damageLabel}>{label}</span>
        <span className={`${styles.damageValue} ${styles[level]}`}>
          {value.toFixed(0)}%
        </span>
      </div>
      <div className={styles.damageBar}>
        <div
          className={styles.damageFill}
          style={{
            width: `${Math.min(100, value)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

interface FaultIndicatorProps {
  label: string;
  active: boolean;
}

function FaultIndicator({ label, active }: FaultIndicatorProps) {
  return (
    <div className={`${styles.faultIndicator} ${active ? styles.faultActive : ''}`}>
      <span className={styles.faultLabel}>{label}</span>
      <span className={styles.faultStatus}>
        {active ? 'FAULT' : 'OK'}
      </span>
    </div>
  );
}

export function StrategyHealthSection() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const drivers = pitwallState?.drivers ?? [];
  const session = pitwallState?.session ?? null;
  const driver = drivers.find(d => d.index === pitwallState?.playerIndex) ?? null;
  const pitSimulation = useMemo(() => {
    if (!driver || drivers.length === 0) return null;
    return calculatePitSimulation(driver, drivers);
  }, [driver, drivers]);

  const damage = driver?.damage;
  const hasAnyDamage = damage && DAMAGE_COMPONENTS.some(
    c => (damage[c.key] as number) > 0
  );
  const hasFaults = damage && (damage.drsFault || damage.ersFault);

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Strategy & Health"
        subtitle={session?.sessionType || undefined}
      />

      <div className={styles.content}>
        {/* Pit Simulation Section */}
        <div className={styles.pitSection}>
          <div className={styles.pitHeader}>
            <span className={styles.pitLabel}>PIT SIMULATION</span>
          </div>

          {pitSimulation ? (
            <div className={styles.pitContent}>
              <div className={styles.pitResult}>
                <span className={styles.pitNow}>Pit Now:</span>
                <span className={styles.positionChange}>
                  <span className={styles.currentPos}>
                    P{pitSimulation.currentPosition}
                  </span>
                  <span className={styles.arrow}>&rarr;</span>
                  <span
                    className={`${styles.estimatedPos} ${pitSimulation.positionsLost > 0 ? styles.posLost : ''
                      }`}
                  >
                    P{pitSimulation.estimatedPosition}
                  </span>
                </span>
                {pitSimulation.positionsLost > 0 && (
                  <span className={styles.positionsLostBadge}>
                    -{pitSimulation.positionsLost}
                  </span>
                )}
              </div>

              {pitSimulation.nearbyDrivers.length > 0 && (
                <div className={styles.nearbyDrivers}>
                  {pitSimulation.nearbyDrivers.map((d) => (
                    <div
                      key={d.position}
                      className={`${styles.nearbyDriver} ${d.wouldOvertake ? styles.wouldOvertake : ''
                        }`}
                    >
                      <span className={styles.nearbyPos}>P{d.position}</span>
                      <span className={styles.nearbyName}>{d.name}</span>
                      <span className={styles.nearbyGap}>
                        +{d.gap.toFixed(1)}s
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.noData}>No driver selected</div>
          )}
        </div>

        {/* Car Health Monitor Section */}
        <div className={styles.healthSection}>
          <div className={styles.healthHeader}>
            <span className={styles.healthLabel}>CAR HEALTH</span>
            {!hasAnyDamage && !hasFaults && damage && (
              <span className={styles.allClearBadge}>ALL CLEAR</span>
            )}
          </div>

          {damage ? (
            <div className={styles.healthContent}>
              {/* Fault Indicators */}
              <div className={styles.faultRow}>
                <FaultIndicator label="DRS" active={damage.drsFault} />
                <FaultIndicator label="ERS" active={damage.ersFault} />
              </div>

              {/* Damage Grid */}
              <div className={styles.damageGrid}>
                {DAMAGE_COMPONENTS.map((component) => (
                  <DamageBar
                    key={component.key}
                    label={component.shortLabel}
                    value={damage[component.key] as number}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.noData}>No damage data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
