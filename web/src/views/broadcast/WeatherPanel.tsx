import { WeatherIcon } from '../../ui';

export interface WeatherVM {
  weather: string;
  condLabel: string;
  trackTemp: number;
  airTemp: number;
  rain: { pct: number; minutes: number } | null;
  iconColor: string;
}

export function WeatherPanel({ weather }: { weather: WeatherVM }) {
  const rainText = weather.rain
    ? `Rain risk ${weather.rain.pct}% · ~${weather.rain.minutes}m`
    : 'Conditions stable';
  return (
    <div style={{ flex: 'none', background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 'none', width: 30, height: 30, color: weather.iconColor }}>
        <WeatherIcon weather={weather.weather} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13 }}>
          {weather.condLabel} · TRK {Math.round(weather.trackTemp)}° AIR {Math.round(weather.airTemp)}°
        </div>
        <div style={{ fontSize: 10.5, color: weather.rain ? 'var(--accent)' : 'var(--text-muted)' }}>{rainText}</div>
      </div>
    </div>
  );
}
