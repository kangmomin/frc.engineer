// FRC Engineer Hub — mock data source.
// Ports the design's renderVals() data (hub.dc.html:613-851) into RAW values
// (Fable B1). Named-field objects, not heterogeneous tuples (Fable C3).
// Derivation that the design did by mutating rows in-render is instead done as
// pure functions in the screens (Fable C1); this file only supplies raw data.
import { REF_NOW } from '../format';
import type {
  HubDataSource, HubOverview, HubSetupMarket, HubStrategyMarket,
  HubMarketItem, HubReview, HubPerf, HubStrategyItem,
} from './types';
import { EMPTY_OVERVIEW } from './types';

const DAY = 86_400_000;
const ago = (ms: number) => REF_NOW - ms;

const RKEYS: (keyof HubPerf)[] = ['downforce', 'topSpeed', 'cornering', 'tyre', 'response'];

// ---- Setup params helper (hub.dc.html:709) ----
const PARAM_KEYS = ['F.WING', 'R.WING', 'DIFF·ON', 'DIFF·OFF', 'CAMBER·F', 'CAMBER·R', 'TOE·F', 'TOE·R', 'TYRE·P', 'BRK·BIAS'];
const mkParams = (...vals: string[]) => PARAM_KEYS.map((k, i) => ({ k, v: vals[i] }));

// seller-claimed perf per market item (hub.dc.html:736)
const SELLER_PERF: HubPerf[] = [
  { downforce: 55, topSpeed: 92, cornering: 78, tyre: 60, response: 84 },
  { downforce: 70, topSpeed: 74, cornering: 76, tyre: 92, response: 66 },
  { downforce: 68, topSpeed: 82, cornering: 88, tyre: 74, response: 86 },
  { downforce: 88, topSpeed: 58, cornering: 72, tyre: 80, response: 62 },
  { downforce: 62, topSpeed: 80, cornering: 84, tyre: 55, response: 90 },
  { downforce: 72, topSpeed: 72, cornering: 74, tyre: 76, response: 72 },
];

// Deterministic per-review perf (hub.dc.html:750) so community averages are
// self-contained in the mock rather than generated at render time.
function reviewPerf(sellerPerf: HubPerf, reviewIdx: number): HubPerf {
  const out = {} as HubPerf;
  RKEYS.forEach((k, ki) => {
    const j = ((reviewIdx * 7 + ki * 13) % 17) - 8;
    out[k] = Math.max(3, Math.min(99, sellerPerf[k] + j));
  });
  return out;
}

interface RawReview { reviewer: string; stars: number; verifiedBuyer: boolean; text: string; atMs: number }

// ---- Setup market (hub.dc.html:710-735) ----
interface RawMarket {
  title: string; creator: string; team: string; track: string; cond: string; fmt: string;
  verified: boolean; priceCredits: number | null; rating: number; reviewCount: number; showRaces: boolean;
  params: { k: string; v: string }[];
  reviews: RawReview[];
  raceSummary: { n: number; avgFinish: number; wins: number; bestMs: number; races: { track: string; pos: number; lapMs: number }[] };
}

