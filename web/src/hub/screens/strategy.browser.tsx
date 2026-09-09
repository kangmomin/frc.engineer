import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HubApp } from '../HubApp';
import { PARENT_TOKEN_KEY, clearViewAsSession } from '../data/session';
import { strategyContextFixture, strategyResultFixture } from '../data/strategy.testdata';

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
  let finishMe: ((r: Response) => void) | null = null, finishSimulation: ((r: Response) => void) | null = null;
  const grants = () => ['pithub.race.read', 'pithub.race.create', ...(allowed ? ['pithub.strategy.read'] : [])];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const otherContext = structuredClone(strategyContextFixture);
  otherContext.id = 'b'.repeat(32); otherContext.weather = 2; otherContext.conditions.totalLaps = 50;
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
        return json({ contexts: url.searchParams.get('trackId') === '5' ? [] : [strategyContextFixture, otherContext, wetContext], records: 12, truncated: false, recordLimit: 300, minUsers: 3, minSessions: 6 });
      }
      if (url.pathname === '/strategies/simulate') {
        simulations++; if (!allowed || isB) return json({}, 403);
        const body = JSON.parse(String(init?.body));
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
    await searchRecords(host, '  그랑프리 V1.23  ');
    check(cards(host).length === 1 && cards(host)[0].textContent?.includes('조건 2'), 'search lost case folding, combined terms, or stable condition number');
    check(!host.textContent?.includes('전략 비교하기') && host.textContent?.includes('비교할 조건 카드를 선택하세요'), 'hidden selection retained comparison');
    cards(host)[0].click(); await until(() => host.textContent?.includes('전략 비교하기') === true, 'card selection did not open comparison');
    check(cards(host)[0].getAttribute('aria-pressed') === 'true' && simulations === 0, 'card did not select or auto-ran comparison');
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
    const completeSimulation = finishSimulation as unknown as (r: Response) => void; completeSimulation(json(strategyResultFixture)); await pause(60);
    check(!host.textContent?.includes('12랩 종료'), 'late result leaked across track change');
    deferSimulation = false;
    trackSelect.value = '10'; trackSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => host.textContent?.includes('전략 비교하기') === true, 'track return did not load');
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
    return 'Strategy browser: record cards, combined search/filters, reset, selection and stale filtered results, permission entry/grant/revoke, manual comparison, units and stale track/account responses passed';
  } finally {
    root.unmount(); host.remove(); window.fetch = originalFetch;
    if (previousToken === null) localStorage.removeItem(PARENT_TOKEN_KEY); else localStorage.setItem(PARENT_TOKEN_KEY, previousToken);
  }
}
