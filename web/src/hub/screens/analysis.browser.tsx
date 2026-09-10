import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../App';
import { PlatformMarket } from '../data/platform';
import type { RaceAnalysisListOptions, PlatformMySetupParams } from '../data/platform';
import type { IncidentReplay, RaceAnalysisDetail, RaceAnalysisListItem, RaceAnalysisListResponse, RaceAnalysisShare, SectionCompleteness } from '../data/raceAnalysisTypes';
import { SETUP_FIELDS } from '../data/setupFields';
import { buildTheme } from '../theme';
import { Analysis } from './Analysis';
import { IncidentReplay as IncidentReplayView } from './IncidentReplay';
import { loadReplayTrack } from '../../constants/replayTracks';
import { loadTrackBoundaries } from '../../constants/replayTrackBoundaries';

const complete: SectionCompleteness = { status: 'complete', reasons: [], capturedCount: 1, storedCount: 1 };
const participants: IncidentReplay['participants'] = [
  { idx: 0, name: 'Minmo', teamId: 0, isPlayer: true, minDistM: 0, damageBefore: null, damageAfter: null },
  { idx: 23, name: 'Driver 24', teamId: 255, isPlayer: false, minDistM: 1.23, damageBefore: null, damageAfter: null },
];
// Asymmetric slots catch swapped wing and tyre positions.
const damagedParticipants: IncidentReplay['participants'] = [
  { ...participants[0], damageBefore: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], damageAfter: [42, 0, 0, 15, 0, 0, 0, 0, 100, 0, 0, 0] },
  { ...participants[1], damageBefore: [0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], damageAfter: [0, 60, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0] },
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
const hexRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
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