const MARKET: RawMarket[] = [
  {
    title: 'Silverstone — Qualifying Trim', creator: 'APX_leon', team: 'RedBull', track: 'SILVERSTONE', cond: 'DRY', fmt: 'F1 25',
    verified: true, priceCredits: 340, rating: 4.7, reviewCount: 32, showRaces: true,
    params: mkParams('32', '24', '68%', '52%', '-2.9°', '-1.4°', '0.08°', '0.22°', '23.5', '54%'),
    reviews: [
      { reviewer: 'v_soo.r', stars: 5, verifiedBuyer: true, text: 'Q3에서 바로 PB. 하이스피드 코너 신뢰감이 확실합니다.', atMs: ago(3 * DAY) },
      { reviewer: 'late_braker', stars: 4, verifiedBuyer: true, text: '좋은데 트랙션존에서 리어가 살짝 나감. 디퍼렌셜 조금 낮추니 해결.', atMs: ago(6 * DAY) },
    ],
    raceSummary: { n: 18, avgFinish: 3.4, wins: 4, bestMs: 85900, races: [
      { track: 'Silverstone GP', pos: 1, lapMs: 86000 }, { track: 'Silverstone GP', pos: 2, lapMs: 86200 }, { track: 'Silverstone GP', pos: 4, lapMs: 86400 },
    ] },
  },
  {
    title: 'Race Stint — Low Deg', creator: 'nightPace', team: 'McLaren', track: 'SILVERSTONE', cond: 'DRY', fmt: 'F1 25',
    verified: true, priceCredits: 420, rating: 4.5, reviewCount: 21, showRaces: true,
    params: mkParams('28', '22', '55%', '48%', '-3.1°', '-1.6°', '0.06°', '0.20°', '22.8', '56%'),
    reviews: [
      { reviewer: 'boxbox_77', stars: 5, verifiedBuyer: true, text: '스틴트 후반 타이어 확실히 오래 감. 롱런 페이스 최고.', atMs: ago(2 * DAY) },
      { reviewer: 'apex_hunter', stars: 4, verifiedBuyer: true, text: '한 랩은 조금 느린데 레이스에선 이득. 의도대로네요.', atMs: ago(5 * DAY) },
    ],
    raceSummary: { n: 24, avgFinish: 4.1, wins: 2, bestMs: 86300, races: [
      { track: 'Silverstone GP', pos: 2, lapMs: 86300 }, { track: 'Silverstone GP', pos: 3, lapMs: 86600 }, { track: 'Silverstone GP', pos: 5, lapMs: 86900 },
    ] },
  },
  {
    title: 'Fastest on board', creator: 'ghost_lap', team: 'Mercedes', track: 'SILVERSTONE', cond: 'DRY', fmt: 'F1 25',
    verified: true, priceCredits: null, rating: 4.9, reviewCount: 6, showRaces: false,
    params: mkParams('30', '23', '62%', '50%', '-3.0°', '-1.5°', '0.07°', '0.21°', '23.1', '55%'),
    reviews: [
      { reviewer: 'nightPace', stars: 5, verifiedBuyer: false, text: '보드 최속인데 미판매라 아쉬움. 참고만 해도 배울 게 많음.', atMs: ago(7 * DAY) },
    ],
    raceSummary: { n: 9, avgFinish: 1.8, wins: 6, bestMs: 85700, races: [
      { track: 'Silverstone GP', pos: 1, lapMs: 85700 }, { track: 'Silverstone GP', pos: 1, lapMs: 85900 },
    ] },
  },
  {
    title: 'Wet — Balanced Grip', creator: 'rainmaster', team: 'McLaren', track: 'SILVERSTONE', cond: 'WET', fmt: 'F1 25',
    verified: true, priceCredits: 280, rating: 4.2, reviewCount: 14, showRaces: false,
    params: mkParams('38', '34', '50%', '45%', '-2.6°', '-1.2°', '0.10°', '0.26°', '21.5', '58%'),
    reviews: [
      { reviewer: 'drs_open', stars: 4, verifiedBuyer: true, text: '젖은 노면에서 안정적. 인터미디엇 구간도 무난.', atMs: ago(4 * DAY) },
      { reviewer: 'to_the_limit', stars: 5, verifiedBuyer: true, text: '풀웻에서 자신감 생김. 스로틀 초반이 부드러움.', atMs: ago(7 * DAY) },
    ],
    raceSummary: { n: 11, avgFinish: 3.9, wins: 1, bestMs: 97400, races: [
      { track: 'Silverstone GP', pos: 2, lapMs: 97400 }, { track: 'Silverstone GP', pos: 4, lapMs: 98100 },
    ] },
  },
  {
    title: 'Kerb Rider — Aggressive', creator: 'drs_open', team: 'Aston', track: 'SILVERSTONE', cond: 'DRY', fmt: 'F1 26',
    verified: false, priceCredits: 190, rating: 3.8, reviewCount: 9, showRaces: true,
    params: mkParams('34', '26', '72%', '54%', '-2.8°', '-1.3°', '0.09°', '0.24°', '23.8', '53%'),
    reviews: [
      { reviewer: 'late_braker', stars: 4, verifiedBuyer: true, text: '커브 공격적으로 탈 수 있음. 대신 실수 여지도 큼.', atMs: ago(3 * DAY) },
      { reviewer: 'grip_limited', stars: 3, verifiedBuyer: true, text: '미검증이라 조심스러웠는데 나쁘진 않음. 리어가 예민.', atMs: ago(6 * DAY) },
    ],
    raceSummary: { n: 7, avgFinish: 6.2, wins: 0, bestMs: 86800, races: [
      { track: 'Silverstone GP', pos: 5, lapMs: 86800 }, { track: 'Silverstone GP', pos: 7, lapMs: 87200 },
    ] },
  },
  {
    title: 'Balanced All-Rounder', creator: 'boxbox_77', team: 'Williams', track: 'SILVERSTONE', cond: 'DRY', fmt: 'F1 25',
    verified: true, priceCredits: 240, rating: 4.4, reviewCount: 17, showRaces: true,
    params: mkParams('31', '25', '60%', '50%', '-2.9°', '-1.5°', '0.08°', '0.22°', '23.2', '55%'),
    reviews: [
      { reviewer: 'apex_hunter', stars: 4, verifiedBuyer: true, text: '무난하게 빠름. 입문용으로도 추천.', atMs: ago(2 * DAY) },
      { reviewer: 'v_soo.r', stars: 5, verifiedBuyer: true, text: '밸런스가 정말 좋아서 어디서든 탈만함.', atMs: ago(5 * DAY) },
    ],
    raceSummary: { n: 17, avgFinish: 4.6, wins: 1, bestMs: 86500, races: [
      { track: 'Silverstone GP', pos: 3, lapMs: 86500 }, { track: 'Silverstone GP', pos: 4, lapMs: 86800 }, { track: 'Silverstone GP', pos: 6, lapMs: 87000 },
    ] },
  },
];

