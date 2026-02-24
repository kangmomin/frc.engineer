import { useMemo } from 'react';
import type { DriverInfo, BattleAlert } from '../../../types/telemetry';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './BattleControlsSection.module.css';

// ERS deploy mode labels (F1 25: 0=None, 1=Low, 2=Medium, 3=Overtake, 4=Hotlap)
const ERS_MODES: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Med',
  3: 'Overtake',
  4: 'Hotlap',
};

// Max ERS energy in Joules (4 MJ)
const MAX_ERS_ENERGY = 4000000;

export function BattleControlsSection() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const drivers = pitwallState?.drivers ?? [];
  const driver = drivers.find(d => d.index === pitwallState?.playerIndex) ?? null;
  const battleAlerts = useTelemetryStore((state) => state.battleAlerts);

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Battle Controls"
        subtitle={driver ? formatDriverName(driver.name, driver.index) : 'No Driver'}
      />

      <div className={styles.content}>
        {/* Car Controls HUD */}
        <div className={styles.controlsHud}>
          <CarControlsHUD driver={driver} />
        </div>

        {/* Battle View */}
        <div className={styles.battleView}>
          <BattleView
            driver={driver}
            drivers={drivers}
            battleAlerts={battleAlerts}
          />
        </div>
      </div>
    </div>
  );
}

interface CarControlsHUDProps {
  driver: DriverInfo | null;
}

function CarControlsHUD({ driver }: CarControlsHUDProps) {
  if (!driver) {
    return (
      <div className={styles.noData}>
        <span>No driver data</span>
      </div>
    );
  }

  const ersPercent = (driver.ersStoreEnergy / MAX_ERS_ENERGY) * 100;
  const ersMode = ERS_MODES[driver.ersDeployMode] ?? 'Unknown';

  // Determine ERS color based on percentage
  const ersColor = getErsColor(ersPercent);

  // Fuel color based on remaining laps
  const fuelColor = getFuelColor(driver.fuelRemainingLaps);

  return (
    <div className={styles.controlsGrid}>
      {/* ERS */}
      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>ERS</span>
          <span className={styles.controlMode} style={{ color: ersColor }}>
            {ersMode}
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: `${Math.min(ersPercent, 100)}%`,
              backgroundColor: ersColor,
            }}
          />
        </div>
        <span className={styles.controlValue}>
          {ersPercent.toFixed(1)}%
        </span>
      </div>

      {/* Fuel */}
      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>Fuel</span>
          <span className={styles.controlMode} style={{ color: fuelColor }}>
            {driver.fuelRemainingLaps.toFixed(1)} Laps
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: `${Math.min((driver.fuelRemainingLaps / 10) * 100, 100)}%`,
              backgroundColor: fuelColor,
            }}
          />
        </div>
        <span className={styles.controlValue}>
          {driver.fuelInTank.toFixed(1)} kg
        </span>
      </div>

      {/* Brake Bias */}
      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>BB</span>
          <span className={styles.controlSubLabel}>Brake Bias</span>
        </div>
        <span className={styles.controlValueLarge}>
          {driver.brakeBias > 0 ? `${driver.brakeBias}%` : '--'}
        </span>
      </div>

      {/* Differential */}
      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>DIFF</span>
          <span className={styles.controlSubLabel}>Differential</span>
        </div>
        {driver.diffOnThrottle > 0 || driver.diffOffThrottle > 0 ? (
          <div className={styles.diffValues}>
            <span className={styles.controlValue}>ON {driver.diffOnThrottle}%</span>
            <span className={styles.controlValue}>OFF {driver.diffOffThrottle}%</span>
          </div>
        ) : (
          <span className={styles.controlValueLarge}>--</span>
        )}
      </div>
    </div>
  );
}

interface BattleViewProps {
  driver: DriverInfo | null;
  drivers: DriverInfo[];
  battleAlerts: BattleAlert[];
}

