import { SessionInfo } from '../../types/telemetry';
import styles from './WeatherWidget.module.css';

interface WeatherWidgetProps {
  session: SessionInfo | null;
}

const weatherIcons: Record<string, string> = {
  clear: '\u2600\uFE0F',
  light_cloud: '\u26C5',
  overcast: '\u2601\uFE0F',
  light_rain: '\uD83C\uDF26\uFE0F',
  heavy_rain: '\uD83C\uDF27\uFE0F',
  storm: '\u26C8\uFE0F',
};

function getWeatherIcon(weather: string): string {
  return weatherIcons[weather] ?? '\u2753';
}

const safetyCarConfig: Record<string, { label: string; className: string }> = {
  full: { label: 'SC', className: styles.scFull },
  virtual: { label: 'VSC', className: styles.scVirtual },
  formation: { label: 'FL', className: styles.scFormation },
};

export function WeatherWidget({ session }: WeatherWidgetProps) {
  if (!session) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>WEATHER & SESSION</div>
        <div className={styles.waiting}>Waiting for session...</div>
      </div>
    );
  }

  const sc = safetyCarConfig[session.safetyCar];
  const trackKm = (session.trackLength / 1000).toFixed(3);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>WEATHER & SESSION</div>

      <div className={styles.sessionType}>{session.sessionType}</div>

      <div className={styles.weatherIcon}>{getWeatherIcon(session.weather)}</div>

      <div className={styles.grid}>
        <span className={styles.label}>Track Temp</span>
        <span className={styles.tempValue}>{session.trackTemp}&deg;C</span>

        <span className={styles.label}>Air Temp</span>
        <span className={styles.tempValue}>{session.airTemp}&deg;C</span>

        <span className={styles.label}>Track Length</span>
        <span className={styles.value}>{trackKm} km</span>

        <span className={styles.label}>Total Laps</span>
        <span className={styles.value}>{session.totalLaps}</span>
      </div>

      {sc && (
        <div className={`${styles.scBadge} ${sc.className}`}>
          {sc.label}
        </div>
      )}
    </div>
  );
}
