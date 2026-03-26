import { useState, useCallback, useEffect, useMemo } from 'react';
import { SettingsView } from '../../views/SettingsView';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import { isMockMode, isRemoteMode } from '../../runtimeFlags';
import { useTelemetryStore } from '../../store/telemetryStore';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { RemoteConnect } from '../remote/RemoteConnect';
import styles from './Layout.module.css';

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rtcOptions, setRtcOptions] = useState<{ signalingUrl: string; roomCode: string } | null>(null);

  const setConnectionMode = useTelemetryStore((state) => state.setConnectionMode);
  const connectionState = useTelemetryStore((state) => state.connectionState);

  useEffect(() => {
    setConnectionMode(isRemoteMode ? 'remote' : 'local');
  }, [setConnectionMode]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  usePitwallWebSocket(isRemoteMode || isMockMode ? { url: '' } : undefined);
  useMockTelemetry(isMockMode);

  const webrtcOpts = useMemo(() => {
    if (!isRemoteMode || !rtcOptions) return null;
    return rtcOptions;
  }, [rtcOptions]);

  const { connectionState: rtcConnectionState } = useWebRTCDataChannel(webrtcOpts);

  const handleRemoteConnect = useCallback((signalingUrl: string, roomCode: string) => {
    setRtcOptions({ signalingUrl, roomCode });
  }, []);

  if (isRemoteMode && !rtcOptions) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
      />
    );
  }

  if (isRemoteMode && rtcOptions && rtcConnectionState === 'failed') {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState="error"
      />
    );
  }

  return (
    <div className={styles.shell}>
      <CockpitDashboard
        onOpenSettings={() => setSettingsOpen(true)}
        showSettingsButton={!isRemoteMode}
      />

      {settingsOpen && !isRemoteMode && (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
          />
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <span className={styles.drawerEyebrow}>Race Settings</span>
                <h2 className={styles.drawerTitle}>Integrated Control Deck</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className={styles.drawerBody}>
              <SettingsView />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
