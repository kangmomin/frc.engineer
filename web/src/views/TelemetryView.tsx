import type { PitwallState } from '../types/telemetry';
import { TireStatus } from '../components/pitwall/TireStatus';
import styles from './TelemetryView.module.css';

interface TelemetryViewProps {
  pitwallState: PitwallState | null;
}

export function TelemetryView({ pitwallState }: TelemetryViewProps) {
  return (
    <div className={styles.telemetry}>
      <section className={styles.tireSection}>
        <TireStatus
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </section>
    </div>
  );
}
