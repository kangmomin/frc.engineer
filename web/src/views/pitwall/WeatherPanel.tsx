import { PanelTitle, WeatherIcon } from '../../ui';
import type { SessionInfo, WeatherForecast } from '../../types/telemetry';
import { formatForecastLabel, getTrackCondition } from '../../utils/raceDisplay';

const STEP_OPTIONS = [1, 5, 10, 15];
const RAIN_ALERT_THRESHOLD = 50;
const RAIN_NEAR_TERM_MIN = 30;
const TICK_COUNT = 4; // 5개 라벨(0..TICK_COUNT)

function barColor(rain: number): string {
  if (rain < 20) return '#2b4a57';
  if (rain < 40) return '#2f7f9e';
  if (rain < 60) return '#37a6cf';
  if (rain < 80) return '#48c0e8';
  return '#7fd8ff';
}

/**
 * step(1/5/10/15m)으로 실 forecast 샘플을 서브샘플링한다. 목업은 분단위 연속 synthetic
 * 데이터라 모든 step에서 촘촘하지만, 실 weatherForecast[]는 게임이 제공하는 성긴 샘플이라
 * step에 정렬되는 샘플이 하나도 없을 수 있다 — 그 경우 전체를 보여준다(빈 차트 방지).
 */
function filterByStep(forecast: WeatherForecast[], step: number): WeatherForecast[] {
  const sorted = [...forecast].sort((a, b) => a.timeOffset - b.timeOffset);
  const filtered = sorted.filter((f) => f.timeOffset % step === 0);
  return filtered.length > 0 ? filtered : sorted;
}

export interface WeatherPanelProps {
  session: SessionInfo | null;
  weatherStep: number;
  onStepChange: (step: number) => void;
}

/** Pit Wall 전용 Weather 패널(세로 rail). Broadcast의 WeatherPanel과 별개 구현(Spec §4.3). */
export function WeatherPanel({ session, weatherStep, onStepChange }: WeatherPanelProps) {
  const weather = session?.weather ?? 'clear';
  const cond = getTrackCondition(weather);
  const forecast = session?.weatherForecast ?? [];

  const nearTerm = forecast.filter((f) => f.timeOffset <= RAIN_NEAR_TERM_MIN);
  const maxRain = nearTerm.length ? Math.max(...nearTerm.map((f) => f.rainPercentage)) : null;
  const alertText = maxRain == null ? 'No forecast' : maxRain >= RAIN_ALERT_THRESHOLD ? `Rain risk ${Math.round(maxRain)}% within ${RAIN_NEAR_TERM_MIN}m` : `Dry — rain risk low within ${RAIN_NEAR_TERM_MIN}m`;
  const alertColor = maxRain == null ? 'var(--text-muted)' : maxRain >= RAIN_ALERT_THRESHOLD ? 'var(--accent-soft)' : 'var(--accent-lime)';
  const alertBg = maxRain != null && maxRain >= RAIN_ALERT_THRESHOLD ? 'rgba(0,229,255,.06)' : 'rgba(205,255,19,.08)';

  const bars = filterByStep(forecast, weatherStep);
  const horizon = bars.length ? bars[bars.length - 1].timeOffset : 0;

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <PanelTitle title="Weather" tone="primary" detail={cond.label} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ flex: 'none', width: 34, height: 34, color: 'var(--accent)' }}>
          <WeatherIcon weather={weather} />
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            TRK <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700 }}>{Math.round(session?.trackTemp ?? 0)}°</span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            AIR <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700 }}>{Math.round(session?.airTemp ?? 0)}°</span>
          </span>
        </div>
      </div>
      <div style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: alertBg, borderLeft: `3px solid ${alertColor}`, fontSize: 11.5, fontWeight: 600, color: alertColor }}>{alertText}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Interval</span>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {STEP_OPTIONS.map((m) => {
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
      {bars.length === 0 ? (
        <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>No forecast</div>
      ) : (
        <>
          <div style={{ position: 'relative', height: 42, display: 'flex', alignItems: 'flex-end', gap: 2, paddingTop: 2 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 21, borderTop: '1px dashed rgba(229,226,227,.16)' }} />
            <div style={{ position: 'absolute', right: 0, bottom: 22, fontSize: 8, color: 'var(--text-muted)' }}>50%</div>
            {bars.map((bar, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', height: `${Math.max(3, Math.round(bar.rainPercentage))}%`, background: barColor(bar.rainPercentage), borderRadius: '2px 2px 0 0' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}>
            {Array.from({ length: TICK_COUNT + 1 }, (_, i) => (
              <span key={i}>{formatForecastLabel((horizon * i) / TICK_COUNT)}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