async function displayDriver(host: HTMLElement, idx: number, value: 'full' | 'car' | 'hidden') {
  const select = host.querySelector<HTMLSelectElement>(`[data-driver-control="${idx}"] select`)!;
  check(select, `Driver #${idx} display control missing`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait();
}

async function driverVisibility() {
  // Same-team drivers with sparse IDs: car idx 23 is at tuple position 1.
  const replay = { ...clip, participants: clip.participants.map((p) => ({ ...p, teamId: 0 })) };
  const host = document.createElement('div'); host.style.width = '360px'; document.body.append(host);
  const root = createRoot(host);
  const render = (value: IncidentReplay) => root.render(<IncidentReplayView t={t} replay={value} trackOutline={detail.trackOutline} />);
  const car = (idx: number) => host.querySelector(`[data-replay-car="${idx}"]`);
  const line = (idx: number) => host.querySelector(`[data-driver-trajectory="${idx}"]`);
  const mode = (idx: number) => host.querySelector<HTMLSelectElement>(`[data-driver-control="${idx}"] select`)!.value;
  const timeline = () => host.querySelector<HTMLInputElement>('input[type=range]')!;
  try {
    render(replay);
    await until(() => host.querySelectorAll('[data-car-body]').length === 2, 'Driver fixtures did not load');
    await wait();
    const colors = [0, 23].map((idx) => host.querySelector(`[data-driver-color="${idx}"]`)!.getAttribute('fill'));
    check(colors[0] !== colors[1], 'Teammates share a replay color');
    [0, 23].forEach((idx, i) => {
      check(line(idx)?.getAttribute('stroke') === colors[i], 'Car and trajectory colors differ');
      check(host.querySelector(`[data-overview-car="${idx}"] circle`)!.getAttribute('fill') === colors[i], 'Overview color differs');
      const swatch = host.querySelector(`[data-driver-control="${idx}"] [aria-hidden]`)!;
      check(getComputedStyle(swatch).backgroundColor === getComputedStyle(host.querySelector(`[data-driver-color="${idx}"]`)!).fill, 'Control swatch color differs');
    });
    check(host.querySelector('[data-driver-control]')!.getBoundingClientRect().right <= host.getBoundingClientRect().right, 'Driver controls overflow mobile layout');
    button(host, '확대').click(); button(host, '다음 프레임 →').click(); await wait();
    const transform = car(23)!.querySelector('[data-car-body]')!.getAttribute('transform');
    const trajectory = line(23)!.getAttribute('d');
    const time = timeline().value;
    const zoom = host.querySelector('output[aria-label="확대 배율"]')!.textContent;
    await displayDriver(host, 0, 'car');
    check(car(0) && !line(0) && car(23) && line(23), 'Car-only mode hid the wrong geometry');
    await displayDriver(host, 0, 'hidden');
    check(!car(0) && !line(0) && !host.querySelector('[data-overview-car="0"]') && !host.querySelector('[data-telemetry-driver="0"]'), 'Hidden driver remains visible');
    check(car(23)!.querySelector('[data-car-body]')!.getAttribute('transform') === transform && line(23)!.getAttribute('d') === trajectory, 'Filtering reassigned sparse car tuples or moved the camera');
    check(host.querySelector('[data-telemetry-driver="23"]')!.textContent!.includes('122.235 km/h'), 'Filtering reassigned telemetry tuples');
    check(timeline().value === time && host.querySelector('output[aria-label="확대 배율"]')!.textContent === zoom, 'Filtering reset replay time or zoom');
    button(host, '라인 모두 끄기').click(); await wait();
    check(mode(0) === 'hidden' && mode(23) === 'car' && !line(23), 'Bulk line-off restored a hidden driver');
    await displayDriver(host, 0, 'full');
    check(host.querySelector('[data-driver-color="0"]')!.getAttribute('fill') === colors[0], 'Restoring a driver changed its color');
    button(host, '모두 숨기기').click(); await wait();
    check(!host.querySelector('[data-replay-car], [data-driver-trajectory], [data-overview-car], [data-telemetry-driver]'), 'Hide-all left driver output behind');
    check(host.textContent!.includes('표시 중인 드라이버가 없습니다') && host.querySelectorAll('[data-driver-control]').length === 2, 'Hide-all cannot be recovered');
    check(host.querySelector('svg[aria-label^="Recorded track"] path'), 'Hide-all removed the track');
    await displayDriver(host, 23, 'full');
    check(car(23) && line(23) && !car(0), 'Selecting one driver did not isolate it');
    const select = host.querySelector<HTMLSelectElement>('[data-driver-control="23"] select')!;
    select.focus(); select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    check(timeline().value === time, 'Driver control key changed playback');
    button(host, '사고 시점').click(); await wait();
    check(!host.querySelector('[data-telemetry-driver="23"]')!.textContent!.includes('122.235'), 'Sparse driver freshness was reassigned after hiding');
    button(host, '처음').click(); button(host, 'Play').click(); await wait(60);
    const playingTime = Number(timeline().value);
    await displayDriver(host, 23, 'car'); await wait(60);
    check(button(host, 'Pause').getAttribute('aria-pressed') === 'true' && Number(timeline().value) > playingTime, 'Filtering stopped playback');
    button(host, 'Pause').click();
    render({ ...replay, frames: [...replay.frames] }); await wait();
    check(mode(0) === 'hidden' && mode(23) === 'car', 'Refreshing frames reset driver selections');
    render({ ...replay, index: 1 }); await wait();
    check(mode(0) === 'full' && mode(23) === 'full' && line(0) && line(23), 'New incident inherited hidden drivers');
    button(host, '모두 숨기기').click(); await wait();
    render({ ...replay, raceId: 'race-b', index: 1 }); await wait();
    check(mode(0) === 'full' && mode(23) === 'full', 'New race inherited hidden drivers');
    button(host, '모두 숨기기').click(); await wait(); button(host, '모두 표시').click(); await wait();
    check(car(0) && line(0) && car(23) && line(23), 'Show-all failed to restore drivers');
  } finally { root.unmount(); host.remove(); }
}

async function checkMapDrag(map: HTMLElement) {
  const position = () => {
    for (const element of map.querySelectorAll('path, rect, line, text, g')) {
      check(!/NaN|Infinity/.test(`${element.getAttribute('d')} ${element.getAttribute('transform')}`), 'Dragging produced an invalid SVG path or transform');
      for (const attribute of ['cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'x', 'y']) {
        const value = element.getAttribute(attribute);
        check(value === null || Number.isFinite(Number(value)), `Dragging produced an invalid SVG ${attribute}: ${value}`);
      }
    }
    return map.querySelector('[data-car-body]')!.getBoundingClientRect();
  };
  const rect = map.getBoundingClientRect();
  const pointer = async (type: string, x: number, y: number) => {
    map.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + rect.width / 2 + x, clientY: rect.top + rect.height / 2 + y, bubbles: true,
    }));
    await wait();
  };
  // Synthetic events have no active native pointer to capture. Keep Chrome's
  // real DOMPoint and SVG transforms, stubbing only the capture request.
  const capture = Object.getOwnPropertyDescriptor(map, 'setPointerCapture');
  Object.defineProperty(map, 'setPointerCapture', { configurable: true, value: () => {} });
  try {
    const before = position();
    await pointer('pointerdown', 0, 0);
    check(map.getAttribute('data-dragging') === 'true', 'Pointer down did not start dragging');
    for (const [x, y] of [[18, 9], [45, 25]]) {
      await pointer('pointermove', x, y);
      const after = position();
      check(Math.abs(after.x - before.x - x) < 0.1 && Math.abs(after.y - before.y - y) < 0.1, 'Map did not follow the pointer movement');
    }
    await pointer('pointerup', 45, 25);
    check(map.getAttribute('data-dragging') === 'false', 'Pointer up did not stop dragging');
    const released = position();
    await pointer('pointermove', 60, 40);
    const afterRelease = position();
    check(afterRelease.x === released.x && afterRelease.y === released.y, 'Map kept moving after pointer release');
  } finally {
    if (capture) Object.defineProperty(map, 'setPointerCapture', capture);
    else Reflect.deleteProperty(map, 'setPointerCapture');
  }
}

