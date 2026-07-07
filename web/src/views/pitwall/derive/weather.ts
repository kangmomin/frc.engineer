import type { SessionInfo, WeatherForecast } from '../../../types/telemetry';
import { formatForecastLabel, getTrackCondition } from '../../../utils/raceDisplay';

const RAIN_NEAR_TERM_MIN = 30;
const RAIN_ALERT_THRESHOLD = 50;
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

export interface ForecastBarVM {
  timeOffset: number;
  heightPct: number;
  color: string;
}

export interface WeatherVM {
  weather: string;
  condLabel: string;
  trackTemp: number;
  airTemp: number;
  iconColor: string;
  alertText: string;
  alertColor: string;
  alertBg: string;
  bars: ForecastBarVM[];
  /** 5개 축 라벨. 등간격 위치의 바가 실제로 나타내는 샘플의 timeOffset에서 직접 취득한다
   * (선형보간 아님) — bars도 동일 인덱스 등간격 배치이므로 라벨-바 위치가 항상 일치한다. */
  tickLabels: string[];
}

/**
 * WeatherPanel용 VM 파생(Spec §2 VM-only, FIX-4). 패널은 이 결과만 받고 raw SessionInfo를
 * 직접 파생하지 않는다. rain alert는 임계 미만이어도 실측 %를 그대로 표기하고(§9 fabrication
 * 금지 — "Dry" 문구로 실측을 은폐하지 않는다), 색조(lime/soft)만 임계로 구분한다.
 */
export function deriveWeather(session: SessionInfo | null, weatherStep: number): WeatherVM {
  const weather = session?.weather ?? 'clear';
  const cond = getTrackCondition(weather);
  const forecast = session?.weatherForecast ?? [];

  const nearTerm = forecast.filter((f) => f.timeOffset <= RAIN_NEAR_TERM_MIN);
  const maxRain = nearTerm.length ? Math.max(...nearTerm.map((f) => f.rainPercentage)) : null;
  const isHighRisk = maxRain != null && maxRain >= RAIN_ALERT_THRESHOLD;
  const alertText = maxRain == null ? 'No forecast' : `Rain risk ${Math.round(maxRain)}% within ${RAIN_NEAR_TERM_MIN}m`;
  const alertColor = maxRain == null ? 'var(--text-muted)' : isHighRisk ? 'var(--accent-soft)' : 'var(--accent-lime)';
  const alertBg = isHighRisk ? 'rgba(0,229,255,.06)' : 'rgba(205,255,19,.08)';

  const sampled = filterByStep(forecast, weatherStep);
  const bars: ForecastBarVM[] = sampled.map((f) => ({
    timeOffset: f.timeOffset,
    heightPct: Math.max(3, Math.round(f.rainPercentage)),
    color: barColor(f.rainPercentage),
  }));
  const tickLabels =
    sampled.length > 0
      ? Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
          const idx = Math.round((i / TICK_COUNT) * (sampled.length - 1));
          return formatForecastLabel(sampled[idx].timeOffset);
        })
      : [];

  return {
    weather,
    condLabel: cond.label,
    trackTemp: session?.trackTemp ?? 0,
    airTemp: session?.airTemp ?? 0,
    iconColor: cond.tone === 'wet' ? 'var(--accent-soft)' : 'var(--accent)',
    alertText,
    alertColor,
    alertBg,
    bars,
    tickLabels,
  };
}
