import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../App';
import { PlatformMarket } from '../data/platform';
import type { RaceAnalysisListOptions, PlatformMySetupParams } from '../data/platform';
import type { IncidentReplay, RaceAnalysisDetail, RaceAnalysisListItem, RaceAnalysisListResponse, RaceAnalysisShare, SectionCompleteness } from '../data/raceAnalysisTypes';
import { SETUP_FIELDS } from '../data/setupFields';
import { buildTheme } from '../theme';
import { Analysis } from './Analysis';

const complete: SectionCompleteness = { status: 'complete', reasons: [], capturedCount: 1, storedCount: 1 };
const participants: IncidentReplay['participants'] = [
  { idx: 0, name: 'Minmo', teamId: 0, isPlayer: true, minDistM: 0 },
  { idx: 23, name: 'Driver 24', teamId: 255, isPlayer: false, minDistM: 1.23 },
];
const clip: IncidentReplay = {
  raceId: 'race-a', index: 0, schemaVersion: 2, sessionTimeMs: 4_000, windowStartMs: 1_000, frameIntervalMs: 100, lap: 7,
  collisions: [[0, 23]], participants,
  frames: Array.from({ length: 61 }, (_, i) => ({ tMs: 1_000 + i * 100, telemetryUnavailable: i === 30 ? [23] : [], cars: [
    [i * 2, 0, Math.sin(i / 12) * 18, 20, 0, 5, Math.PI / 2, 0, 0, 120.12345 + i, .678912, .123456, -.234567, 4],
    [i * 2 + 10, 0, Math.sin(i / 12) * 18 + 3, 20, 0, 5, Math.PI / 2, 0, 0, 122.23456, .7, .1, -.1, 4],
  ] })),
  completeness: { status: 'complete', reasons: [], capturedParticipantCount: 2, storedParticipantCount: 2, capturedFrameCount: 61, storedFrameCount: 61 },
};
const detail: RaceAnalysisDetail = {
  id: 'race-a', track: { id: 10, name: 'Italy (Monza)' }, gameFormat: 'F1 26', sessionType: 'Race',
  recordedAt: '2026-09-04T10:00:00Z', uploadedAt: '2026-09-04T10:01:00Z', finishPosition: 2, completedLaps: 27, bestLapMs: 82_123, schemaVersion: 2,
  laps: Array.from({ length: 8 }, (_, i) => ({ lapNumber: i + 1, lapMs: 82_123 + i * 183, s1Ms: 27_111, s2Ms: 28_222, s3Ms: 26_790 + i * 183, tyre: i < 4 ? 'Medium' : 'Hard', valid: true })),
  stints: [{ compound: 'Medium', laps: 14, startLap: 1, endLap: 14, tireWearPct: 23.123456 }, { compound: 'Hard', laps: 13, startLap: 15, endLap: 27, tireWearPct: 11.345678 }],
  dynamics: [{ lapNumber: 1, understeerPct: 1.234567, oversteerPct: 2.345678, lockupCount: 3, spinCount: 0 }],
  penalties: { timePenaltySeconds: 0, warnings: 1, cornerCutWarnings: 1, unservedDriveThrough: 0, unservedStopGo: 0 },
  tyres: { finalCompound: 'Hard', finalAge: 13, averageWearPct: 17.12345, peakWearPct: 23.12345, finalSetWearPct: 11.34567, lifeSpan: 30, usableLife: 25, lifeRemainingPct: 52.23456 },
  events: [{ lap: 7, timestamp: 4_000, category: 'COLL', severity: 'warning', message: 'Contact at the first chicane', driverName: 'Minmo' }],
  pitMeasurement: { stops: 1, pitLaneTimeMs: 23_456, stationaryMs: 2_789 },
  trackOutline: { points: [[-800, -500], [500, 700], [800, 100], [0, 0], [-800, -500]], bounds: { minX: -800, maxX: 800, minZ: -500, maxZ: 700 } },
  incidents: [{ ...clip, frameCount: clip.frames.length }],
  sectionCompleteness: { laps: complete, sectors: complete, stints: complete, tyres: complete, dynamics: complete, penalties: complete, events: complete, pit: complete, incidents: complete, trackOutline: complete },
};
const rows: RaceAnalysisListItem[] = ['Italy (Monza)', 'Mexico', 'Great Britain'].map((name, index) => ({
  ...detail, id: `race-${String.fromCharCode(97 + index)}`, track: { id: 10 + index, name }, incidentCount: index === 0 ? 1 : 0,
  completeness: { analysis: complete, incidents: complete },
}));
const setup = Object.fromEntries(SETUP_FIELDS.map(({ key }) => [key, key === 'frontCamber' ? -2.734567 : 5])) as unknown as PlatformMySetupParams;
const t = buildTheme('#e0a83d', 'light');
const account = { id: 'owner', steamId64: '0', persona: 'Minmo', avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '', permissions: ['pithub.race'] };
const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 4_000;
  while (!predicate()) { check(performance.now() < deadline, message); await wait(); }
}
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const value = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label);
  check(value, `Missing button ${label}`); return value;
}
function tab(container: HTMLElement, label: string): HTMLButtonElement {
  const value = [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((candidate) => candidate.textContent?.startsWith(label));
  check(value, `Missing tab ${label}`); return value;
}
async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait();
}

