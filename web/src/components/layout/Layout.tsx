import { useState, useCallback } from 'react';
import { SettingsView } from '../../views/SettingsView';
import { CommandCenter } from '../command-center/CommandCenter';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './Layout.module.css';

type ViewId = 'command' | 'settings';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>('command');

  // Connect WebSocket at the root layout level so it stays alive across views
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

  return (
    <div className={styles.layout}>
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
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
              <span className={styles.navIcon}>🏎</span>
              <span className={styles.navLabel}>Command Center</span>
            </button>
          </li>
          <li className={styles.navItem}>
            <button
              className={`${styles.navButton} ${activeView === 'settings' ? styles.navActive : ''}`}
              onClick={() => handleNavClick('settings')}
            >
              <span className={styles.navIcon}>⚙</span>
              <span className={styles.navLabel}>Settings</span>
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

      {/* Main area */}
      <div className={styles.main}>
        {/* Top bar with hamburger */}
        <div className={styles.topBar}>
          <button
            className={styles.hamburger}
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <span />
            <span />
            <span />
          </button>
          <div className={styles.topBarTitle}>
            {activeView === 'command' ? 'Command Center' : 'Settings'}
          </div>
        </div>

        {/* Content */}
        <div className={styles.contentContainer}>
          {activeView === 'command' ? (
            <CommandCenter />
          ) : (
            <div className={styles.panel}>
              <SettingsView />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
