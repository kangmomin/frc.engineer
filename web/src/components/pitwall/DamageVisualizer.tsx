import type { DriverInfo } from '../../types/telemetry';
import styles from './DamageVisualizer.module.css';

interface DamageVisualizerProps {
  drivers: DriverInfo[];
  playerIndex: number;
}

function getDamageColor(pct: number): string {
  if (pct <= 20) return '#22c55e';
  if (pct <= 50) return '#eab308';
  return '#ef4444';
}

interface DamageZone {
  label: string;
  value: number;
  className: string;
}

export function DamageVisualizer({ drivers, playerIndex }: DamageVisualizerProps) {
  const driver = drivers[playerIndex];
  const damage = driver?.damage;

  if (!damage) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>CAR DAMAGE</div>
        <div className={styles.noData}>No damage data</div>
      </div>
    );
  }

  const zones: DamageZone[] = [
    { label: 'FL Wing', value: damage.frontLeftWing, className: styles.frontLeftWing },
    { label: 'FR Wing', value: damage.frontRightWing, className: styles.frontRightWing },
    { label: 'Rear Wing', value: damage.rearWing, className: styles.rearWing },
    { label: 'Floor', value: damage.floor, className: styles.floor },
    { label: 'Diffuser', value: damage.diffuser, className: styles.diffuser },
    { label: 'Sidepod', value: damage.sidepod, className: styles.sidepod },
  ];

  const mechanical = [
    { label: 'Engine', value: damage.engine },
    { label: 'Gearbox', value: damage.gearbox },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>CAR DAMAGE</div>

      <div className={styles.carDiagram}>
        <div className={styles.carBody} />
        {zones.map((z) => (
          <div
            key={z.label}
            className={`${styles.zone} ${z.className}`}
            style={{ color: getDamageColor(z.value), background: `${getDamageColor(z.value)}22` }}
          >
            {z.value}%
          </div>
        ))}
      </div>

      <div className={styles.componentList}>
        {[...zones, ...mechanical].map((c) => (
          <div key={c.label} className={styles.component}>
            <span className={styles.componentLabel}>{c.label}</span>
            <span className={styles.componentValue} style={{ color: getDamageColor(c.value) }}>
              {c.value}%
            </span>
          </div>
        ))}
      </div>

      <div className={styles.faultRow}>
        <span className={`${styles.faultBadge} ${damage.drsFault ? styles.faultActive : styles.faultOk}`}>
          DRS {damage.drsFault ? 'FAULT' : 'OK'}
        </span>
        <span className={`${styles.faultBadge} ${damage.ersFault ? styles.faultActive : styles.faultOk}`}>
          ERS {damage.ersFault ? 'FAULT' : 'OK'}
        </span>
      </div>
    </div>
  );
}
