import { useEffect } from 'react';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { TrackMapSection } from './sections/TrackMapSection';
import { LeaderboardSection } from './sections/LeaderboardSection';
import { PaceAnalysisSection } from './sections/PaceAnalysisSection';
import { BattleControlsSection } from './sections/BattleControlsSection';
import { TyreEngineeringSection } from './sections/TyreEngineeringSection';
import { StrategyHealthSection } from './sections/StrategyHealthSection';
import styles from './CommandCenter.module.css';

interface CommandCenterProps {
  onConnectionStateChange?: (state: string) => void;
}

export function CommandCenter({ onConnectionStateChange }: CommandCenterProps) {
  const {
    pitwallState,
    connectionState,
    raceControlNotifications,
    battleAlerts,
  } = usePitwallWebSocket();

  // Notify parent of connection state changes via useEffect to avoid side-effects during render
  useEffect(() => {
    onConnectionStateChange?.(connectionState);
  }, [connectionState, onConnectionStateChange]);

  const playerDriver = pitwallState?.drivers[pitwallState.playerIndex];

  return (
    <div className={styles.grid}>
      {/* Row 1 */}
      <div className={`${styles.cell} ${styles.trackMap}`}>
        <TrackMapSection
          session={pitwallState?.session ?? null}
          positions={pitwallState?.positions ?? []}
          drivers={pitwallState?.drivers ?? []}
          trackMap={pitwallState?.trackMap}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </div>
      <div className={`${styles.cell} ${styles.paceAnalysis}`}>
        <PaceAnalysisSection
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
          session={pitwallState?.session ?? null}
          raceControlNotifications={raceControlNotifications}
        />
      </div>
      <div className={`${styles.cell} ${styles.tyreEngineering}`}>
        <TyreEngineeringSection
          driver={playerDriver ?? null}
        />
      </div>

      {/* Row 2 */}
      <div className={`${styles.cell} ${styles.leaderboard}`}>
        <LeaderboardSection
          drivers={pitwallState?.drivers ?? []}
          session={pitwallState?.session ?? null}
          playerIndex={pitwallState?.playerIndex ?? 0}
        />
      </div>
      <div className={`${styles.cell} ${styles.battleControls}`}>
        <BattleControlsSection
          driver={playerDriver ?? null}
          drivers={pitwallState?.drivers ?? []}
          battleAlerts={battleAlerts}
        />
      </div>
      <div className={`${styles.cell} ${styles.strategyHealth}`}>
        <StrategyHealthSection
          driver={playerDriver ?? null}
          drivers={pitwallState?.drivers ?? []}
          session={pitwallState?.session ?? null}
        />
      </div>

      {/* Connection overlay when disconnected */}
      {connectionState !== 'connected' && (
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
