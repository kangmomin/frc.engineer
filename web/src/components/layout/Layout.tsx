import { useState, useEffect, useCallback } from 'react';
import type { TelemetryData, ConnectionState, LapDataResponse, PitwallState, TabId } from '../../types/telemetry';
import { MiniHUD } from './MiniHUD';
import { EngineerView } from '../../views/EngineerView';
import { SettingsView } from '../../views/SettingsView';
import styles from './Layout.module.css';

interface LayoutProps {
  data: TelemetryData;
  connectionState: ConnectionState;
  onReconnect: () => void;
  lapData: LapDataResponse | null;
  requestLapData: () => void;
  pitwallState: PitwallState | null;
}

const TAB_CONFIG: { id: TabId; label: string; icon: string }[] = [
  { id: 'engineer', label: 'Engineer', icon: '▦' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function Layout({
  data,
  connectionState,
  onReconnect,
  lapData,
  requestLapData,
  pitwallState,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('engineer');
  const [splitTab, setSplitTab] = useState<TabId | null>(null);

  useEffect(() => {
    if (connectionState !== 'connected') return;
    requestLapData();
    const interval = setInterval(requestLapData, 2000);
    return () => clearInterval(interval);
  }, [connectionState, requestLapData]);

  const handleTabClick = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
    setSidebarOpen(false);
  }, []);

  const handleSplitOpen = useCallback((tabId: TabId) => {
    setSplitTab(tabId);
    setSidebarOpen(false);
  }, []);

  const closeSplit = useCallback(() => {
    setSplitTab(null);
  }, []);

  function renderView(tabId: TabId) {
    switch (tabId) {
      case 'engineer':
        return <EngineerView lapData={lapData} pitwallState={pitwallState} data={data} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <EngineerView lapData={lapData} pitwallState={pitwallState} data={data} />;
    }
  }

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
          {splitTab === null && (
            <button
              className={styles.splitToggle}
              title="Enable split view"
              onClick={() => {
                // Pick the first tab that isn't activeTab
                const other = TAB_CONFIG.find((t) => t.id !== activeTab);
                if (other) handleSplitOpen(other.id);
              }}
            >
              ⊟
            </button>
          )}
        </div>

        <ul className={styles.navList}>
          {TAB_CONFIG.map((tab) => (
            <li key={tab.id} className={styles.navItem}>
              <button
                className={`${styles.navButton} ${activeTab === tab.id ? styles.navActive : ''}`}
                onClick={() => handleTabClick(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleSplitOpen(tab.id);
                }}
              >
                <span className={styles.navIcon}>{tab.icon}</span>
                <span className={styles.navLabel}>{tab.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.sidebarFooter}>
          <div className={styles.connectionStatus}>
            <div className={`${styles.statusDot} ${styles[connectionState]}`} />
            <span className={styles.statusText}>
              {connectionState === 'connected' ? 'Live' : connectionState}
            </span>
          </div>
          {connectionState !== 'connected' && (
            <button className={styles.reconnectButton} onClick={onReconnect}>
              Reconnect
            </button>
          )}
        </div>
      </nav>

      {/* Main area */}
      <div className={styles.main}>
        {/* Hamburger + MiniHUD bar */}
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
          <MiniHUD data={data} pitwallState={pitwallState} />
        </div>

        {/* Content */}
        <div className={splitTab ? styles.splitContainer : styles.contentContainer}>
          <div className={styles.panel}>
            {renderView(activeTab)}
          </div>
          {splitTab && (
            <div className={styles.panel}>
              <div className={styles.splitHeader}>
                <span className={styles.splitLabel}>
                  {TAB_CONFIG.find((t) => t.id === splitTab)?.label}
                </span>
                <button className={styles.splitClose} onClick={closeSplit}>
                  ✕
                </button>
              </div>
              {renderView(splitTab)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