async function carShapesFollowYaw() {
  const directions = [
    { yaw: 0, x: 0, y: -1 }, { yaw: Math.PI / 2, x: 1, y: 0 },
    { yaw: Math.PI, x: 0, y: 1 }, { yaw: -Math.PI / 2, x: -1, y: 0 },
  ];
  const replay: IncidentReplay = {
    ...clip, participants: directions.map((_, idx) => ({ ...participants[0], idx })),
    frames: [{ ...clip.frames[0], cars: directions.map(({ yaw }, i) => [i * 10, 0, 0, 20, 0, 5, yaw, 0, 0, 120, 1, 0, 0, 4]) }],
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    root.render(<IncidentReplayView t={t} replay={replay} trackOutline={null} />);
    await until(() => host.querySelectorAll('[data-car-body]').length === 4, 'Car silhouettes did not render');
    const bodies = host.querySelectorAll<SVGGElement>('[data-car-body]');
    directions.forEach(({ x, y }, i) => {
      const matrix = bodies[i].getScreenCTM()!;
      const scale = Math.hypot(matrix.c, matrix.d);
      check(Math.abs(-matrix.c / scale - x) < 0.001 && Math.abs(-matrix.d / scale - y) < 0.001, 'Car nose disagrees with recorded yaw');
    });
    const contactReplay: IncidentReplay = {
      ...replay, sessionTimeMs: 1_050, collisions: [[0, 3]],
      frames: [replay.frames[0], { ...replay.frames[0], tMs: 1_070 }],
    };
    root.render(<IncidentReplayView t={t} replay={contactReplay} trackOutline={null} />); await wait();
    check(!host.querySelector('[data-contact-outline]'), 'Between-frame contact was highlighted early');
    button(host, '사고 시점').click(); await wait();
    const outlinedCars = [...host.querySelectorAll('[data-contact-outline]')].map((outline) => outline.closest('g[aria-label]')!.getAttribute('aria-label'));
    check(outlinedCars.length === 2 && outlinedCars[0]!.includes('Car #0') && outlinedCars[1]!.includes('Car #3'), 'Contact outlines included unrelated vehicles');
    button(host, 'Previous measured frame').click(); await wait();
    check(!host.querySelector('[data-contact-outline]'), 'Seeking before a between-frame contact kept outlines');
    for (const sessionTimeMs of [900, 1_100]) {
      root.render(<IncidentReplayView t={t} replay={{ ...contactReplay, sessionTimeMs }} trackOutline={null} />); await wait();
      button(host, '사고 시점').click(); await wait();
      check(!host.querySelector('[data-contact-outline]'), 'Out-of-range contact highlighted a clamped frame');
    }
  } finally { root.unmount(); host.remove(); }
}

