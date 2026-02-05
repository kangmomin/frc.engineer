import { useState } from 'react';
import { SettingsView } from '../../views/SettingsView';
import styles from './Layout.module.css';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
              className={`${styles.navButton} ${styles.navActive}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className={styles.navIcon}>⚙</span>
              <span className={styles.navLabel}>Settings</span>
            </button>
          </li>
        </ul>

        <div className={styles.sidebarFooter}>
          <div className={styles.connectionStatus}>
            <div className={`${styles.statusDot}`} />
            <span className={styles.statusText}>Ready</span>
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
        </div>

        {/* Content */}
        <div className={styles.contentContainer}>
          <div className={styles.panel}>
            <SettingsView />
          </div>
        </div>
      </div>
    </div>
  );
}
