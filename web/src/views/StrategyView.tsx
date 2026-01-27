import type { PitwallState } from '../types/telemetry';
import { TrackMap } from '../components/pitwall/TrackMap';
import { WeatherWidget } from '../components/pitwall/WeatherWidget';
import { PitStrategy } from '../components/pitwall/PitStrategy';
import styles from './StrategyView.module.css';

interface StrategyViewProps {
  pitwallState: PitwallState | null;
}

export function StrategyView({ pitwallState }: StrategyViewProps) {
  return (
    <div className={styles.strategy}>
      <section className={styles.trackSection}>
        <TrackMap
          positions={pitwallState?.positions ?? []}
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </section>
      <section className={styles.weatherSection}>
        <WeatherWidget session={pitwallState?.session ?? null} />
      </section>
      <section className={styles.pitSection}>
        <PitStrategy
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
          session={pitwallState?.session ?? null}
        />
      </section>
    </div>
  );
}