async function damageReplay() {
  const damaged: IncidentReplay = { ...clip, participants: damagedParticipants };
  const host = document.createElement('div'); host.style.width = '360px'; document.body.append(host);
  const root = createRoot(host);
  try {
    for (const theme of [t, buildTheme('#e0a83d', 'dark')]) {
      root.render(<IncidentReplayView t={theme} replay={damaged} trackOutline={null} />);
      // Both themes render two cards, so wait for this theme's surface stroke before reading fills.
      await until(() => host.querySelectorAll('[data-damage-driver]').length === 2 && host.querySelector('[data-damage-part]')?.getAttribute('stroke') === theme.panel, 'Damage cards did not render for the theme');
      const fill = (idx: number, part: string) => getComputedStyle(host.querySelector(`[data-damage-driver="${idx}"] [data-damage-part="${part}"]`)!).fill;
      check(fill(0, 'tyre-rl') === hexRgb(theme.damageScale[3]) && fill(0, 'tyre-fl') === hexRgb(theme.damageScale[0]), 'Rear-left and front-left tyre damage colours were swapped');
      check(fill(0, 'wing-fl') === hexRgb(theme.damageScale[1]) && fill(23, 'wing-fr') === hexRgb(theme.damageScale[2]), 'Wing damage colour steps are wrong');
      const panel = host.querySelector<HTMLElement>('[aria-label="Incident vehicle damage"]')!;
      check(panel.scrollWidth <= panel.clientWidth + 1 && panel.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1, 'Damage panel overflows the 360px layout');
    }
    check(host.querySelector('[data-damage-driver="23"] [data-damage-row="wing-fr"]')!.textContent!.includes('구간 중 +48'), 'Increase from the first collision is missing');
    await displayDriver(host, 23, 'hidden');
    check(!host.querySelector('[data-damage-driver="23"]') && host.querySelector('[data-damage-driver="0"]'), 'Hidden driver kept a damage card');
  } finally { root.unmount(); host.remove(); }
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
    const carX = () => host.querySelector('[data-car-body]')!.getBoundingClientRect().x;
    const initialX = carX();
    check(!host.querySelector('[data-contact-outline]'), 'Cars are highlighted before contact');
    const carBody = host.querySelector<SVGGElement>('[data-car-body]')!;
    check(carBody.querySelectorAll('rect').length === 6, 'Replay is missing the car body, four tyres or wings');
    const carMatrix = carBody.getScreenCTM()!;
    check(carMatrix.b > 0 && Math.abs(carMatrix.a) < 0.001, 'Car body is not aligned with recorded yaw');
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
    check(host.querySelectorAll('[data-contact-outline]').length === 2, 'Contact vehicles are missing red outlines');
    check(host.querySelector('table[aria-label="Incident vehicle telemetry"] tbody tr:last-child')!.textContent!.includes('—'), 'Unavailable telemetry was shown as current');
    button(host, 'Next measured frame').click(); await until(() => slider().value === '4100', 'Next frame did not use measured timestamps');
    check(!host.querySelector('[data-contact-outline]'), 'Contact outlines remained after the contact frame');
    button(host, 'Previous measured frame').click(); await until(() => slider().value === '4000', 'Previous frame did not step');
    check(host.querySelectorAll('[data-contact-outline]').length === 2, 'Contact outlines did not restore when seeking back');
    button(host, '끝').click(); await until(() => slider().value === '7000', 'End seek failed');
    button(host, 'Replay').click(); await until(() => Number(slider().value) < 4_000, 'Replay did not restart at beginning');
    button(host, 'Pause').click(); await wait();
    const originalX = carX(); const originalCarWidth = carBody.getBoundingClientRect().width;
    button(host, '확대').click(); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.500×' && carX() !== originalX, 'Zoom did not change camera');
    check(Math.abs(carBody.getBoundingClientRect().width / originalCarWidth - 1.5) < 0.001, 'Car dimensions did not scale with the map');
    button(host, '사고 구간 맞춤').click(); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.000×', 'Fit did not reset zoom');
    const map = host.querySelector<HTMLElement>('[class*=svgWrap]')!; const rect = map.getBoundingClientRect();
    await checkMapDrag(map);
    map.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true })); await wait();
    check(host.querySelector('output[aria-label="확대 배율"]')!.textContent === '1.200×', 'Wheel zoom failed');
    await checkMapDrag(map);
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