class TestMarket extends PlatformMarket {
  share: RaceAnalysisShare | null = null;
  incidentRequests = 0;
  lists: RaceAnalysisListOptions[] = [];
  delayed: Array<(value: RaceAnalysisListResponse) => void> = [];
  override async listRaceAnalyses(options: RaceAnalysisListOptions | number = {}): Promise<RaceAnalysisListResponse> {
    const query = typeof options === 'number' ? { limit: options } : options;
    this.lists.push(query);
    if (query.search === 'old' || query.search === 'new') return new Promise((resolve) => this.delayed.push(resolve));
    return { items: rows.filter((row) => row.track.name.toLowerCase().includes(query.search?.toLowerCase() ?? '')), nextOffset: null };
  }
  override async getRaceAnalysis(id: string) { return { ...detail, id }; }
  override async getRaceAnalysisIncident() { this.incidentRequests++; return clip; }
  override async getRaceAnalysisShare() { return this.share; }
  override async setRaceAnalysisShare(_id: string, includeSetup: boolean) { return this.share = { token: '00000000-0000-4000-8000-000000000001', includeSetup }; }
  override async deleteRaceAnalysisShare() { this.share = null; }
}

async function ownerNavigationAndReplay() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const market = new TestMarket();
  try {
    root.render(<StrictMode><Analysis t={t} market={market} configured account={account} /></StrictMode>);
    await until(() => !!host.querySelector('[class*=raceButton]'), 'Race records did not load');
    check(!host.querySelector('aside'), 'Race archive still uses a sidebar');
    check(!host.querySelector('[role=tablist]'), 'Detail is visible before selecting a race');
    const search = () => host.querySelector<HTMLInputElement>('input[type=search]')!;
    await type(search(), 'Monza'); button(host, '필터 적용').click();
    await until(() => host.querySelectorAll('[class*=raceButton]').length === 1, 'Server filtering was not applied');
    host.querySelector<HTMLButtonElement>('[class*=raceButton]')!.click();
    await until(() => !!host.querySelector('[role=tablist]'), 'Detail did not open');
    check(!host.querySelector('#analysis-race-list-title'), 'Race records remained beside detail');
    check(host.querySelectorAll('[role=tabpanel]:not([hidden])').length === 1, 'Multiple data tabs are visible');
    tab(host, '주행 분석').click(); await wait();
    check(host.querySelector('[role=tabpanel]:not([hidden])')!.textContent!.includes('1.235%'), 'Dynamics lacks three-decimal rounding');
    const dynamicsTab = tab(host, '주행 분석'); dynamicsTab.focus(); dynamicsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await wait();
    check(document.activeElement === tab(host, '페널티 / 이벤트'), 'Tab arrow key did not move focus');
    tab(host, '사고 리플레이').click(); await wait();
    check(market.incidentRequests === 0, 'Tab prefetched incident frames without a selection');
    host.querySelector<HTMLButtonElement>('[class*=incidentButton]')!.click();
    await until(() => !!host.querySelector('input[type=range]'), 'Incident did not load');
    const slider = () => host.querySelector<HTMLInputElement>('input[type=range]')!;
    const carX = () => host.querySelector('svg circle')!.getAttribute('cx');
    const initialX = carX();
    check(host.textContent!.includes('120.123 km/h') && host.textContent!.includes('67.891%') && host.textContent!.includes('-0.235'), 'Telemetry precision is inconsistent');
    button(host, 'Play').click();
    await until(() => Number(slider().value) > 1_200, 'RAF playback did not advance measured time');
    check(carX() !== initialX, 'Playback time advanced without moving cars');
    button(host, 'Pause').click(); await wait(); const pausedAt = slider().value;
    await wait(140); check(slider().value === pausedAt, 'Pause continued advancing');
    button(host, '2×').click(); button(host, 'Play').click();
    await until(() => Number(slider().value) > Number(pausedAt) + 300, 'Rate/resume did not advance');
    button(host, 'Pause').click(); await wait();
    button(host, '사고 시점').click(); await until(() => slider().value === '4000', 'Collision seek was not exact');
    check(host.querySelector('table[aria-label="Incident vehicle telemetry"] tbody tr:last-child')!.textContent!.includes('—'), 'Unavailable telemetry was shown as current');
    button(host, 'Next measured frame').click(); await until(() => slider().value === '4100', 'Next frame did not use measured timestamps');
    button(host, 'Previous measured frame').click(); await until(() => slider().value === '4000', 'Previous frame did not step');
    button(host, '끝').click(); await until(() => slider().value === '7000', 'End seek failed');
    button(host, 'Replay').click(); await until(() => Number(slider().value) < 4_000, 'Replay did not restart at beginning');
    button(host, 'Pause').click(); await wait();
    const originalX = carX(); button(host, '확대').click(); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.500×' && carX() !== originalX, 'Zoom did not change camera');
    button(host, '사고 구간 맞춤').click(); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.000×', 'Fit did not reset zoom');
    const map = host.querySelector<HTMLElement>('[class*=svgWrap]')!; const rect = map.getBoundingClientRect();
    map.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true })); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.200×', 'Wheel zoom failed');
    button(host, '전체 트랙').click(); await wait(); check(carX() !== originalX, 'Track fit did not change projection');
    button(host, 'Play').click(); await wait(); tab(host, '랩 / 섹터').click(); await wait();
    check(!host.querySelector('input[type=range]'), 'Replay keeps running in an inactive tab');
    tab(host, '사고 리플레이').click(); await until(() => !!host.querySelector('input[type=range]'), 'Selected clip did not restore');
    check(button(host, 'Play').getAttribute('aria-pressed') === 'false', 'Reopened replay is still playing');

    host.querySelector('summary')!.click(); await until(() => !!host.querySelector('input[type=checkbox]:not(:disabled)'), 'Share settings did not open');
    check(!host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked, 'Setup was public by default');
    button(host, '공유 링크 만들기').click(); await until(() => market.share !== null, 'Share link was not created'); await wait();
    const link = host.querySelector<HTMLInputElement>('input[readonly]')!.value;
    check(new URL(link).hash.includes('raceShare=') && !new URL(link).search, 'Share URL contains unrelated params or exposes capability in query');
    host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); await wait(); button(host, '공개 설정 저장').click();
    await until(() => market.share?.includeSetup === true, 'Setup visibility did not save'); await wait();
    button(host, '공유 중단').click(); await until(() => market.share === null, 'Revoke did not complete'); await wait();
    check(!host.querySelector('input[readonly]'), 'Revoked link stayed visible');
    button(host, '← 레이스 기록').click(); await until(() => !!search(), 'Back did not open records');
    check(search().value === 'Monza', 'Back navigation lost filters');
    await type(search(), 'old'); button(host, '필터 적용').click(); await until(() => market.delayed.length === 1, 'Old filter request did not start');
    await type(search(), 'new'); button(host, '필터 적용').click(); await until(() => market.delayed.length === 2, 'New filter request did not start');
    market.delayed[1]({ items: [rows[1]], nextOffset: null }); await until(() => host.textContent!.includes('Mexico'), 'Newest filter response missing');
    market.delayed[0]({ items: [rows[0]], nextOffset: null }); await wait();
    check(!host.textContent!.includes('Italy (Monza)'), 'Stale filter result replaced current records');
    check(market.lists[market.lists.length - 1]?.offset === 0, 'Filter changes did not reset pagination');
  } finally { root.unmount(); host.remove(); }
}

