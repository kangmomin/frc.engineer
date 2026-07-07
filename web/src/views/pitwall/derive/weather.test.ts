import { describe, expect, it } from 'vitest';
import type { SessionInfo, WeatherForecast } from '../../../types/telemetry';
import { deriveWeather } from './weather';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    weather: 'clear',
    trackTemp: 30,
    airTemp: 20,
    safetyCar: 'none',
    sessionType: 'Race',
    totalLaps: 50,
    trackId: 0,
    trackName: 'Test Track',
    trackLength: 5000,
    ...overrides,
  };
}

function makeForecast(timeOffset: number, rainPercentage: number): WeatherForecast {
  return {
    sessionType: 'Race',
    timeOffset,
    weather: 'light_rain',
    trackTemp: 28,
    trackTempChange: 0,
    airTemp: 19,
    airTempChange: 0,
    rainPercentage,
  };
}

describe('deriveWeather — temps/condition passthrough', () => {
  it('passes trackTemp/airTemp/condLabel through from session', () => {
    const session = makeSession({ trackTemp: 33, airTemp: 22, weather: 'heavy_rain' });
    const vm = deriveWeather(session, 5);
    expect(vm.trackTemp).toBe(33);
    expect(vm.airTemp).toBe(22);
    expect(vm.condLabel).toBe('WET');
    expect(vm.iconColor).toBe('var(--accent-soft)');
  });

  it('defaults temps to 0 and weather to clear when session is null', () => {
    const vm = deriveWeather(null, 5);
    expect(vm.trackTemp).toBe(0);
    expect(vm.airTemp).toBe(0);
    expect(vm.weather).toBe('clear');
  });
});

describe('deriveWeather — rain alert (no fabrication, FIX-4)', () => {
  it('shows "No forecast" when there is no near-term (<=30m) sample', () => {
    const session = makeSession({ weatherForecast: [] });
    const vm = deriveWeather(session, 5);
    expect(vm.alertText).toBe('No forecast');
    expect(vm.alertColor).toBe('var(--text-muted)');
  });

  it('shows the real percentage even below the alert threshold — no "Dry" wording hiding the measured value', () => {
    const session = makeSession({ weatherForecast: [makeForecast(10, 12), makeForecast(20, 8)] });
    const vm = deriveWeather(session, 5);
    expect(vm.alertText).toBe('Rain risk 12% within 30m');
    expect(vm.alertText).not.toMatch(/dry/i);
    expect(vm.alertColor).toBe('var(--accent-lime)');
  });

  it('shows the real percentage at/above the alert threshold with a warning tone', () => {
    const session = makeSession({ weatherForecast: [makeForecast(10, 63)] });
    const vm = deriveWeather(session, 5);
    expect(vm.alertText).toBe('Rain risk 63% within 30m');
    expect(vm.alertColor).toBe('var(--accent-soft)');
  });

  it('ignores samples beyond the 30m near-term window for the alert', () => {
    const session = makeSession({ weatherForecast: [makeForecast(45, 90)] });
    const vm = deriveWeather(session, 5);
    expect(vm.alertText).toBe('No forecast');
  });
});

describe('deriveWeather — forecast bars', () => {
  it('subsamples by step and derives heightPct/color from rainPercentage', () => {
    const session = makeSession({
      weatherForecast: [makeForecast(0, 10), makeForecast(5, 50), makeForecast(10, 90)],
    });
    const vm = deriveWeather(session, 5);
    expect(vm.bars.map((b) => b.timeOffset)).toEqual([0, 5, 10]);
    expect(vm.bars[0].heightPct).toBe(10);
    expect(vm.bars[2].heightPct).toBe(90);
  });

  it('clamps bar height to a minimum of 3% so near-zero rain is still visible', () => {
    const session = makeSession({ weatherForecast: [makeForecast(0, 0)] });
    const vm = deriveWeather(session, 5);
    expect(vm.bars[0].heightPct).toBe(3);
  });

  it('falls back to the full sorted set when no sample aligns with the step', () => {
    const session = makeSession({ weatherForecast: [makeForecast(3, 10), makeForecast(7, 20)] });
    const vm = deriveWeather(session, 5);
    expect(vm.bars.map((b) => b.timeOffset)).toEqual([3, 7]);
  });

  it('returns no bars and no tick labels when there is no forecast data', () => {
    const session = makeSession({ weatherForecast: [] });
    const vm = deriveWeather(session, 5);
    expect(vm.bars).toEqual([]);
    expect(vm.tickLabels).toEqual([]);
  });
});

describe('deriveWeather — tick labels reflect real sample timeOffset (FIX-4/scope-M1)', () => {
  it('labels are sourced from the actual displayed bars, not a linearly-interpolated horizon', () => {
    // 실측 샘플이 성글고 불균등하다: 2, 3, 26, 61분 — 어느 것도 step=5의 배수가 아니므로
    // filterByStep이 전체(정렬된 4개)로 폴백한다. 옛 구현(horizon*i/TICK_COUNT 선형보간)이라면
    // horizon=61 기준 ['NOW','+15M','+31M','+46M','+61M'] 류를 만들어냈을 것이다 — 어느 것도
    // 실제 샘플 시간(2/3/26분)과 일치하지 않는다. 새 구현은 등간격 인덱스 위치의 바가 실제로
    // 나타내는 샘플의 timeOffset을 그대로 라벨로 쓴다.
    const session = makeSession({
      weatherForecast: [makeForecast(61, 5), makeForecast(2, 40), makeForecast(26, 15), makeForecast(3, 35)],
    });
    const vm = deriveWeather(session, 5);
    const sampleOffsets = vm.bars.map((b) => b.timeOffset);
    expect(sampleOffsets).toEqual([2, 3, 26, 61]);
    expect(vm.tickLabels).toEqual(['+2M', '+3M', '+26M', '+26M', '+61M']);
  });
});