async function anonymousRoute(boundaryTrackId?: number) {
  const boundaries = boundaryTrackId === undefined ? null : (await loadTrackBoundaries(boundaryTrackId, 'F1 25'))!;
  const withBoundaries = boundaries !== null;
  const points = withBoundaries
    ? boundaries!.segments[0].sections.map(({ left }) => [left![0], left![2]])
    : (await loadReplayTrack(5, 'F1 26'))!.points.map(([, x, z]) => [x, z]);
  const historicClip: IncidentReplay = { ...clip, participants: damagedParticipants, frames: clip.frames.map((frame, index) => ({ ...frame, cars: frame.cars.map((car) => { if (!car) return null; const [x, z] = points[index]; return [x, car[1], z, ...car.slice(3)] as typeof car; }) })) };
  const getDetail = PlatformMarket.prototype.getSharedRaceAnalysis;
  const getIncident = PlatformMarket.prototype.getSharedRaceAnalysisIncident;
  const originalFetch = window.fetch; const originalHash = window.location.hash;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let publicReads = 0; let incidentReads = 0; let showSetup = false;
  try {
    window.fetch = () => { throw new Error('Anonymous share bootstrapped an authenticated request'); };
    PlatformMarket.prototype.getSharedRaceAnalysis = async () => { publicReads++; return { detail: { ...detail, track: withBoundaries ? { id: boundaryTrackId!, name: boundaries!.provenance.description } : { id: 5, name: 'Monaco' }, gameFormat: withBoundaries ? 'F1 25' : 'F1 26', trackOutline: null }, includeSetup: showSetup, ...(showSetup ? { setup } : {}) }; };
    PlatformMarket.prototype.getSharedRaceAnalysisIncident = async () => { incidentReads++; return historicClip; };
    window.history.replaceState(null, '', `${window.location.pathname}#raceShare=public-token`);
    root.render(<App />);
    await until(() => !!host.querySelector('[role=tablist]'), 'Anonymous link did not open detail');
    check(publicReads > 0 && !host.textContent!.includes('로그인이 필요합니다'), 'Shared detail required login');
    check(![...host.querySelectorAll('[role=tab]')].some((item) => item.textContent === '셋업'), 'Hidden setup tab was rendered');
    tab(host, '사고 리플레이').click(); await wait(); host.querySelector<HTMLButtonElement>('[class*=incidentButton]')!.click();
    await until(() => incidentReads > 0 && !!host.querySelector('input[type=range]'), 'Anonymous replay did not load');
    await until(() => !!host.querySelector('[data-overview-car]'), 'Anonymous legacy reference did not load');
    const sharedTyre = host.querySelector('[data-damage-driver="0"] [data-damage-part="tyre-rl"]');
    check(sharedTyre && getComputedStyle(sharedTyre).fill === hexRgb(buildTheme('#e0a83d', 'light').damageScale[3]), 'Shared replay lost the damage colour scale');
    await displayDriver(host, 0, 'hidden');
    check(!host.querySelector('[data-replay-car="0"], [data-driver-trajectory="0"], [data-overview-car="0"]') && host.querySelector('[data-replay-car="23"]'), 'Anonymous driver filtering failed');
    await displayDriver(host, 0, 'full');
    if (withBoundaries) {
      await until(() => host.querySelectorAll('[data-road-surface]').length === boundaries!.segments.reduce((count, segment) => count + segment.sections.length - 1, 0) * 2, 'Shared road surfaces did not load');
      check(host.textContent!.includes('본선 흰선 사이만 표시합니다') && host.textContent!.includes('경계 오차 미확인'), 'Road coverage or accuracy label missing');
      check(!host.textContent!.includes('트랙 폭 자료 없음'), 'Loaded boundaries still reported unavailable');
      if (boundaries!.coverage === 'main-circuit-partial') check(host.textContent!.includes('일부 구간은 표시에서 제외'), 'Partial road coverage warning missing');
      const road = host.querySelector('[data-road-surface]')!;
      const before = road.getAttribute('d'); button(host, '확대').click(); await wait();
      check(road.getAttribute('d') !== before, 'Road width did not follow the camera zoom');
      check(!/NaN|Infinity/.test(host.querySelector('svg[aria-label^="Reference track boundaries"]')!.outerHTML), 'Road projection is not finite');
    } else check(host.textContent!.includes('참조 트랙'), 'Shared page lost track identity');
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

async function historicalTrackReplay() {
  const reference = (await loadReplayTrack(5, 'F1 26'))!;
  const replay: IncidentReplay = {
    ...clip, schemaVersion: 1,
    participants: Array.from({ length: 24 }, (_, idx) => ({ ...participants[0], idx })),
    frames: [0, 20].map((offset, frameIndex) => ({ tMs: 1000 + frameIndex * 1000, telemetryUnavailable: null,
      cars: Array.from({ length: 24 }, (_, idx) => {
        const [, x, z] = reference.points[offset + idx];
        return [x + 5000, 0, z, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      }),
    })),
  };
  const host = document.createElement('div'); host.style.width = '360px'; document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(<IncidentReplayView t={t} replay={replay} trackOutline={null} trackId={5} gameFormat="F1 26" />);
    await until(() => host.querySelectorAll('[data-overview-car]').length === 24, 'Historic Monaco reference hidden despite valid identity and distant cars');
    check(host.textContent!.includes('참조 트랙') && host.textContent!.includes('T1'), 'Reference provenance or corner labels missing');
    const overview = host.querySelector<SVGElement>('[data-frame-time]')!;
    check(overview.getBoundingClientRect().width <= 360, 'Overview overflows mobile width');
    const start = overview.querySelector('[data-overview-car="23"]')!.getAttribute('transform');
    button(host, '끝').click(); await wait();
    check(overview.getAttribute('data-frame-time') === '2000', 'Overview frame is not synchronized');
    check(overview.querySelector('[data-overview-car="23"]')!.getAttribute('transform') !== start, 'Off-track car did not move');
    const end = overview.querySelector('[data-overview-car="23"]')!.getAttribute('transform');
    button(host, '확대').click(); await wait();
    check(overview.querySelector('[data-overview-car="23"]')!.getAttribute('transform') === end, 'Incident zoom changed the overview');
    root.render(<IncidentReplayView t={t} replay={replay} trackOutline={null} trackId={5} gameFormat="F1 27" />);
    await until(() => host.textContent!.includes('트랙 자료 없음'), 'Unsupported format did not fall back');
    check(!host.querySelector('[data-overview-car]'), 'Previous game reference leaked into another format');
  } finally { root.unmount(); host.remove(); }
}

export async function run() {
  await driverVisibility();
  await historicalTrackReplay();
  await carShapesFollowYaw();
  await damageReplay();
  await ownerNavigationAndReplay();
  await anonymousRoute();
  await anonymousRoute(7);
  await anonymousRoute(12);
  return 'PitHub analysis browser: archive/filter races, tabs, RAF playback, zoom, finite drag coordinates, sharing and anonymous routing passed.';
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