async function anonymousRoute() {
  const getDetail = PlatformMarket.prototype.getSharedRaceAnalysis;
  const getIncident = PlatformMarket.prototype.getSharedRaceAnalysisIncident;
  const originalFetch = window.fetch; const originalHash = window.location.hash;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let publicReads = 0; let incidentReads = 0; let showSetup = false;
  try {
    window.fetch = () => { throw new Error('Anonymous share bootstrapped an authenticated request'); };
    PlatformMarket.prototype.getSharedRaceAnalysis = async () => { publicReads++; return { detail, includeSetup: showSetup, ...(showSetup ? { setup } : {}) }; };
    PlatformMarket.prototype.getSharedRaceAnalysisIncident = async () => { incidentReads++; return clip; };
    window.history.replaceState(null, '', `${window.location.pathname}#raceShare=public-token`);
    root.render(<App />);
    await until(() => !!host.querySelector('[role=tablist]'), 'Anonymous link did not open detail');
    check(publicReads > 0 && !host.textContent!.includes('로그인이 필요합니다'), 'Shared detail required login');
    check(![...host.querySelectorAll('[role=tab]')].some((item) => item.textContent === '셋업'), 'Hidden setup tab was rendered');
    tab(host, '사고 리플레이').click(); await wait(); host.querySelector<HTMLButtonElement>('[class*=incidentButton]')!.click();
    await until(() => incidentReads > 0 && !!host.querySelector('input[type=range]'), 'Anonymous replay did not load');
    showSetup = true; window.location.hash = 'raceShare=public-with-setup';
    await until(() => [...host.querySelectorAll('[role=tab]')].some((item) => item.textContent === '셋업'), 'Visible setup tab did not render');
    tab(host, '셋업').click(); await wait();
    check(host.querySelector('[role=tabpanel]:not([hidden])')!.textContent!.includes('-2.735'), 'Shared setup precision failed');
  } finally {
    root.unmount(); host.remove(); window.fetch = originalFetch;
    PlatformMarket.prototype.getSharedRaceAnalysis = getDetail; PlatformMarket.prototype.getSharedRaceAnalysisIncident = getIncident;
    window.history.replaceState(null, '', `${window.location.pathname}${originalHash}`);
  }
}

export async function run() {
  await ownerNavigationAndReplay();
  await anonymousRoute();
  return 'PitHub analysis browser: archive/filter races, tabs, RAF playback, zoom, sharing and anonymous routing passed.';
}

// Used for manual desktop/mobile visual inspection with the same test data.
export async function preview(screen: 'records' | 'laps' | 'incidents' = 'records') {
  document.body.style.margin = '0'; document.body.style.padding = '24px'; document.body.style.background = '#f4f5f7';
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  root.render(<Analysis t={t} market={new TestMarket()} configured account={account} />);
  await until(() => !!host.querySelector('[class*=raceButton]'), 'Preview records missing');
  if (screen !== 'records') {
    host.querySelector<HTMLButtonElement>('[class*=raceButton]')!.click(); await until(() => !!host.querySelector('[role=tablist]'), 'Preview detail missing');
    if (screen === 'incidents') { tab(host, '사고 리플레이').click(); await wait(); host.querySelector<HTMLButtonElement>('[class*=incidentButton]')!.click(); await until(() => !!host.querySelector('input[type=range]'), 'Preview replay missing'); }
  }
}
