import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StrategyResultView, StrategyContextDetails, strategyContextLabel, StrategyCollectionStatus, StrategyEvidenceProgress, StrategyEmptyState } from './Strategy';
import { strategyResultFixture, strategyContextFixture, strategyCorpusFixture } from '../data/strategy.testdata';

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

it('shows existing race uploads without presenting them as strategy measurements', () => {
  const corpus = structuredClone(strategyCorpusFixture);
  corpus.contexts = []; corpus.records = 0;
  corpus.archiveCoverage = { uploadedRaces: 5, withEvidence: 0, withoutEvidence: 5, latestUploadAt: null, truncated: false, limit: 300 };
  corpus.diagnostics = { collectedLaps: 0, cleanLaps: 0, excludedLaps: 0, excludedRecords: 0, exclusions: [] };
  const html = renderToStaticMarkup(<><StrategyCollectionStatus corpus={corpus} /><StrategyEmptyState corpus={corpus} format="F1 25" onRefresh={() => undefined} /></>);
  expect(html).toContain('레이스 업로드에 전략 계측이 없습니다');
  expect(html).toContain('최근 레이스 업로드 5건에는');
  expect(html).toContain('2026 차량을 사용한다면 게임의 UDP 형식도 2026으로');
  expect(html).not.toContain('업로드된 레이스가 없습니다');
  expect(html).not.toContain('마지막 업로드');
});

it('gives upload guidance only when coverage confirms that no races were uploaded', () => {
  const corpus = { ...strategyCorpusFixture, contexts: [], records: 0,
    archiveCoverage: { uploadedRaces: 0, withEvidence: 0, withoutEvidence: 0, latestUploadAt: null, truncated: false, limit: 300 } };
  const html = renderToStaticMarkup(<StrategyEmptyState corpus={corpus} format="F1 26" onRefresh={() => undefined} />);
  expect(html).toContain('이 조건에 업로드된 레이스가 없습니다');
  expect(html).toContain('로그인과 인터넷 연결');
  expect(html).toContain('정상 랩이 하나라도 있으면 조건 카드부터 표시합니다');
  expect(html).not.toContain('필수 측정값이 누락');
});

it('keeps the distinct excluded lap count separate from overlapping reasons and zero-lap records', () => {
  const corpus = { ...strategyCorpusFixture, contexts: [], records: 2, diagnostics: {
    collectedLaps: 14, cleanLaps: 0, excludedLaps: 14, excludedRecords: 2,
    exclusions: [{ code: 'damage', records: 1, laps: 8 }, { code: 'traffic', records: 1, laps: 8 }, { code: 'flashback', records: 1, laps: 0 }],
  } };
  const html = renderToStaticMarkup(<StrategyCollectionStatus corpus={corpus} />);
  const text = html.replace(/<[^>]*>/g, '');
  for (const label of ['제외된 랩14랩', '차량·타이어 손상8랩1건', '되감기0랩1건', '한 랩에 여러 사유가 겹칠 수 있어']) expect(text).toContain(label);
  expect(html).toContain('<details open="">');
  expect(text).not.toContain('제외된 랩16랩');
});

it('hides unavailable diagnostics instead of inventing zero counts during mixed deployment', () => {
  const corpus = { ...strategyCorpusFixture, contexts: [], records: 0 };
  delete corpus.archiveCoverage; delete corpus.diagnostics; delete corpus.minCleanLaps;
  expect(renderToStaticMarkup(<StrategyCollectionStatus corpus={corpus} />)).toBe('');
  const html = renderToStaticMarkup(<StrategyEmptyState corpus={corpus} format="F1 26" onRefresh={() => undefined} />);
  expect(html).toContain('이 조건의 기록을 모으고 있습니다');
  expect(html).toContain('40개의 정상 랩');
  expect(html).not.toContain('업로드된 레이스가 없습니다');
  const unavailable = { ...corpus, archiveCoverage: null, diagnostics: null };
  expect(renderToStaticMarkup(<StrategyCollectionStatus corpus={unavailable} />)).toBe('');
  expect(renderToStaticMarkup(<StrategyEmptyState corpus={unavailable} format="F1 26" onRefresh={() => undefined} />)).toContain('이 조건의 기록을 모으고 있습니다');
});

it('does not invent missing lap statistics when only archive coverage is available', () => {
  const corpus = { ...strategyCorpusFixture };
  delete corpus.diagnostics;
  const html = renderToStaticMarkup(<StrategyCollectionStatus corpus={corpus} />);
  expect(html).toContain('전략 계측 없음');
  expect(html).toContain('2026-09-12T03:00:00Z');
  expect(html).not.toContain('수집된 완료 랩');
});

it('labels future exclusion codes without exposing internal codes', () => {
  const corpus = structuredClone(strategyCorpusFixture);
  corpus.diagnostics!.exclusions = [{ code: 'unrecognized-internal-reason', records: 1, laps: 2 }];
  const html = renderToStaticMarkup(<StrategyCollectionStatus corpus={corpus} />);
  expect(html).toContain('기타 제외 사유');
  expect(html).not.toContain('unrecognized-internal-reason');
});

it('uses server minimums for progress while keeping small cohorts visible', () => {
  const context = { ...strategyContextFixture, users: 1, sessions: 1, cleanLaps: 2 };
  const html = renderToStaticMarkup(<StrategyEvidenceProgress context={context} corpus={{ minUsers: 4, minSessions: 8, minCleanLaps: 60 }} />);
  for (const label of ['1 / 4명', '1 / 8경기', '2 / 60랩', '선택한 조건의 기록이 더 필요합니다', 'max="60" value="2"']) expect(html).toContain(label);
  expect(html).not.toContain('최소 수량 기준을 충족했습니다');
});

it('keeps actual counts above the minimum and explains that fitting can still be unavailable', () => {
  const html = renderToStaticMarkup(<StrategyEvidenceProgress context={strategyContextFixture} corpus={{ minUsers: 3, minSessions: 6 }} />);
  for (const label of ['324 / 40랩', 'max="40" value="40"', '최소 수량 기준을 충족했습니다', '세 기준을 충족해도 비교 결과가 나오지 않을 수 있습니다']) expect(html).toContain(label);
});
