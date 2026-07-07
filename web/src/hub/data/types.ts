// FRC Engineer Hub — data contract.
// These are RAW domain types (Fable B1): no preformatted strings, no colors,
// no handlers. Formatting lives in format.ts, colors in theme.ts, handlers in
// the components. The HubDataSource interface is what a backend must satisfy;
// a MockHubDataSource (mock.ts) and a future HttpHubDataSource implement it.
export type SessionState = 'valid' | 'escrow';
export type LedgerState = 'settled' | 'escrow';
export type StintCompound = 'S' | 'M' | 'H' | 'I' | 'W';

export interface HubPerf {
  downforce: number; topSpeed: number; cornering: number; tyre: number; response: number;
}

export interface HubSession {
  track: string;
  type: string; // 'TIME TRIAL' | 'GRAND PRIX' | 'QUALIFYING' | ...
  pos: number;
  lapMs: number;
  state: SessionState;
  crDelta: number;
  atMs: number;
}

export interface HubLedgerEntry {
  label: string;
  sub: string;
  amount: number; // signed credits
  state: LedgerState;
}

// The viewer's OWN telemetry summary (from the local desktop server's
// /api/hub/overview). Platform-derived numbers — credits/ledger (wallet),
// leaderboard rank/gap — are NOT here: they come from the platform endpoints
// and are threaded into the Overview screen separately. Fields that had no
// backend source (season rank, credits earned, setups sold, pace trend) were
// removed rather than mocked.
export interface HubOverview {
  verifiedSessions: number;
  verifiedSessionsDelta: number; // this week
  seasonBestMs: number;
  seasonBestTrack: string;
  recentSessions: HubSession[];
}

// EMPTY_OVERVIEW is the honest zero-state: no local sessions yet, or no backend
// reachable (Vercel standalone). Screens render explicit empty states from it
// rather than falling back to demo data.
export const EMPTY_OVERVIEW: HubOverview = {
  verifiedSessions: 0,
  verifiedSessionsDelta: 0,
  seasonBestMs: 0,
  seasonBestTrack: '',
  recentSessions: [],
};

export interface HubTTRow {
  handle: string;
  lapMs: number;
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
  fmt: string;
  you: boolean;
}

export interface HubPaceRow {
  handle: string;
  avgMs: number;
  tyre: string; // display label ('SOFT'|'MED'|'HARD'|'INT'|'WET'|'—')
  laps: number;
  consistency: number; // 0..1
  you: boolean;
}

export interface HubRankings {
  tt: HubTTRow[];
  pace: HubPaceRow[];
}

export interface HubSetupParam {
  k: string;
  v: string; // raw setup value incl. units, e.g. "68%", "-2.9°", "23.5"
}

export interface HubReview {
  reviewer: string;
  stars: number;
  verifiedBuyer: boolean;
  text: string;
  atMs: number;
  perf?: HubPerf;
}

export interface HubRaceRow {
  track: string;
  pos: number;
  lapMs: number;
}

export interface HubRaceSummary {
  n: number;
  avgFinish: number;
  wins: number;
  bestMs: number;
  races: HubRaceRow[];
}

export interface HubMarketItem {
  id: string;
  title: string;
  creator: string;
  team: string;
  track: string;
  cond: string; // 'DRY' | 'WET'
  fmt: string;
  verified: boolean;
  priceCredits: number | null; // null = not listed
  rating: number;
  reviewCount: number;
  showRaces: boolean;
  perf: HubPerf;
  params: HubSetupParam[];
  reviews: HubReview[];
  raceSummary: HubRaceSummary;
}

export interface HubSimilarSetup {
  handle: string;
  team: string;
  distPct: number;
  priceCredits: number | null;
}

export interface HubSetupMarket {
  setups: HubMarketItem[];
  similar: HubSimilarSetup[];
}

export interface HubStint {
  compound: StintCompound;
  laps: number;
}

export interface HubStrategyItem {
  id: string;
  title: string;
  creator: string;
  team: string;
  cond: string;
  length: string; // '50% · 26L'
  fmt: string;
  verified: boolean;
  priceCredits: number | null;
  paceMs: number;
  sample: number | null;
  conf: string;
  gain: number;
  stints: HubStint[];
}

export interface HubSimilarStrategy {
  handle: string;
  gain: number;
  sample: number | null;
  priceCredits: number | null;
}

export interface HubStrategyMarket {
  strategies: HubStrategyItem[];
  similar: HubSimilarStrategy[];
}

/**
 * The own-data + demo contract. Rankings now come straight from the platform
 * leaderboard endpoints (see PlatformMarket.leaderboardTT/Pace), so they are no
 * longer part of this source. Promise-based and domain-grouped so a composite
 * provider can swap one domain to HTTP while others stay mock (Fable B2/B5).
 */
export interface HubDataSource {
  getOverview(): Promise<HubOverview>;
  getSetupMarket(): Promise<HubSetupMarket>;
  getStrategyMarket(): Promise<HubStrategyMarket>;
}
