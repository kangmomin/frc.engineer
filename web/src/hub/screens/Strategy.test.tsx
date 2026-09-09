import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StrategyResultView, StrategyContextDetails, strategyContextLabel } from './Strategy';
import { strategyResultFixture, strategyContextFixture } from '../data/strategy.testdata';

it('renders measured units, exact pit laps, evidence and accuracy limitations', () => {
  const html = renderToStaticMarkup(<StrategyResultView result={strategyResultFixture} />);
  for (const label of ['12랩 종료', '+0.85초', '2.00', 'MJ', '공식 섹터가 아닌 거리 3등분', '실제 경기 예측 정확도는 아직 검증되지 않았습니다', '상위 조합 간 차이']) expect(html).toContain(label);
});
it('shows no ranked plan when the model cannot identify fuel and tyre effects', () => {
  const html = renderToStaticMarkup(<StrategyResultView result={{ ...strategyResultFixture, status: 'unidentifiable', reasons: ['fuel-age-not-identifiable'] }} />);
  expect(html).toContain('연료 감소와 타이어 사용에 따른 변화를 분리할 수 없어');
  expect(html).not.toContain('12랩 종료');
});

it('distinguishes physical and game rules that produce different comparison contexts', () => {
  const c = structuredClone(strategyContextFixture);
  c.conditions.rules.gameMode = 4; c.conditions.rules.ruleSet = 12; c.conditions.rules.lowFuelMode = 1; c.conditions.rules.pitStopExperience = 2;
  const label = strategyContextLabel(c);
  expect(label).not.toBe(strategyContextLabel(strategyContextFixture));
  for (const value of ['그랑프리', '엘리미네이션', '어려움', '몰입형']) expect(label).toContain(value);
  const html = renderToStaticMarkup(<StrategyContextDetails context={c} />);
  expect(html).toContain('피트 레인 타이어 시뮬레이션</dt><dd>켜짐');
  for (const value of ['그랑프리', '엘리미네이션', '어려움', '몰입형']) expect(html).toContain(value);
});
