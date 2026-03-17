import { useState, useCallback, useEffect, useMemo } from 'react';
import { SettingsView } from '../../views/SettingsView';
import { RacesView } from '../../views/RacesView';
import { SetupAnalysisView } from '../../views/SetupAnalysisView';
import { StrategyView } from '../../views/StrategyView';
import { GuideView } from '../../views/GuideView';
import { CommandCenter } from '../command-center/CommandCenter';
import { RemoteConnect } from '../remote/RemoteConnect';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './Layout.module.css';

type ViewId = 'command' | 'strategy' | 'settings' | 'races' | 'setup' | 'guide';

// Remote mode: auto-detect if VITE_SIGNALING_URL was baked into the build (standalone deploy),
// or explicitly via ?remote query parameter (embedded build).
const isRemoteMode =
  !!import.meta.env.VITE_SIGNALING_URL ||
  new URLSearchParams(window.location.search).has('remote');

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>('command');

  // Remote mode: connection params set after user submits code
  const [rtcOptions, setRtcOptions] = useState<{ signalingUrl: string; roomCode: string } | null>(null);

  const setConnectionMode = useTelemetryStore((s) => s.setConnectionMode);

  useEffect(() => {
    setConnectionMode(isRemoteMode ? 'remote' : 'local');
  }, [setConnectionMode]);

  // Local mode: WebSocket connection
  usePitwallWebSocket(isRemoteMode ? { url: '' } : undefined);

  // Remote mode: WebRTC DataChannel connection (only active after user enters code)
  const webrtcOpts = useMemo(() => {
    if (!isRemoteMode || !rtcOptions) return null;
    return rtcOptions;
  }, [rtcOptions]);
  const { connectionState: rtcConnectionState } = useWebRTCDataChannel(webrtcOpts);

  const connectionState = useTelemetryStore((state) => state.connectionState);

  const handleRemoteConnect = useCallback((signalingUrl: string, roomCode: string) => {
    setRtcOptions({ signalingUrl, roomCode });
  }, []);

  const handleNavClick = useCallback((view: ViewId) => {
    setActiveView(view);
    setSidebarOpen(false);
  }, []);

  const getConnectionLabel = () => {
    if (isRemoteMode) {
      switch (connectionState) {
        case 'connected': return 'Remote 연결됨';
        case 'connecting': return 'Remote 연결 중...';
        case 'error': return '오류';
        default: return '연결 끊김';
      }
    }
    switch (connectionState) {
      case 'connected': return '연결됨';
      case 'connecting': return '연결 중...';
      case 'error': return '오류';
      default: return '연결 끊김';
    }
  };

  const topBarTitle = activeView === 'command'
    ? 'Command Center'
    : activeView === 'strategy'
      ? '전략'
      : activeView === 'settings'
        ? 'Settings'
        : activeView === 'setup'
          ? 'Setup Analysis'
          : activeView === 'guide'
            ? 'Guide'
            : 'Races';

  // Show RemoteConnect screen if in remote mode and not yet connected
  if (isRemoteMode && !rtcOptions) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
      />
    );
  }

  // In remote mode, show RemoteConnect again if disconnected/error after initial connect
  if (isRemoteMode && rtcOptions && (rtcConnectionState === 'failed')) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState="error"
      />
    );
  }

  return (
    <div className={styles.layout}>
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      <nav className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>F1 Pitwall</h2>
        </div>

        <ul className={styles.navList}>
          <li className={styles.navItem}>
            <button
              className={`${styles.navButton} ${activeView === 'command' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('command')}
            >
              <span className={styles.navIcon}>CC</span>
              <span className={styles.navLabel}>Command Center</span>
            </button>
          </li>
          <li className={styles.navItem}>
            <button
              className={`${styles.navButton} ${activeView === 'strategy' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('strategy')}
            >
              <span className={styles.navIcon}>SG</span>
              <span className={styles.navLabel}>전략</span>
            </button>
          </li>
          {!isRemoteMode && (
            <>
              <li className={styles.navItem}>
                <button
                  className={`${styles.navButton} ${activeView === 'settings' ? styles.navActive : ''}`}
                  onClick={() => handleNavClick('settings')}
                >
                  <span className={styles.navIcon}>ST</span>
                  <span className={styles.navLabel}>Settings</span>
                </button>
              </li>
              <li className={styles.navItem}>
                <button
                  className={`${styles.navButton} ${activeView === 'setup' ? styles.navActive : ''}`}
                  onClick={() => handleNavClick('setup')}
                >
                  <span className={styles.navIcon}>SA</span>
                  <span className={styles.navLabel}>Setup Analysis</span>
                </button>
              </li>
              <li className={styles.navItem}>
                <button
                  className={`${styles.navButton} ${activeView === 'races' ? styles.navActive : ''}`}
                  onClick={() => handleNavClick('races')}
                >
                  <span className={styles.navIcon}>RC</span>
                  <span className={styles.navLabel}>Races</span>
                </button>
              </li>
            </>
          )}
          <li className={styles.navItem}>
            <button
              className={`${styles.navButton} ${activeView === 'guide' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('guide')}
            >
              <span className={styles.navIcon}>GD</span>
              <span className={styles.navLabel}>Guide</span>
            </button>
          </li>
        </ul>

        <div className={styles.sidebarFooter}>
          <div className={styles.connectionStatus}>
            <div className={`${styles.statusDot} ${styles[connectionState]}`} />
            <span className={styles.statusText}>{getConnectionLabel()}</span>
          </div>
        </div>
      </nav>

      <div className={styles.main}>
        <div className={styles.topBar}>
          <button
            className={styles.hamburger}
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle menu"
          >
            <span />
            <span />
            <span />
          </button>
          <div className={styles.topBarTitle}>{topBarTitle}</div>
        </div>

        <div className={styles.contentContainer}>
          {activeView === 'command' && <CommandCenter />}
          {activeView === 'strategy' && <StrategyView />}
          {activeView === 'settings' && !isRemoteMode && (
            <div className={styles.panel}>
              <SettingsView />
            </div>
          )}
          {activeView === 'setup' && !isRemoteMode && (
            <div className={styles.panel}>
              <SetupAnalysisView />
            </div>
          )}
          {activeView === 'races' && !isRemoteMode && (
            <div className={styles.panel}>
              <RacesView />
            </div>
          )}
          {activeView === 'guide' && (
            <div className={styles.panel}>
              <GuideView />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
