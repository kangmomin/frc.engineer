import { useMemo, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DriverInfo, BattleAlert } from '../../../types/telemetry';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './BattleControlsSection.module.css';

const ERS_MODES: Record<number, string> = { 0: 'None', 1: 'Low', 2: 'Med', 3: 'Overtake', 4: 'Hotlap' };
const MAX_ERS_ENERGY = 4000000;

// --- Stable Selectors ---

const selectPlayerIndex = (s: any) => s.pitwallState?.playerIndex ?? 0;
const selectBattleAlerts = (s: any) => s.battleAlerts;
const selectDrivers = (s: any) => s.pitwallState?.drivers ?? [];

// --- Sub-components ---

const CarControlsHUD = memo(({ driver }: { driver: DriverInfo | null }) => {
  if (!driver) return <div className={styles.noData}>Waiting for telemetry...</div>;

  const ersPct = (driver.ersStoreEnergy / MAX_ERS_ENERGY) * 100;
  const ersMode = ERS_MODES[driver.ersDeployMode] ?? '???';
  const ersColor = ersPct > 60 ? 'var(--accent-green)' : ersPct > 30 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  const fuelColor = driver.fuelRemainingLaps > 5 ? 'var(--accent-green)' : driver.fuelRemainingLaps > 2 ? 'var(--accent-yellow)' : 'var(--accent-red)';

  return (
    <div className={styles.controlsGrid}>
      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>ERS</span>
          <span className={styles.controlMode} style={{ color: ersColor }}>{ersMode}</span>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.min(ersPct, 100)}%`, backgroundColor: ersColor }} />
        </div>
        <span className={styles.controlValue}>{ersPct.toFixed(1)}%</span>
      </div>

      <div className={styles.controlItem}>
        <div className={styles.controlHeader}>
          <span className={styles.controlLabel}>FUEL</span>
          <span className={styles.controlMode} style={{ color: fuelColor }}>{driver.fuelRemainingLaps.toFixed(2)} L</span>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.min((driver.fuelRemainingLaps / 10) * 100, 100)}%`, backgroundColor: fuelColor }} />
        </div>
        <span className={styles.controlValue}>{driver.fuelInTank.toFixed(1)} KG</span>
      </div>

      <div className={styles.controlItem}>
        <span className={styles.controlLabel}>BRAKE BIAS</span>
        <span className={styles.controlValueLarge}>{driver.brakeBias > 0 ? `${driver.brakeBias}%` : '--'}</span>
      </div>

      <div className={styles.controlItem}>
        <span className={styles.controlLabel}>DIFF (ON/OFF)</span>
        <div className={styles.controlValueLarge}>
          {driver.diffOnThrottle > 0 ? `${driver.diffOnThrottle}/${driver.diffOffThrottle}%` : '--'}
        </div>
      </div>
    </div>
  );
});

const BattleCard = memo(({ title, otherDriver, gap, alert, isAhead }: { 
  title: string; 
  otherDriver: DriverInfo | null; 
  gap?: number; 
  alert?: BattleAlert; 
  isAhead: boolean;
}) => {
  const trend = alert ? (alert.closingRatePerLap > 0.1 ? 'closing' : alert.closingRatePerLap < -0.1 ? 'pulling' : 'neutral') : 'neutral';
  const arrow = trend === 'closing' ? '▼' : trend === 'pulling' ? '▲' : '';

  return (
    <div className={styles.battleCard}>
      <span className={styles.battleCardTitle}>{title}</span>
      {otherDriver ? (
        <>
          <div className={styles.battleDriverInfo}>
            <span className={styles.battlePosition}>P{otherDriver.position}</span>
            <span className={styles.battleName}>{formatDriverName(otherDriver.name, otherDriver.index)}</span>
          </div>
          <div className={`${styles.gapDisplay} ${styles[trend]}`}>
            <span className={styles.gapValue}>
              {gap !== undefined && gap > 0 ? `${isAhead ? '+' : '-'}${(gap / 1000).toFixed(3)}` : '--'}
            </span>
            {arrow && <span className={styles.trendArrow}>{arrow}</span>}
          </div>
          {alert && alert.estOvertakeLap > 0 && (
            <div className={styles.overtakeEstimate}>
              <span className={styles.overtakeLabel}>EST. OVERTAKE</span>
              <span className={styles.overtakeLap}>LAP {alert.estOvertakeLap}</span>
            </div>
          )}
        </>
      ) : (
        <div className={styles.noCarData}>{isAhead ? 'LEADER' : 'LAST'}</div>
      )}
    </div>
  );
});

export function BattleControlsSection() {
  const playerIdx = useTelemetryStore(selectPlayerIndex);
  const battleAlerts = useTelemetryStore(useShallow(selectBattleAlerts));
  const drivers = useTelemetryStore(useShallow(selectDrivers));
  
  // Find player driver object from the stable drivers array
  const driver = useMemo(() => {
    return drivers.find((d: DriverInfo) => d.index === playerIdx) ?? null;
  }, [drivers, playerIdx]);

  const { carAhead, carBehind } = useMemo(() => {
    if (!driver || drivers.length === 0) return { carAhead: null, carBehind: null };
    const sorted = [...drivers].sort((a, b) => a.position - b.position);
    return {
      carAhead: sorted.find(d => d.position === driver.position - 1) ?? null,
      carBehind: sorted.find(d => d.position === driver.position + 1) ?? null,
    };
  }, [driver, drivers]);

  return (
    <div className={styles.container}>
      <SectionHeader title="Battle Controls" subtitle={driver ? formatDriverName(driver.name, driver.index) : 'NO DATA'} />
      <div className={styles.content}>
        <CarControlsHUD driver={driver} />
        <div className={styles.battleContainer}>
          <BattleCard title="CAR AHEAD" otherDriver={carAhead} gap={driver?.deltaToCarInFront} alert={battleAlerts.find((a: BattleAlert) => a.side === 'ahead')} isAhead={true} />
          <div className={styles.currentDriver}>
            <span className={styles.positionBadge}>P{driver?.position ?? '--'}</span>
            <span className={styles.driverAbbrev}>{driver ? formatDriverName(driver.name, driver.index) : '---'}</span>
          </div>
          <BattleCard title="CAR BEHIND" otherDriver={carBehind} gap={carBehind?.deltaToCarInFront} alert={battleAlerts.find((a: BattleAlert) => a.side === 'behind')} isAhead={false} />
        </div>
      </div>
    </div>
  );
}

function formatDriverName(fullName: string, carIndex?: number): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return carIndex !== undefined ? `P${carIndex}` : 'PLY';
  const parts = trimmed.split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : trimmed).substring(0, 3).toUpperCase();
}
