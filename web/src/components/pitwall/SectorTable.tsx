import { useMemo } from 'react';
import { formatLapTime } from '../../utils/formatters';
import type { LapTelemetry, TelemetryData } from '../../types/telemetry';
import styles from './SectorTable.module.css';

interface SectorTableProps {
  currentData: TelemetryData;
  bestLap: LapTelemetry | null;
}

export function SectorTable({ currentData, bestLap }: SectorTableProps) {
  const sectors = useMemo(() => {
    const bestS1 = bestLap?.sector1Ms ?? 0;
    const bestS2 = bestLap?.sector2Ms ?? 0;
    const bestS3 = bestLap?.sector3Ms ?? 0;
    const bestTotal = bestLap?.lapTimeMs ?? 0;

    return [
      {
        name: 'S1',
        best: bestS1,
        current: currentData.sector === 0 ? currentData.currentLapTime : 0,
        isActive: currentData.sector === 0,
      },
      {
        name: 'S2',
        best: bestS2,
        current: currentData.sector === 1 ? currentData.currentLapTime : 0,
        isActive: currentData.sector === 1,
      },
      {
        name: 'S3',
        best: bestS3,
        current: currentData.sector === 2 ? currentData.currentLapTime : 0,
        isActive: currentData.sector === 2,
      },
      {
        name: 'Total',
        best: bestTotal,
        current: currentData.currentLapTime,
        isActive: false,
      },
    ];
  }, [currentData, bestLap]);

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <span className={styles.headerCell}>Sector</span>
        <span className={styles.headerCell}>Best</span>
        <span className={styles.headerCell}>Current</span>
      </div>
      {sectors.map((sector) => (
        <div
          key={sector.name}
          className={`${styles.row} ${sector.isActive ? styles.active : ''}`}
        >
          <span className={styles.sectorName}>{sector.name}</span>
          <span className={styles.time}>
            {sector.best > 0 ? formatLapTime(sector.best) : '--:--.---'}
          </span>
          <span className={styles.time}>
            {sector.current > 0 ? formatLapTime(sector.current) : '--:--.---'}
          </span>
        </div>
      ))}
    </div>
  );
}
