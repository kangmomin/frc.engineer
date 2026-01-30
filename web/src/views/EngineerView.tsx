import type { LapDataResponse, PitwallState, TelemetryData } from '../types/telemetry';
import { Leaderboard } from '../components/pitwall/Leaderboard';
import { TrackMap } from '../components/pitwall/TrackMap';
import { BattlePredictor } from '../components/engineer/BattlePredictor';
import { CarStatusPanel } from '../components/engineer/CarStatusPanel';
import styles from './EngineerView.module.css';

interface EngineerViewProps {
  lapData: LapDataResponse | null;
  pitwallState: PitwallState | null;
  data: TelemetryData;
}

export function EngineerView({ pitwallState }: EngineerViewProps) {
  if (!pitwallState) {
    return <div className={styles.loading}>Waiting for session data…</div>;
  }

  const { drivers, positions, playerIndex, trackMap, session } = pitwallState;
  const player = drivers.find((d) => d.index === playerIndex) ?? null;

  return (
    <div className={styles.station}>
      {/* Left: Timing Tower */}
      <div className={styles.left}>
        <Leaderboard drivers={drivers} playerIndex={playerIndex} />
      </div>

      {/* Center: Track + Battle */}
      <div className={styles.center}>
        <div className={styles.trackWrapper}>
          <TrackMap
            positions={positions}
            drivers={drivers}
            playerIndex={playerIndex}
            trackMap={trackMap}
            marshalZones={session?.marshalZones}
            trackLength={session?.trackLength}
          />
        </div>
        <BattlePredictor drivers={drivers} playerIndex={playerIndex} />
      </div>

      {/* Right: Car Status */}
      <div className={styles.right}>
        <CarStatusPanel driver={player} />
      </div>
    </div>
  );
}
