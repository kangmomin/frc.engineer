// FRC Engineer Hub — data contract.
// These are RAW domain types (Fable B1): no preformatted strings, no colors,
// no handlers. Formatting lives in format.ts, colors in theme.ts, handlers in
// the components. HubDataSource carries only the viewer's OWN telemetry summary
// (leaderboards and market are served directly by the platform client).
export type SessionState = 'valid' | 'escrow';
export type LedgerState = 'settled' | 'escrow';

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

/**
 * The own-data contract. Rankings come from the platform leaderboard endpoints
 * and the marketplace from the platform market client (see platform.ts), so
 * neither is part of this source — it carries only the viewer's own telemetry
 * summary, served by the local desktop server (/api/hub/overview).
 */
export interface HubDataSource {
  getOverview(): Promise<HubOverview>;
}