function toMarketItem(m: RawMarket, idx: number): HubMarketItem {
  const perf = SELLER_PERF[idx];
  const reviews: HubReview[] = m.reviews.map((r, ri) => ({ ...r, perf: reviewPerf(perf, ri) }));
  return { id: `setup-${idx}`, ...m, perf, reviews };
}

// ---- Similar setups (hub.dc.html:794-799) ----
const SIMILAR_SETUPS = [
  { handle: 'ghost_lap', team: 'Mercedes', distPct: 3.8, priceCredits: null },
  { handle: 'APX_leon', team: 'RedBull', distPct: 4.2, priceCredits: 340 },
  { handle: 'nightPace', team: 'McLaren', distPct: 5.1, priceCredits: 420 },
  { handle: 'drs_open', team: 'Aston', distPct: 6.0, priceCredits: 190 },
];

// ---- Strategy market (hub.dc.html:823-830) ----
const STRATEGY: HubStrategyItem[] = [
  { id: 'strat-0', title: 'Silverstone 50% — 2-Stop Aggressive', creator: 'nightPace', team: 'McLaren', cond: 'DRY', length: '50% · 26L', fmt: 'F1 25', verified: true, priceCredits: 260, paceMs: 89400, sample: 214, conf: '신뢰도 상', gain: 3, stints: [{ compound: 'S', laps: 8 }, { compound: 'M', laps: 10 }, { compound: 'S', laps: 8 }] },
  { id: 'strat-1', title: 'Silverstone 50% — 1-Stop Tyre Save', creator: 'APX_leon', team: 'RedBull', cond: 'DRY', length: '50% · 26L', fmt: 'F1 25', verified: true, priceCredits: 240, paceMs: 90100, sample: 188, conf: '신뢰도 상', gain: 1, stints: [{ compound: 'M', laps: 13 }, { compound: 'H', laps: 13 }] },
  { id: 'strat-2', title: 'Silverstone 100% — 2-Stop Optimal', creator: 'strat_lab', team: 'Mercedes', cond: 'DRY', length: '100% · 52L', fmt: 'F1 25', verified: true, priceCredits: 380, paceMs: 91200, sample: 96, conf: '신뢰도 중', gain: 4, stints: [{ compound: 'S', laps: 15 }, { compound: 'M', laps: 19 }, { compound: 'H', laps: 18 }] },
  { id: 'strat-3', title: 'Wet→Dry — Crossover Call', creator: 'rainmaster', team: 'McLaren', cond: 'WET→DRY', length: '50% · 26L', fmt: 'F1 25', verified: true, priceCredits: 300, paceMs: 98000, sample: 41, conf: '신뢰도 중', gain: 5, stints: [{ compound: 'W', laps: 9 }, { compound: 'I', laps: 6 }, { compound: 'M', laps: 11 }] },
  { id: 'strat-4', title: 'Silverstone 50% — Undercut Meta', creator: 'ghost_lap', team: 'Mercedes', cond: 'DRY', length: '50% · 26L', fmt: 'F1 25', verified: true, priceCredits: null, paceMs: 89200, sample: null, conf: '참고 전용', gain: 4, stints: [{ compound: 'S', laps: 7 }, { compound: 'S', laps: 9 }, { compound: 'M', laps: 10 }] },
  { id: 'strat-5', title: 'Silverstone 25% — Sprint 1-Stop', creator: 'boxbox_77', team: 'Williams', cond: 'DRY', length: '25% · 13L', fmt: 'F1 26', verified: false, priceCredits: 150, paceMs: 88900, sample: 33, conf: '표본 부족', gain: 1, stints: [{ compound: 'S', laps: 6 }, { compound: 'M', laps: 7 }] },
];

// ---- Similar strategies (hub.dc.html:846-850) ----
const SIMILAR_STRATEGIES = [
  { handle: 'ghost_lap', gain: 4, sample: null, priceCredits: null },
  { handle: 'nightPace', gain: 3, sample: 214, priceCredits: 260 },
  { handle: 'APX_leon', gain: 1, sample: 188, priceCredits: 240 },
];

const delay = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

export class MockHubDataSource implements HubDataSource {
  constructor(private readonly delayMs = 0) {}

  // Own-data overview has no demo: an unconfigured/standalone build shows the
  // honest empty state, not fabricated sessions.
  async getOverview(): Promise<HubOverview> {
    await delay(this.delayMs);
    return EMPTY_OVERVIEW;
  }

  async getSetupMarket(): Promise<HubSetupMarket> {
    await delay(this.delayMs);
    return { setups: MARKET.map(toMarketItem), similar: SIMILAR_SETUPS };
  }

  async getStrategyMarket(): Promise<HubStrategyMarket> {
    await delay(this.delayMs);
    return { strategies: STRATEGY, similar: SIMILAR_STRATEGIES };
  }
}
