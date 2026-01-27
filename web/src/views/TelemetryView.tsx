import type { PitwallState } from '../types/telemetry';
import { TireStatus } from '../components/pitwall/TireStatus';
import { FuelStrategy } from '../components/pitwall/FuelStrategy';
import { DamageVisualizer } from '../components/pitwall/DamageVisualizer';
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
      <section className={styles.fuelSection}>
        <FuelStrategy
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
          session={pitwallState?.session ?? null}
        />
      </section>
      <section className={styles.damageSection}>
        <DamageVisualizer
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </section>
    </div>
  );
}
