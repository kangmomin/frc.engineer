// FRC Engineer Hub — HTTP-backed composite data source (Phase 2).
// Sources the user's OWN data (recent sessions, season best, session counts)
// from the backend's /api/hub/overview and merges it over the mock overview,
// keeping every platform field (credits, ledger, ranks, market) on mock until
// the platform domain exists (Phase 3). Everything degrades to mock when the
// backend is unreachable — e.g. the Vercel standalone build has no Go server.
import type {
  HubDataSource, HubOverview, HubRankings, HubSetupMarket, HubStrategyMarket,
} from './types';

// The hub only runs the composite in two contexts: the Vite dev server (which
// proxies /api → backend) and the embedded Go server (same origin). A relative
// path is correct for both and, unlike a hardcoded base, survives the embedded
// server auto-incrementing its port on conflict. (Matches replayArchive.ts.)
const OVERVIEW_URL = '/api/hub/overview';

interface OwnSession {
  track: string;
  type: string;
  pos: number;
  lapMs: number;
  atMs: number;
}

/** The own-data slice returned by GET /api/hub/overview (internal to this file). */
interface OwnOverview {
  recentSessions: OwnSession[];
  seasonBestMs: number;
  seasonBestTrack: string;
  sessionCount: number;
  sessionsThisWeek: number;
}

export class CompositeHubDataSource implements HubDataSource {
  constructor(private readonly mock: HubDataSource) {}

  async getOverview(): Promise<HubOverview> {
    const base = await this.mock.getOverview();
    try {
      const res = await fetch(OVERVIEW_URL);
      if (!res.ok) {
        console.warn('hub overview: falling back to mock', res.status);
        return base;
      }
      const own = (await res.json()) as OwnOverview;
      if (!own.recentSessions?.length) return base; // fresh/empty local → keep demo

      // All-or-nothing merge: when own data exists, the whole own-data field
      // group comes from it — no per-field `||` fallback. A real 0 (e.g. no
      // valid lap → seasonBestMs 0) must NOT be masked by a mock value sitting
      // next to the user's real sessions.
      return {
        ...base,
        recentSessions: own.recentSessions.map((s) => ({
          ...s,
          state: 'valid' as const,
          crDelta: 0,
        })),
        seasonBestMs: own.seasonBestMs,
        seasonBestTrack: own.seasonBestTrack,
        verifiedSessions: own.sessionCount,
        verifiedSessionsDelta: own.sessionsThisWeek,
      };
    } catch (e) {
      console.warn('hub overview: falling back to mock', e);
      return base;
    }
  }

  getRankings(): Promise<HubRankings> {
    return this.mock.getRankings();
  }

  getSetupMarket(): Promise<HubSetupMarket> {
    return this.mock.getSetupMarket();
  }

  getStrategyMarket(): Promise<HubStrategyMarket> {
    return this.mock.getStrategyMarket();
  }
}