function BattleView({ driver, drivers, battleAlerts }: BattleViewProps) {
  // Find car ahead and behind based on position
  const { carAhead, carBehind } = useMemo(() => {
    if (!driver || drivers.length === 0) {
      return { carAhead: null, carBehind: null };
    }

    const sortedDrivers = [...drivers].sort((a, b) => a.position - b.position);
    const driverPosition = driver.position;

    const ahead = sortedDrivers.find((d) => d.position === driverPosition - 1) ?? null;
    const behind = sortedDrivers.find((d) => d.position === driverPosition + 1) ?? null;

    return { carAhead: ahead, carBehind: behind };
  }, [driver, drivers]);

  // Find gap to car behind (the car behind's delta to us)
  const gapBehind = useMemo(() => {
    if (!carBehind) return undefined;
    return carBehind.deltaToCarInFront;
  }, [carBehind]);

  // Get relevant battle alerts
  const aheadAlert = battleAlerts.find((a) => a.side === 'ahead');
  const behindAlert = battleAlerts.find((a) => a.side === 'behind');

  if (!driver) {
    return (
      <div className={styles.noData}>
        <span>No battle data</span>
      </div>
    );
  }

  return (
    <div className={styles.battleContainer}>
      {/* Car Ahead */}
      <BattleCard
        title="CAR AHEAD"
        otherDriver={carAhead}
        gap={driver.deltaToCarInFront}
        alert={aheadAlert}
        isAhead={true}
      />

      {/* Current Driver Position Indicator */}
      <div className={styles.currentDriver}>
        <span className={styles.positionBadge}>P{driver.position}</span>
        <span className={styles.driverAbbrev}>
          {formatDriverName(driver.name, driver.index)}
        </span>
      </div>

      {/* Car Behind */}
      <BattleCard
        title="CAR BEHIND"
        otherDriver={carBehind}
        gap={gapBehind}
        alert={behindAlert}
        isAhead={false}
      />
    </div>
  );
}

interface BattleCardProps {
  title: string;
  otherDriver: DriverInfo | null;
  gap: number | undefined;
  alert: BattleAlert | undefined;
  isAhead: boolean;
}

function BattleCard({ title, otherDriver, gap, alert, isAhead }: BattleCardProps) {
  // Determine gap trend based on closing rate from alert
  const gapTrend = useMemo(() => {
    if (!alert) return 'neutral';
    // If closing rate is positive, gap is decreasing (closing in)
    // If closing rate is negative, gap is increasing (pulling away)
    if (alert.closingRatePerLap > 0.1) return 'closing';
    if (alert.closingRatePerLap < -0.1) return 'pulling';
    return 'neutral';
  }, [alert]);

  const trendArrow = gapTrend === 'closing' ? '\u25BC' : gapTrend === 'pulling' ? '\u25B2' : '';
  const trendClass = gapTrend === 'closing' ? styles.closing : gapTrend === 'pulling' ? styles.pulling : '';

  return (
    <div className={styles.battleCard}>
      <span className={styles.battleCardTitle}>{title}</span>

      {otherDriver ? (
        <>
          <div className={styles.battleDriverInfo}>
            <span className={styles.battlePosition}>P{otherDriver.position}</span>
            <span className={styles.battleName}>
              {formatDriverName(otherDriver.name, otherDriver.index)}
            </span>
          </div>

          <div className={`${styles.gapDisplay} ${trendClass}`}>
            <span className={styles.gapValue}>
              {gap !== undefined && gap > 0
                ? `${isAhead ? '+' : '-'}${(gap / 1000).toFixed(3)}`
                : '--'}
            </span>
            {trendArrow && (
              <span className={styles.trendArrow}>{trendArrow}</span>
            )}
          </div>

          {alert && alert.estOvertakeLap > 0 && (
            <div className={styles.overtakeEstimate}>
              <span className={styles.overtakeLabel}>Est. Overtake</span>
              <span className={styles.overtakeLap}>Lap {alert.estOvertakeLap}</span>
            </div>
          )}
        </>
      ) : (
        <div className={styles.noCarData}>
          <span>{isAhead ? 'Leader' : 'Last'}</span>
        </div>
      )}
    </div>
  );
}

// Helper functions

function formatDriverName(fullName: string, carIndex?: number): string {
  const trimmed = fullName?.trim() ?? '';
  if (!trimmed) {
    return carIndex !== undefined ? `P${carIndex}` : 'PLY';
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return parts[parts.length - 1].substring(0, 3).toUpperCase();
  }
  return trimmed.substring(0, 3).toUpperCase();
}

function getErsColor(percent: number): string {
  if (percent > 60) return 'var(--accent-green)';
  if (percent > 30) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}

function getFuelColor(remainingLaps: number): string {
  if (remainingLaps > 5) return 'var(--accent-green)';
  if (remainingLaps > 2) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}
