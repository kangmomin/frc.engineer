import styles from './WeatherIcon.module.css';

export interface WeatherIconProps {
  weather: string;
}

export function WeatherIcon({ weather }: WeatherIconProps) {
  const normalized = weather.replace(/_/g, ' ').toLowerCase();

  if (normalized === 'clear') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1" />
      </svg>
    );
  }

  if (normalized === 'light cloud' || normalized === 'overcast') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 18.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 9.3 3.8 3.8 0 0 0 7.5 18.5Z" />
      </svg>
    );
  }

  if (normalized === 'storm') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 15.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 6.3 3.8 3.8 0 0 0 7.5 15.5Z" />
        <path d="M13 16l-2 4h4l-2 4" />
      </svg>
    );
  }

  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 15.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 6.3 3.8 3.8 0 0 0 7.5 15.5Z" />
      <path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3" />
    </svg>
  );
}
