import type { TelemetryData, LapDataResponse, LapTelemetry } from '../types/telemetry';
import { CompactDataPanel } from '../components/pitwall/CompactDataPanel';
import { SectorTable } from '../components/pitwall/SectorTable';
import styles from './CockpitView.module.css';

interface CockpitViewProps {
  data: TelemetryData;
  lapData: LapDataResponse | null;
}

export function CockpitView({ data, lapData }: CockpitViewProps) {
  const bestLap: LapTelemetry | null = lapData?.bestLap ?? null;

  return (
    <div className={styles.cockpit}>
      <section className={styles.dataPanel}>
        <CompactDataPanel data={data} />
      </section>

      <section className={styles.sectorArea}>
        <SectorTable currentData={data} bestLap={bestLap} />
      </section>
    </div>
  );
}
