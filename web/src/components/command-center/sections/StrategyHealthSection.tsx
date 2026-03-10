import { memo, useRef, useCallback, useSyncExternalStore } from 'react';
import type { CarDamage, DriverInfo } from '../../../types/telemetry';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './StrategyHealthSection.module.css';

const DAMAGE_COMPONENTS: Array<{ key: keyof CarDamage; label: string }> = [
  { key: 'frontLeftWing', label: 'FL WING' },
  { key: 'frontRightWing', label: 'FR WING' },
  { key: 'rearWing', label: 'REAR WING' },
  { key: 'floor', label: 'FLOOR' },
  { key: 'diffuser', label: 'DIFFUSER' },
  { key: 'sidepod', label: 'SIDEPOD' },
  { key: 'engine', label: 'ENGINE' },
  { key: 'gearbox', label: 'GEARBOX' },
];

// --- Performance Utilities ---

function useStoreWithEq<T>(
  selector: (state: ReturnType<typeof useTelemetryStore.getState>) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const prev = useRef<T>(selector(useTelemetryStore.getState()));
  const getSnapshot = useCallback(() => {
    const next = selector(useTelemetryStore.getState());
    if (isEqual(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  }, [selector, isEqual]);
  return useSyncExternalStore(useTelemetryStore.subscribe, getSnapshot);
}

// --- Stable Selectors ---

const selectPlayerData = (s: ReturnType<typeof useTelemetryStore.getState>) => {
  const idx = s.pitwallState?.playerIndex ?? 0;
  return s.pitwallState?.drivers.find(d => d.index === idx) ?? null;
};

function playerDamageEqual(a: DriverInfo | null, b: DriverInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a.damage) === JSON.stringify(b.damage);
}

// --- Sub-components ---

const DamageBar = memo(({ label, value }: { label: string; value: number }) => {
  const color = value < 20 ? 'var(--accent-green)' : value <= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  return (
    <div className={styles.damageItem}>
      <div className={styles.damageHeader}>
        <span className={styles.damageLabel}>{label}</span>
        <span className={styles.damageValue} style={{ color }}>{value.toFixed(0)}%</span>
      </div>
      <div className={styles.damageBar}>
        <div className={styles.damageFill} style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
});

const FaultIndicator = memo(({ label, active }: { label: string; active: boolean }) => (
  <div className={`${styles.faultIndicator} ${active ? styles.faultActive : ''}`}>
    <span className={styles.faultLabel}>{label}</span>
    <span className={styles.faultStatus}>{active ? 'FAULT' : 'OK'}</span>
  </div>
));

export function StrategyHealthSection() {
  const driver = useStoreWithEq(selectPlayerData, playerDamageEqual);

  if (!driver) {
    return (
      <div className={styles.container}>
        <SectionHeader title="VEHICLE STATUS" />
        <div className={styles.noData}>Waiting for telemetry...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <SectionHeader title="VEHICLE STATUS" />

      <div className={styles.damageContentOnly}>
        <div className={styles.faultRow}>
          <FaultIndicator label="DRS" active={driver.damage?.drsFault ?? false} />
          <FaultIndicator label="ERS" active={driver.damage?.ersFault ?? false} />
        </div>
        
        <div className={styles.damageGrid}>
          {DAMAGE_COMPONENTS.map(c => (
            <DamageBar 
              key={c.key} 
              label={c.label} 
              value={(driver.damage as any)?.[c.key] ?? 0} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
