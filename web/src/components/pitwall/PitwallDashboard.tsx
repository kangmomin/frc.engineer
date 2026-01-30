import { useEffect, useCallback } from 'react';
import type { TelemetryData, ConnectionState, LapDataResponse, PitwallState } from '../../types/telemetry';
import { CompactDataPanel } from './CompactDataPanel';
import { SectorTable } from './SectorTable';
import { SpeedChart } from './SpeedChart';
import { InputsChart } from './InputsChart';
import { DeltaChart } from './DeltaChart';
import { TrackMap } from './TrackMap';
import styles from './PitwallDashboard.module.css';

interface PitwallDashboardProps {
  data: TelemetryData;
  connectionState: ConnectionState;
  onReconnect: () => void;
  lapData: LapDataResponse | null;
  requestLapData: () => void;
  pitwallState: PitwallState | null;
}

export function PitwallDashboard({
  data,
  connectionState,
  onReconnect,
  lapData,
  requestLapData,
  pitwallState,
}: PitwallDashboardProps) {
  useEffect(() => {
    if (connectionState !== 'connected') return;
    requestLapData();
    const interval = setInterval(requestLapData, 2000);
    return () => clearInterval(interval);
  }, [connectionState, requestLapData]);

  const handleRefresh = useCallback(() => {
    requestLapData();
  }, [requestLapData]);

  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.connectionStatus}>
          <div className={`${styles.statusDot} ${styles[connectionState]}`} />
          <span className={styles.statusText}>
            {connectionState === 'connected' ? 'Live' : connectionState}
          </span>
          {connectionState !== 'connected' && (
            <button className={styles.reconnectButton} onClick={onReconnect}>
              Reconnect
            </button>
          )}
        </div>
        <h1 className={styles.title}>F1 Pitwall Engineer</h1>
        <button className={styles.refreshButton} onClick={handleRefresh}>
          Refresh Data
        </button>
      </header>

      {/* Left Column - Track Map */}
      <section className={styles.leftColumn}>
        <TrackMap
          positions={pitwallState?.positions ?? []}
          drivers={pitwallState?.drivers ?? []}
          playerIndex={pitwallState?.playerIndex ?? 0}
          trackMap={pitwallState?.trackMap}
          marshalZones={pitwallState?.session?.marshalZones}
          trackLength={pitwallState?.session?.trackLength}
        />
      </section>

      {/* Center Column - Charts */}
      <main className={styles.centerColumn}>
        <section className={styles.dataPanel}>
          <CompactDataPanel data={data} />
        </section>

        <section className={styles.primaryChart}>
          <SpeedChart
            bestLapPoints={lapData?.bestLap?.dataPoints ?? null}
            currentLapPoints={lapData?.currentLap ?? null}
            height={250}
          />
        </section>

        <div className={styles.secondaryCharts}>
          <section className={styles.secondaryChart}>
            <InputsChart
              bestLapPoints={lapData?.bestLap?.dataPoints ?? null}
              currentLapPoints={lapData?.currentLap ?? null}
              height={150}
            />
          </section>
          <section className={styles.secondaryChart}>
            <DeltaChart
              bestLapPoints={lapData?.bestLap?.dataPoints ?? null}
              currentLapPoints={lapData?.currentLap ?? null}
              height={150}
            />
          </section>
        </div>

        <section className={styles.sectorArea}>
          <SectorTable
            currentData={data}
            bestLap={lapData?.bestLap ?? null}
          />
        </section>
      </main>

      {/* Right Column - Sidebar */}
      <aside className={styles.rightColumn}>
        <div className={styles.lapInfo}>
          <div className={styles.lapInfoItem}>
            <span className={styles.lapInfoLabel}>Best Lap</span>
            <span className={styles.lapInfoValue}>
              {lapData?.bestLapTime && lapData.bestLapTime > 0
                ? formatTime(lapData.bestLapTime)
                : '--:--.---'}
            </span>
          </div>
          <div className={styles.lapInfoItem}>
            <span className={styles.lapInfoLabel}>Last Lap</span>
            <span className={styles.lapInfoValue}>
              {data.lastLapTime > 0 ? formatTime(data.lastLapTime) : '--:--.---'}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return `${minutes}:${seconds.padStart(6, '0')}`;
}
