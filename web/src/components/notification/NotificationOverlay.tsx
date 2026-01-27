import type { RaceControlNotification } from '../../types/telemetry';
import styles from './NotificationOverlay.module.css';

interface NotificationOverlayProps {
  notifications: RaceControlNotification[];
}

export function NotificationOverlay({ notifications }: NotificationOverlayProps) {
  if (notifications.length === 0) return null;

  return (
    <>
      {/* Screen border flash for critical notifications */}
      {notifications.some((n) => n.severity === 'critical') && (
        <div className={styles.criticalFlash} />
      )}

      <div className={styles.overlay}>
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`${styles.toast} ${styles[notification.severity]}`}
          >
            <div className={styles.toastHeader}>
              <span className={styles.categoryBadge}>
                {notification.category.toUpperCase()}
              </span>
            </div>
            <div className={styles.toastMessage}>{notification.message}</div>
          </div>
        ))}
      </div>
    </>
  );
}
