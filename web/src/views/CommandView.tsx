import type { PitwallState } from '../types/telemetry';
import { PitWindowPredictor } from '../components/command/PitWindowPredictor';
import { BattleGapChart } from '../components/command/BattleGapChart';
import { StrategyBoard } from '../components/command/StrategyBoard';
import { TrackMap } from '../components/pitwall/TrackMap';
import styles from './CommandView.module.css';

interface CommandViewProps {
  pitwallState: PitwallState | null;
}

export function CommandView({ pitwallState }: CommandViewProps) {
  return (
    <div className={styles.command}>
      <PitWindowPredictor pitwallState={pitwallState} />
      <BattleGapChart pitwallState={pitwallState} />
      <StrategyBoard pitwallState={pitwallState} />
      <TrackMap
        positions={pitwallState?.positions ?? []}
        drivers={pitwallState?.drivers ?? []}
        playerIndex={pitwallState?.playerIndex ?? 0}
        trackMap={pitwallState?.trackMap}
        marshalZones={pitwallState?.session?.marshalZones}
        trackLength={pitwallState?.session?.trackLength}
      />
    </div>
  );
}
