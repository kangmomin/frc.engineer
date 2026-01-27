import { memo } from 'react';
import { TelemetryData, ConnectionState } from '../types/telemetry';
import { Speedometer } from './Speedometer';
import { GearIndicator } from './GearIndicator';
import { RPMBar } from './RPMBar';
import { PedalInputs } from './PedalInputs';
import { DeltaDisplay } from './DeltaDisplay';
import { LapInfo } from './LapInfo';
import { StatusIndicators } from './StatusIndicators';
import styles from './Dashboard.module.css';

interface DashboardProps {
  data: TelemetryData;
  connectionState: ConnectionState;
  onReconnect: () => void;
}

export const Dashboard = memo(function Dashboard({
  data,
  connectionState,
  onReconnect,
}: DashboardProps) {
  return (
    <div className={styles.container}>
      {/* Connection Status */}
      <div className={styles.connectionBar}>
        <div className={styles.connectionIndicator}>
          <div className={`${styles.connectionDot} ${styles[connectionState]}`} />
          <span>
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
              ? 'Connecting...'
              : 'Disconnected'}
          </span>
        </div>
        {(connectionState === 'disconnected' || connectionState === 'error') && (
          <button className={styles.reconnectBtn} onClick={onReconnect}>
            Reconnect
          </button>
        )}
      </div>

      {/* Status Indicators (Top) */}
      <div className={styles.statusRow}>
        <StatusIndicators
          drs={data.drs}
          sector={data.sector}
          lapInvalid={data.lapInvalid}
        />
      </div>

      {/* RPM Bar */}
      <div className={styles.rpmRow}>
        <RPMBar rpm={data.rpm} revLights={data.revLights} />
      </div>

      {/* Main Display Row */}
      <div className={styles.mainRow}>
        <div className={styles.panel}>
          <DeltaDisplay
            deltaPersonalBest={data.deltaPersonalBest}
            deltaCarInFront={data.deltaCarInFront}
          />
        </div>
        <div className={styles.centerPanel}>
          <Speedometer speed={data.speed} />
        </div>
        <div className={styles.panel}>
          <GearIndicator gear={data.gear} />
        </div>
      </div>

      {/* Bottom Row */}
      <div className={styles.bottomRow}>
        <div className={styles.panel}>
          <PedalInputs throttle={data.throttle} brake={data.brake} />
        </div>
        <div className={styles.panel}>
          <LapInfo
            currentLap={data.currentLap}
            currentLapTime={data.currentLapTime}
            lastLapTime={data.lastLapTime}
            bestLapTime={data.bestLapTime}
            position={data.position}
          />
        </div>
      </div>
    </div>
  );
});
