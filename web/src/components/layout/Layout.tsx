import { useState, useCallback, useMemo, useEffect } from 'react';
import { SettingsView } from '../../views/SettingsView';
import { RacesView } from '../../views/RacesView';
import { SetupAnalysisView } from '../../views/SetupAnalysisView';
import { GuideView } from '../../views/GuideView';
import { CommandCenter } from '../command-center/CommandCenter';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useAuth } from '../../context/AuthContext';
import styles from './Layout.module.css';

const SETUP_TAB_PERMISSION = /^product\.[^.]+\.setup_tab$/;

function hasSetupTabPermission(permissions: string[]): boolean {
  return permissions.some(
    (p) => p === '*' || SETUP_TAB_PERMISSION.test(p),
  );
}

type ViewId = 'command' | 'settings' | 'races' | 'setup' | 'guide';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>('command');
  const { user } = useAuth();
  const canUseSetupTab = useMemo(() => hasSetupTabPermission(user?.permissions ?? []), [user?.permissions]);

  useEffect(() => {
    if (!canUseSetupTab && activeView === 'setup') {
      setActiveView('command');
    }
  }, [canUseSetupTab, activeView]);

  // Connect WebSocket at the root layout level so it stays alive across views.
  usePitwallWebSocket();
  const connectionState = useTelemetryStore((state) => state.connectionState);

  const handleNavClick = useCallback((view: ViewId) => {
    setActiveView(view);
    setSidebarOpen(false);
  }, []);

  const getConnectionLabel = () => {
    switch (connectionState) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Error';
      default: return 'Disconnected';
    }
  };

  const topBarTitle = activeView === 'command'
    ? 'Command Center'
    : activeView === 'settings'
      ? 'Settings'
      : activeView === 'setup'
        ? 'Setup Analysis'
        : activeView === 'guide'
          ? 'Guide'
          : 'Races';

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
              className={`${styles.navButton} ${activeView === 'settings' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('settings')}
            >
              <span className={styles.navIcon}>ST</span>
              <span className={styles.navLabel}>Settings</span>
            </button>
          </li>
          {canUseSetupTab && (
            <li className={styles.navItem}>
              <button
                className={`${styles.navButton} ${activeView === 'setup' ? styles.navActive : ''}`}
                onClick={() => handleNavClick('setup')}
              >
                <span className={styles.navIcon}>SA</span>
                <span className={styles.navLabel}>Setup Analysis</span>
              </button>
            </li>
          )}
          <li className={styles.navItem}>
            <button
              className={`${styles.navButton} ${activeView === 'races' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('races')}
            >
              <span className={styles.navIcon}>RC</span>
              <span className={styles.navLabel}>Races</span>
            </button>
          </li>
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
          {activeView === 'settings' && (
            <div className={styles.panel}>
              <SettingsView />
            </div>
          )}
          {activeView === 'setup' && canUseSetupTab && (
            <div className={styles.panel}>
              <SetupAnalysisView />
            </div>
          )}
          {activeView === 'races' && (
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
