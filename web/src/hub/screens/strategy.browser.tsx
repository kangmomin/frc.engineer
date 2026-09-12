import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HubApp } from '../HubApp';
import { PARENT_TOKEN_KEY, clearViewAsSession } from '../data/session';
import { strategyContextFixture, strategyCorpusFixture, strategyResultFixture } from '../data/strategy.testdata';
import type { StrategyContexts } from '../data/strategy';

const pause = (ms = 20) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(test: () => boolean, message: string) { const end = performance.now() + 5000; while (!test()) { check(performance.now() < end, `${message}\n${document.body.innerText.slice(-3000)}`); await pause(); } }
function button(host: HTMLElement, name: string): HTMLButtonElement { const b = [...host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === name || el.textContent?.trim() === name); check(b, `Missing ${name}`); return b; }
function selectFilter(host: HTMLElement, label: string, value: string) {
  const select = [...host.querySelectorAll('label')].find(el => el.firstChild?.textContent === label)?.querySelector('select');
  check(select, `Missing filter ${label}`); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
}
async function searchRecords(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]'); check(input, 'Missing record search');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="경기 조건 목록"] button')];

export async function run() {
  check(import.meta.env.VITE_PLATFORM_URL, 'Run with VITE_PLATFORM_URL=http://strategy.test');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const originalFetch = window.fetch; const previousToken = localStorage.getItem(PARENT_TOKEN_KEY);
  const account = { id: 'owner-a', steamId64: '7', persona: 'Strategy A', avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '' };
  let allowed = false, contexts = 0, simulations = 0, preferences = 0, deferMe = false, deferSimulation = false;
  let corpusOverride: StrategyContexts | undefined, deferContexts = false;
  const contextQueries: URLSearchParams[] = [];
  let finishMe: ((r: Response) => void) | null = null, finishSimulation: ((r: Response) => void) | null = null;
  let finishContexts: ((r: Response) => void) | null = null;
  const grants = () => ['pithub.race.read', 'pithub.race.create', ...(allowed ? ['pithub.strategy.read'] : [])];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const otherContext = structuredClone(strategyContextFixture);
  otherContext.id = 'b'.repeat(32); otherContext.trackId = 7; otherContext.weather = 2; otherContext.conditions.totalLaps = 50;
  otherContext.conditions.gameMinor = 23; otherContext.conditions.teamId = 1;
  otherContext.conditions.rules.equalPerformance = false; otherContext.conditions.rules.gameMode = 4;
  const wetContext = structuredClone(strategyContextFixture);
  wetContext.id = 'c'.repeat(32); wetContext.weather = 3; wetContext.conditions.totalLaps = 50;
  try {
    clearViewAsSession(); localStorage.setItem(PARENT_TOKEN_KEY, 'token-a');
    // Only transport is stubbed: real Hub session, role grants, form and result lifecycle.
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.href);
      const token = new Headers(init?.headers).get('Authorization'); const isB = token === 'Bearer token-b';
      if (url.pathname === '/me') {
        if (!isB && deferMe) return new Promise<Response>(resolve => { finishMe = resolve; });
        return json(isB ? { ...account, id: 'owner-b', persona: 'Strategy B', permissions: ['pithub.race.read'] } : { ...account, permissions: grants() });
      }
      if (url.pathname === '/me/strategy-preferences') { preferences++; return json({}, 404); }
      if (url.pathname === '/strategies/contexts') {
        contexts++; if (!allowed || isB) return json({}, 403);
        contextQueries.push(url.searchParams);
        if (deferContexts) return new Promise<Response>(resolve => { finishContexts = resolve; });
        if (corpusOverride) return json(corpusOverride);
        const selectedTrack = url.searchParams.get('trackId');
        return json({ contexts: [strategyContextFixture, otherContext, wetContext].filter(c => selectedTrack === null || c.trackId === Number(selectedTrack)), records: selectedTrack === '5' ? 0 : 12, truncated: false, recordLimit: 300, minUsers: 3, minSessions: 6 });
      }
      if (url.pathname === '/strategies/simulate') {
        simulations++; if (!allowed || isB) return json({}, 403);
        const body = JSON.parse(String(init?.body));
        const selected = [strategyContextFixture, otherContext, wetContext].find(c => c.id === body.contextId);
        check(selected && url.searchParams.get('trackId') === String(selected.trackId), 'simulation used the global track instead of the selected card');
        check(body.availableSets.Soft === 1 && body.maxStops === 2 && body.requireTwoCompounds === true, 'form lost explicit tyre constraints');
        if (deferSimulation) return new Promise<Response>(resolve => { finishSimulation = resolve; });
        return json(strategyResultFixture);
      }
      if (url.pathname === '/wallet') return json({ balance: 0, initialized: false });
      if (url.pathname === '/ledger' || url.pathname === '/me/races') return json([]);
      if (url.pathname === '/update-logs') return json({ items: [], hasUnseen: false, latestRevision: '', nextBefore: null });
      return json({}, 404);
    };
    root.render(<StrictMode><HubApp onLaunchLive={() => undefined} /></StrictMode>);
    await until(() => host.textContent?.includes('Strategy A') === true, 'session did not load');
    check(contexts === 0 && simulations === 0 && !host.querySelector('[aria-label="STRATEGY"]'), 'ordinary user ran or saw strategy');
    button(host, 'PROFILE').click();
    await until(() => host.textContent?.includes('페어링 코드') === true, 'profile did not load');
    check(!host.querySelector('[role="switch"]'), 'obsolete opt-in switch remains');
    allowed = true; window.dispatchEvent(new Event('focus'));
    await until(() => !!host.querySelector('[aria-label="STRATEGY"]'), 'grant added after login did not expose navigation');
    button(host, 'STRATEGY').click();
    await until(() => host.textContent?.includes('전략 비교하기') === true, 'workbench did not load');
    check(simulations === 0, 'opening strategy auto-ran a comparison');
    check(cards(host).length === 3 && cards(host)[0].getAttribute('aria-pressed') === 'true', 'initial record cards or selection missing');
    check(host.textContent?.includes('수집 기록 12건 · 경기 조건 3 / 3개'), 'stored record count was confused with eligible conditions');
    check(contextQueries[contextQueries.length - 1]?.get('trackId') === null && host.textContent?.includes('전체 트랙'), 'strategy did not default to all tracks');
    check(cards(host)[0].textContent?.includes('Italy (Monza)') && cards(host)[1].textContent?.includes('Great Britain'), 'all-track cards lost track names');
    selectFilter(host, '트랙', '42');
    await until(() => contextQueries[contextQueries.length - 1]?.get('trackId') === '42' && contextQueries[contextQueries.length - 1]?.get('gameFormat') === 'F1 26', 'Madrid did not select F1 26');
    selectFilter(host, '트랙', '');
    await until(() => cards(host).length === 3 && contextQueries[contextQueries.length - 1]?.get('trackId') === null, 'all-track selection did not restore records');
    selectFilter(host, '게임', 'F1 25');
    await until(() => contextQueries[contextQueries.length - 1]?.get('gameFormat') === 'F1 25' && cards(host).length === 3, 'all tracks inherited Madrid format restriction');
    await searchRecords(host, 'Great Britain');
    check(cards(host).length === 1 && cards(host)[0].textContent?.includes('조건 2'), 'track name search did not find its card');
    button(host, '초기화').click(); await until(() => cards(host).length === 3, 'track search reset failed');
    await searchRecords(host, '  그랑프리 V1.23  ');
    check(cards(host).length === 1 && cards(host)[0].textContent?.includes('조건 2'), 'search lost case folding, combined terms, or stable condition number');
    check(host.textContent?.includes('수집 기록 12건 · 경기 조건 1 / 3개'), 'client-side filtering changed the stored record count');
    check(!host.textContent?.includes('전략 비교하기') && host.textContent?.includes('비교할 조건 카드를 선택하세요'), 'hidden selection retained comparison');
    cards(host)[0].click(); await until(() => host.textContent?.includes('전략 비교하기') === true, 'card selection did not open comparison');
    check(cards(host)[0].getAttribute('aria-pressed') === 'true' && simulations === 0, 'card did not select or auto-ran comparison');
    button(host, '전략 비교하기').click();
    await until(() => host.textContent?.includes('12랩 종료') === true, 'other-track card did not simulate');
    selectFilter(host, '차량 성능', 'equal');
    await until(() => host.textContent?.includes('검색·필터에 맞는 경기 조건이 없습니다') === true, 'search and performance filter did not combine');
    button(host, '초기화').click(); await until(() => cards(host).length === 3, 'reset did not restore cards');
    check(cards(host)[1].getAttribute('aria-pressed') === 'true', 'reset lost selected condition');
    selectFilter(host, '날씨', '3'); selectFilter(host, '총 랩 수', '50');
    await until(() => cards(host).length === 1 && cards(host)[0].textContent?.includes('조건 3') === true, 'weather and lap filters did not combine');
    selectFilter(host, '총 랩 수', '30');
    await until(() => cards(host).length === 0, 'lap options changed with filtering or AND filter failed');
    button(host, '초기화').click(); await until(() => cards(host).length === 3, 'second reset failed');
    cards(host)[0].click(); await pause();
    button(host, '전략 비교하기').click();
    await until(() => host.textContent?.includes('12랩 종료') === true, 'computed plan did not render');
    check(host.textContent?.includes('+0.85초') && host.textContent?.includes('공식 섹터가 아닌 거리 3등분'), 'result units or segment limitation missing');
    deferSimulation = true; button(host, '전략 비교하기').click(); await until(() => finishSimulation !== null, 'filtered simulation not pending');
    await searchRecords(host, '찾을 수 없는 조건');
    check(cards(host).length === 0 && !host.textContent?.includes('전략 비교 중'), 'filter did not unmount pending comparison');
    (finishSimulation as unknown as (r: Response) => void)(json(strategyResultFixture)); await pause(60);
    check(!host.textContent?.includes('12랩 종료'), 'late result leaked after filtering');
    button(host, '초기화').click(); await until(() => host.textContent?.includes('전략 비교하기') === true, 'reset did not restore comparison');
    check(!host.textContent?.includes('12랩 종료'), 'reset restored stale result');
    finishSimulation = null;
    deferSimulation = true; button(host, '전략 비교하기').click(); await until(() => finishSimulation !== null, 'second simulation not pending');
    const trackSelect = [...host.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'Monaco'))!;
    trackSelect.value = '5'; trackSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => host.textContent?.includes('이 조건의 기록을 모으고 있습니다') === true, 'empty context did not render');
    check(host.textContent?.includes('수집 기록 0건') && !host.textContent?.includes('기록은 수집됐지만'), 'empty corpus was confused with excluded records');
    check(host.querySelector('[aria-label="경기 조건 검색 및 필터"]') && host.textContent?.includes('경기 조건 0 / 0개'), 'empty corpus hid record filters or count');
    check(cards(host).length === 0 && !host.textContent?.includes('전략 비교하기'), 'empty corpus displayed a card or comparison');
    selectFilter(host, '날씨', ''); selectFilter(host, '총 랩 수', ''); selectFilter(host, '차량 성능', 'equal');
    await searchRecords(host, 'Monaco');
    check(host.textContent?.includes('이 조건의 기록을 모으고 있습니다') && !host.textContent?.includes('검색·필터에 맞는 경기 조건이 없습니다'), 'empty corpus was confused with a filtered result');
    button(host, '초기화').click(); await pause();
    check(host.querySelector<HTMLInputElement>('input[type="search"]')?.value === '' && host.textContent?.includes('이 조건의 기록을 모으고 있습니다'), 'empty corpus reset hid record browsing');
    const completeSimulation = finishSimulation as unknown as (r: Response) => void; completeSimulation(json(strategyResultFixture)); await pause(60);
    check(!host.textContent?.includes('12랩 종료'), 'late result leaked across track change');
    deferSimulation = false;
    selectFilter(host, '트랙', '0');
    await until(() => host.textContent?.includes('기록은 수집됐지만 비교할 정상 랩이 없습니다') === true, 'excluded records were presented as missing uploads');
    check(host.textContent?.includes('수집 기록 12건 · 경기 조건 0 / 0개') && host.textContent?.includes('제외된 기록은 비교에 사용하지 않습니다'), 'excluded corpus lost its stored count or explanation');
    check(host.textContent?.includes('2026 차량을 사용한다면 게임의 UDP 형식도 2026으로'), 'legacy-format users received no guidance about missing 2026 measurements');
    check(!host.textContent?.includes('이 조건의 기록을 모으고 있습니다') && !host.textContent?.includes('전략 비교하기'), 'excluded corpus displayed collection-only copy or comparison');
    const beforeRefresh = contexts;
    button(host, '다시 확인').click();
    await until(() => contexts > beforeRefresh && host.textContent?.includes('기록은 수집됐지만 비교할 정상 랩이 없습니다') === true, 'excluded corpus could not refresh');
    trackSelect.value = '10'; trackSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => host.textContent?.includes('전략 비교하기') === true, 'track return did not load');
    check(cards(host).length === 2 && cards(host).every(c => c.textContent?.includes('Italy (Monza)')), 'single-track selection included another track');

    // The original flow above also covers a platform response without the new
    // optional diagnostics. Now exercise the real collection-status contract.
    selectFilter(host, '트랙', '');
    await until(() => cards(host).length === 3, 'all-track collection view did not return');
    const noData: StrategyContexts = { ...strategyCorpusFixture, contexts: [], records: 0,
      archiveCoverage: { uploadedRaces: 0, withEvidence: 0, withoutEvidence: 0, latestUploadAt: null, truncated: false, limit: 300 },
      diagnostics: { collectedLaps: 0, cleanLaps: 0, excludedLaps: 0, excludedRecords: 0, exclusions: [] } };
    const showCollection = async (next: StrategyContexts, message: string) => {
      corpusOverride = next;
      const before = contexts;
      button(host, '새로고침').click();
      await until(() => contexts > before && host.textContent?.includes(message) === true, `collection refresh missing: ${message}`);
    };
    await showCollection(noData, '이 조건에 업로드된 레이스가 없습니다');
    check(host.textContent?.includes('로그인과 인터넷 연결') && host.querySelector('[aria-label="레이스 업로드 현황"]'), 'confirmed empty uploads lost status or guidance');
    await showCollection({ ...noData, archiveCoverage: { ...noData.archiveCoverage!, uploadedRaces: 5, withoutEvidence: 5 } }, '레이스 업로드에 전략 계측이 없습니다');
    check(host.textContent?.includes('최근 레이스 업로드 5건에는') && !host.textContent?.includes('업로드된 레이스가 없습니다'), 'existing uploads were presented as no data');
    await showCollection({ ...noData, records: 2, archiveCoverage: { ...noData.archiveCoverage!, uploadedRaces: 2, withEvidence: 2 },
      diagnostics: { collectedLaps: 14, cleanLaps: 0, excludedLaps: 14, excludedRecords: 2,
        exclusions: [{ code: 'damage', records: 1, laps: 8 }, { code: 'traffic', records: 1, laps: 8 }, { code: 'flashback', records: 1, laps: 0 }] } },
    '기록은 수집됐지만 비교할 정상 랩이 없습니다');
    check(host.querySelector('[aria-label="전략 랩 수집 현황"]')?.textContent?.includes('제외된 랩14랩'), 'overlapping flags replaced distinct excluded count');
    check(host.textContent?.includes('한 랩에 여러 사유가 겹칠 수 있어') && host.textContent?.includes('되감기0랩1건'), 'exclusion overlap or zero-lap session reasons disappeared');
    const sparse: StrategyContexts = { ...strategyCorpusFixture, records: 2, minUsers: 4, minSessions: 8, minCleanLaps: 60,
      contexts: [strategyContextFixture, otherContext].map(c => ({ ...c, users: 1, sessions: 1, cleanLaps: 2 })),
      archiveCoverage: { ...noData.archiveCoverage!, uploadedRaces: 2, withEvidence: 2 },
      diagnostics: { collectedLaps: 6, cleanLaps: 4, excludedLaps: 2, excludedRecords: 0, exclusions: [{ code: 'race-start', records: 2, laps: 2 }] } };
    const simulationsBeforeCollection = simulations;
    await showCollection(sparse, '2 / 60랩');
    check(cards(host).length === 2 && simulations === simulationsBeforeCollection, 'small cohorts disappeared or auto-ran analysis');
    check(host.querySelector<HTMLProgressElement>('[aria-label="정상 랩 최소 기준"]')?.max === 60, 'progress ignored server thresholds');
    cards(host)[1].click(); await pause(); await searchRecords(host, 'Great Britain');
    check(cards(host).length === 1, 'collection search did not select a unique record');
    finishSimulation = null; deferSimulation = true;
    button(host, '전략 비교하기').click(); await until(() => finishSimulation !== null, 'simulation was not pending before refresh');
    const refreshes = contexts;
    button(host, '새로고침').click();
    await until(() => contexts > refreshes && cards(host).length === 1 && cards(host)[0].getAttribute('aria-pressed') === 'true', 'refresh lost the selected context');
    check(host.querySelector<HTMLInputElement>('input[type="search"]')?.value === 'Great Britain', 'refresh reset the search filter');
    (finishSimulation as unknown as (r: Response) => void)(json(strategyResultFixture)); await pause(60);
    check(!host.textContent?.includes('12랩 종료'), 'late simulation result leaked after refreshing collection data');
    deferSimulation = false;

    deferContexts = true; button(host, '새로고침').click();
    await until(() => finishContexts !== null, 'collection query was not pending before changing tracks');
    deferContexts = false; corpusOverride = noData;
    selectFilter(host, '트랙', '7');
    await until(() => host.textContent?.includes('이 조건에 업로드된 레이스가 없습니다') === true, 'new track did not load its collection state');
    (finishContexts as unknown as (r: Response) => void)(json(sparse)); await pause(60);
    check(cards(host).length === 0 && !host.textContent?.includes('2 / 60랩'), 'late diagnostics crossed track boundaries');
    corpusOverride = undefined;
    selectFilter(host, '트랙', '');
    await until(() => cards(host).length === 3 && host.textContent?.includes('전략 비교하기') === true, 'legacy response did not return');
    check(!host.querySelector('[aria-labelledby="strategy-collection-title"]'), 'missing diagnostics were fabricated after refresh');

    button(host, '전략 비교하기').click(); await until(() => host.textContent?.includes('12랩 종료') === true, 'result missing before revoke');
    allowed = false; button(host, '전략 비교하기').click();
    await until(() => !host.querySelector('[aria-label="STRATEGY"]') && host.textContent?.includes('관리자에게 권한을 요청하세요') === true, '403 did not remove access');
    check(!host.textContent?.includes('12랩 종료'), '403 retained results');
    allowed = true; window.dispatchEvent(new Event('focus'));
    await until(() => host.textContent?.includes('전략 비교하기') === true, 're-grant did not restore workbench');
    finishSimulation = null; deferSimulation = true; button(host, '전략 비교하기').click();
    await until(() => finishSimulation !== null, 'simulation was not pending before focus revoke');
    allowed = false; window.dispatchEvent(new Event('focus'));
    await until(() => !host.querySelector('[aria-label="STRATEGY"]'), 'focus did not pick up revoke');
    (finishSimulation as unknown as (r: Response) => void)(json(strategyResultFixture)); await pause(60);
    check(!host.textContent?.includes('12랩 종료'), 'late result restored revoked access');
    // Permission refresh already in flight when another account logs in.
    deferMe = true; window.dispatchEvent(new Event('focus'));
    await until(() => finishMe !== null, 'permission refresh not pending');
    localStorage.setItem(PARENT_TOKEN_KEY, 'token-b'); window.dispatchEvent(new StorageEvent('storage', { key: PARENT_TOKEN_KEY, oldValue: 'token-a', newValue: 'token-b', storageArea: localStorage }));
    await until(() => host.textContent?.includes('Strategy B') === true, 'new account did not load');
    (finishMe as unknown as (r: Response) => void)(json({ ...account, permissions: ['pithub'] })); await pause(60);
    check(!host.querySelector('[aria-label="STRATEGY"]') && !host.textContent?.includes('12랩 종료'), 'late permission grant crossed account boundary');
    check(preferences === 0, 'obsolete opt-in API was called');
    return 'Strategy browser: upload/measurement/eligible counts, exclusions and overlap, optional diagnostics, server progress thresholds, refresh preserving selection and filters, late collection/simulation responses, empty states, permission grant/revoke, manual comparison and units passed';
  } finally {
    root.unmount(); host.remove(); window.fetch = originalFetch;
    if (previousToken === null) localStorage.removeItem(PARENT_TOKEN_KEY); else localStorage.setItem(PARENT_TOKEN_KEY, previousToken);
  }
}
