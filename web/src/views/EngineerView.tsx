import { useMemo } from 'react';
import type { LapDataResponse, PitwallState } from '../types/telemetry';
import { calculateSectorBoundaries } from '../utils/trackUtils';
import { EnhancedSpeedChart } from '../components/engineer/EnhancedSpeedChart';
import { EnhancedInputsChart } from '../components/engineer/EnhancedInputsChart';
import { EnhancedDeltaChart } from '../components/engineer/EnhancedDeltaChart';
import styles from './EngineerView.module.css';

interface EngineerViewProps {
  lapData: LapDataResponse | null;
  pitwallState: PitwallState | null;
}

export function EngineerView({ lapData, pitwallState }: EngineerViewProps) {
  const bestPoints = lapData?.bestLap?.dataPoints ?? null;
  const currentPoints = lapData?.currentLap ?? null;

  const sectorBoundaries = useMemo(() => {
    const trackLength = pitwallState?.session?.trackLength;
    if (!trackLength || trackLength <= 0) return undefined;
    return calculateSectorBoundaries(trackLength);
  }, [pitwallState?.session?.trackLength]);

  return (
    <div className={styles.engineer}>
      <section className={styles.chart}>
        <EnhancedSpeedChart
          bestLapPoints={bestPoints}
          currentLapPoints={currentPoints}
          sectorBoundaries={sectorBoundaries}
          height={300}
        />
      </section>
      <section className={styles.chart}>
        <EnhancedInputsChart
          bestLapPoints={bestPoints}
          currentLapPoints={currentPoints}
          sectorBoundaries={sectorBoundaries}
          height={250}
        />
      </section>
      <section className={styles.chart}>
        <EnhancedDeltaChart
          bestLapPoints={bestPoints}
          currentLapPoints={currentPoints}
          sectorBoundaries={sectorBoundaries}
          height={200}
        />
      </section>
    </div>
  );
}
