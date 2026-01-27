import type { TelemetryData, LapDataResponse, LapTelemetry } from '../types/telemetry';
import { CompactDataPanel } from '../components/pitwall/CompactDataPanel';
import { SpeedChart } from '../components/pitwall/SpeedChart';
import { InputsChart } from '../components/pitwall/InputsChart';
import { DeltaChart } from '../components/pitwall/DeltaChart';
import { SectorTable } from '../components/pitwall/SectorTable';
import styles from './CockpitView.module.css';

interface CockpitViewProps {
  data: TelemetryData;
  lapData: LapDataResponse | null;
}

export function CockpitView({ data, lapData }: CockpitViewProps) {
  const bestPoints = lapData?.bestLap?.dataPoints ?? null;
  const currentPoints = lapData?.currentLap ?? null;
  const bestLap: LapTelemetry | null = lapData?.bestLap ?? null;

  return (
    <div className={styles.cockpit}>
      <section className={styles.dataPanel}>
        <CompactDataPanel data={data} />
      </section>

      <section className={styles.primaryChart}>
        <SpeedChart
          bestLapPoints={bestPoints}
          currentLapPoints={currentPoints}
          height={250}
        />
      </section>

      <div className={styles.secondaryCharts}>
        <section className={styles.secondaryChart}>
          <InputsChart
            bestLapPoints={bestPoints}
            currentLapPoints={currentPoints}
            height={150}
          />
        </section>
        <section className={styles.secondaryChart}>
          <DeltaChart
            bestLapPoints={bestPoints}
            currentLapPoints={currentPoints}
            height={150}
          />
        </section>
      </div>

      <section className={styles.sectorArea}>
        <SectorTable currentData={data} bestLap={bestLap} />
      </section>
    </div>
  );
}
