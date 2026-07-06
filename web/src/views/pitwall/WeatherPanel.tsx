import { PanelTitle, WeatherIcon } from '../../ui';
import type { WeatherVM } from './derive/weather';
import { WEATHER_STEP_OPTIONS } from './useDisplayPrefs';

export interface WeatherPanelProps {
  weather: WeatherVM;
  weatherStep: number;
  onStepChange: (step: number) => void;
}

/**
 * Pit Wall 전용 Weather 패널(세로 rail). Broadcast의 WeatherPanel과 별개 구현(Spec §4.3).
 * derive/weather.ts가 만든 WeatherVM만 받는 순수 컴포넌트다(Spec §2 VM-only, FIX-4) —
 * raw SessionInfo를 직접 파생하지 않는다.
 */
export function WeatherPanel({ weather, weatherStep, onStepChange }: WeatherPanelProps) {
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <PanelTitle title="Weather" tone="primary" detail={weather.condLabel} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ flex: 'none', width: 34, height: 34, color: 'var(--accent)' }}>
          <WeatherIcon weather={weather.weather} />
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            TRK <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700 }}>{Math.round(weather.trackTemp)}°</span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            AIR <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700 }}>{Math.round(weather.airTemp)}°</span>
          </span>
        </div>
      </div>
      <div style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: weather.alertBg, borderLeft: `3px solid ${weather.alertColor}`, fontSize: 11.5, fontWeight: 600, color: weather.alertColor }}>{weather.alertText}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Interval</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {WEATHER_STEP_OPTIONS.map((m) => {
            const active = weatherStep === m;
            return (
              <button
                key={m}
                onClick={() => onStepChange(m)}
                style={{ flex: 1, cursor: 'pointer', fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 11, padding: '5px 2px', borderRadius: 'var(--radius-sm)', background: active ? 'var(--accent)' : 'transparent', color: active ? '#0c0c0d' : 'var(--text-muted)', border: `1px solid ${active ? 'var(--accent)' : 'var(--bg-panel-border)'}` }}
              >
                {m}m
              </button>
            );
          })}
        </div>
      </div>
      {weather.bars.length === 0 ? (
        <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>No forecast</div>
      ) : (
        <>
          <div style={{ position: 'relative', height: 42, display: 'flex', alignItems: 'flex-end', gap: 2, paddingTop: 2 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 21, borderTop: '1px dashed rgba(229,226,227,.16)' }} />
            <div style={{ position: 'absolute', right: 0, bottom: 22, fontSize: 8, color: 'var(--text-muted)' }}>50%</div>
            {weather.bars.map((bar) => (
              <div key={bar.timeOffset} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', height: `${bar.heightPct}%`, background: bar.color, borderRadius: '2px 2px 0 0' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}>
            {weather.tickLabels.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
