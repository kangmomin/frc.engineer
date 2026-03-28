import { useState, useCallback, useEffect, useMemo } from 'react';
import { SettingsView } from '../../views/SettingsView';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import { isForcedRemoteMode, isMockMode } from '../../runtimeFlags';
import { useTelemetryStore } from '../../store/telemetryStore';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { RemoteConnect } from '../remote/RemoteConnect';
import styles from './Layout.module.css';

const CONNECTION_MODE_KEY = 'frc_connection_mode';

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rtcOptions, setRtcOptions] = useState<{ signalingUrl: string; roomId: string; password: string } | null>(null);
  const [preferredRemoteMode, setPreferredRemoteMode] = useState(() => {
    if (isForcedRemoteMode) return true;
    return window.localStorage.getItem(CONNECTION_MODE_KEY) === 'remote';
  });

  const setConnectionMode = useTelemetryStore((state) => state.setConnectionMode);
  const setConnectionState = useTelemetryStore((state) => state.setConnectionState);
  const setPitwallState = useTelemetryStore((state) => state.setPitwallState);
  const clearNotifications = useTelemetryStore((state) => state.clearNotifications);
  const clearRaceResult = useTelemetryStore((state) => state.clearRaceResult);
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const remoteMode = isForcedRemoteMode || preferredRemoteMode;

  useEffect(() => {
    setConnectionMode(remoteMode ? 'remote' : 'local');
  }, [remoteMode, setConnectionMode]);

  useEffect(() => {
    if (isForcedRemoteMode) return;
    window.localStorage.setItem(CONNECTION_MODE_KEY, remoteMode ? 'remote' : 'local');
  }, [remoteMode]);

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

  usePitwallWebSocket(remoteMode || isMockMode ? { url: '' } : undefined);
  useMockTelemetry(isMockMode && !remoteMode);

  const webrtcOpts = useMemo(() => {
    if (!remoteMode || !rtcOptions) return null;
    return rtcOptions;
  }, [remoteMode, rtcOptions]);

  const { connectionState: rtcConnectionState } = useWebRTCDataChannel(webrtcOpts);

  const handleRemoteConnect = useCallback((signalingUrl: string, roomId: string, password: string) => {
    setRtcOptions({ signalingUrl, roomId, password });
    setPreferredRemoteMode(true);
  }, []);

  const switchToRemoteMode = useCallback(() => {
    setPreferredRemoteMode(true);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
  }, [clearNotifications, clearRaceResult, setConnectionState, setPitwallState]);

  const switchToLocalMode = useCallback(() => {
    if (isForcedRemoteMode) return;
    setPreferredRemoteMode(false);
    setRtcOptions(null);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
  }, [clearNotifications, clearRaceResult, setConnectionState, setPitwallState]);

  if (remoteMode && !rtcOptions) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
        onCancel={isForcedRemoteMode ? undefined : switchToLocalMode}
        title="P2P Telemetry Link"
        subtitle="Pick an active sender room from the signaling server, then enter its password to join."
      />
    );
  }

  if (
    remoteMode &&
    rtcOptions &&
    (rtcConnectionState === 'failed' || connectionState === 'error' || connectionState === 'disconnected')
  ) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState="error"
        onCancel={isForcedRemoteMode ? undefined : switchToLocalMode}
        title="P2P Telemetry Link"
        subtitle="Connection dropped. Pick the room again and retry, or fall back to the local telemetry feed."
      />
    );
  }

  return (
    <div className={styles.shell}>
      <CockpitDashboard
        onOpenSettings={() => setSettingsOpen(true)}
        showSettingsButton={!isForcedRemoteMode}
        remoteAction={isForcedRemoteMode ? undefined : {
          label: remoteMode ? 'Local' : 'P2P',
          onClick: remoteMode ? switchToLocalMode : switchToRemoteMode,
          active: remoteMode,
        }}
      />

      {settingsOpen && !isForcedRemoteMode && (
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
