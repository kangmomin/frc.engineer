import { SCWindowAlert } from '../components/strategy/SCWindowAlert';
import { DirectCombatAdvisor } from '../components/strategy/DirectCombatAdvisor';
import { PaceDeltaChart } from '../components/strategy/PaceDeltaChart';
import { MasterStrategyBoard } from '../components/strategy/MasterStrategyBoard';
import { useTelemetryStore } from '../store/telemetryStore';
import styles from './StrategyView.module.css';

export function StrategyView() {
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const playbackActive = useTelemetryStore((state) => state.playbackActive);

  return (
    <div className={styles.container}>
      <SCWindowAlert />
      
      <div className={styles.strategyContent}>
        <div className={styles.leftColumn}>
          <DirectCombatAdvisor />
          <PaceDeltaChart />
        </div>
        
        <div className={styles.rightColumn}>
          <MasterStrategyBoard />
        </div>
      </div>

      {connectionState !== 'connected' && !playbackActive && (
        <div className={styles.connectionOverlay}>
          <div className={styles.connectionMessage}>
            <div className={`${styles.connectionDot} ${styles[connectionState]}`} />
            <span>
              {connectionState === 'connecting' && '연결 중...'}
              {connectionState === 'disconnected' && '연결 끊김 - 재연결 중...'}
              {connectionState === 'error' && '연결 오류'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
