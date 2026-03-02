import { useTelemetryStore } from '../../store/telemetryStore';
import { TrackMapSection } from './sections/TrackMapSection';
import { LeaderboardSection } from './sections/LeaderboardSection';
import { PaceAnalysisSection } from './sections/PaceAnalysisSection';
import { BattleControlsSection } from './sections/BattleControlsSection';
import { TyreEngineeringSection } from './sections/TyreEngineeringSection';
import { StrategyHealthSection } from './sections/StrategyHealthSection';
import { RaceResultModal } from './RaceResultModal';
import styles from './CommandCenter.module.css';

export function CommandCenter() {
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const playbackActive = useTelemetryStore((state) => state.playbackActive);

  return (
    <div className={styles.grid}>
      {/* Row 1 */}
      <div className={`${styles.cell} ${styles.trackMap}`}>
        <TrackMapSection />
      </div>
      <div className={`${styles.cell} ${styles.paceAnalysis}`}>
        <PaceAnalysisSection />
      </div>
      <div className={`${styles.cell} ${styles.tyreEngineering}`}>
        <TyreEngineeringSection />
      </div>

      {/* Row 2 */}
      <div className={`${styles.cell} ${styles.leaderboard}`}>
        <LeaderboardSection />
      </div>
      <div className={`${styles.cell} ${styles.battleControls}`}>
        <BattleControlsSection />
      </div>
      <div className={`${styles.cell} ${styles.strategyHealth}`}>
        <StrategyHealthSection />
      </div>

      <RaceResultModal />

      {/* Connection overlay when disconnected */}
      {connectionState !== 'connected' && !playbackActive && (
        <div className={styles.connectionOverlay}>
          <div className={styles.connectionMessage}>
            <div className={`${styles.connectionDot} ${styles[connectionState]}`} />
            <span>
              {connectionState === 'connecting' && 'Connecting...'}
              {connectionState === 'disconnected' && 'Disconnected - Reconnecting...'}
              {connectionState === 'error' && 'Connection Error'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
