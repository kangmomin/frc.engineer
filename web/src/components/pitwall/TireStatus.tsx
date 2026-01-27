import { DriverInfo } from '../../types/telemetry';
import styles from './TireStatus.module.css';

interface TireStatusProps {
  drivers: DriverInfo[];
  playerIndex: number;
}

const COMPOUND_COLORS: Record<string, string> = {
  soft: '#DC0000',
  medium: '#FFF200',
  hard: '#FFFFFF',
  inter: '#00FF00',
  wet: '#0090FF',
};

// F1 data order: [RL, RR, FL, FR]
const TIRE_POSITIONS = [
  { label: 'FL', dataIndex: 2 },
  { label: 'FR', dataIndex: 3 },
  { label: 'RL', dataIndex: 0 },
  { label: 'RR', dataIndex: 1 },
];

function getTempColor(temp: number): string {
  if (temp < 80) return '#22c55e';
  if (temp <= 100) {
    // Green to yellow interpolation
    const t = (temp - 80) / 20;
    const r = Math.round(34 + t * (234 - 34));
    const g = Math.round(197 - t * (197 - 194));
    const b = Math.round(94 - t * 94);
    return `rgb(${r},${g},${b})`;
  }
  return '#ef4444';
}

function getWearColor(wear: number): string {
  if (wear < 30) return '#22c55e';
  if (wear <= 60) return '#eab308';
  return '#ef4444';
}

export function TireStatus({ drivers, playerIndex }: TireStatusProps) {
  const driver = drivers[playerIndex];

  if (!driver?.tireCompound) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>TIRE STATUS</div>
        <div className={styles.noData}>No tire data</div>
      </div>
    );
  }

  const compound = driver.tireCompound.toLowerCase();
  const compoundColor = COMPOUND_COLORS[compound] ?? '#FFFFFF';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>TIRE STATUS</div>
      <div className={styles.compoundRow}>
        <span className={styles.compoundName} style={{ color: compoundColor }}>
          {driver.tireCompound.toUpperCase()}
        </span>
        <span className={styles.tireAge}>{driver.tireAge} laps</span>
      </div>
      <div className={styles.tireGrid}>
        {TIRE_POSITIONS.map(({ label, dataIndex }) => {
          const temp = driver.tireTemp[dataIndex];
          const wear = driver.tireWear[dataIndex];
          return (
            <div
              key={label}
              className={styles.tire}
              style={{ borderColor: getTempColor(temp) }}
            >
              <span className={styles.tireLabel}>{label}</span>
              <span className={styles.tireTemp} style={{ color: getTempColor(temp) }}>
                {Math.round(temp)}°C
              </span>
              <span className={styles.tireWear} style={{ color: getWearColor(wear) }}>
                {Math.round(wear)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
