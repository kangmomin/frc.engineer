// FRC Engineer Hub — HTTP-backed own-data source.
// Sources the user's OWN data (recent sessions, season best, session counts)
// from the backend's /api/hub/overview. When the backend is unreachable, the
// own data is empty, or a session list is missing, it returns the honest empty
// overview (EMPTY_OVERVIEW) — never demo data.
import type { HubDataSource, HubOverview } from './types';
import { EMPTY_OVERVIEW } from './types';

// The hub runs this in two contexts: the Vite dev server (which proxies /api →
// backend) and the embedded Go server (same origin). A relative path is correct
// for both and, unlike a hardcoded base, survives the embedded server
// auto-incrementing its port on conflict. (Matches replayArchive.ts.)
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

export class OwnHubDataSource implements HubDataSource {
  async getOverview(): Promise<HubOverview> {
    try {
      const res = await fetch(OVERVIEW_URL);
      if (!res.ok) {
        console.warn('hub overview: unavailable, showing empty', res.status);
        return EMPTY_OVERVIEW;
      }
      const own = (await res.json()) as OwnOverview;
      if (!own.recentSessions?.length) return EMPTY_OVERVIEW; // fresh/empty local

      return {
        verifiedSessions: own.sessionCount,
        verifiedSessionsDelta: own.sessionsThisWeek,
        seasonBestMs: own.seasonBestMs,
        seasonBestTrack: own.seasonBestTrack,
        recentSessions: own.recentSessions.map((s) => ({
          ...s,
          state: 'valid' as const,
          crDelta: 0,
        })),
      };
    } catch (e) {
      console.warn('hub overview: unavailable, showing empty', e);
      return EMPTY_OVERVIEW;
    }
  }
}
