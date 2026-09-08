import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PlatformMarket } from './platform';
import type { LeaderboardQuery } from './types';
import { currentLeaderboardResult } from './leaderboardState';
import type { LeaderboardLoad } from './leaderboardState';

// Every response belongs to a complete query and session identity. Render-time
// matching hides old viewer data before effect cleanup; the epoch ref also
// rejects responses during an identity transition before the next render.
export function useLeaderboard(client: Pick<PlatformMarket, 'leaderboardRecords'>, query: LeaderboardQuery, context: string, enabled: boolean, epochRef: RefObject<number>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: LeaderboardLoad } | null>(null);
  const { trackId, format, board, limit, cursor, around } = query;
  const key = JSON.stringify([context, cursor, around, limit, attempt, enabled]);
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setResult(null);
  }
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const epoch = epochRef.current;
    const controller = new AbortController();
    void client.leaderboardRecords({ trackId, format, board, limit, ...(cursor ? { cursor } : around ? { around } : {}) }, controller.signal).then((data) => {
      if (alive && epochRef.current === epoch) setResult({ key, value: { status: 'ready', data, error: null } });
    }).catch((error: unknown) => {
      if (!alive || epochRef.current !== epoch || (error instanceof Error && error.name === 'AbortError')) return;
      setResult({ key, value: { status: 'error', data: null, error: error instanceof Error ? error.message : '순위를 불러오지 못했습니다' } });
    });
    return () => { alive = false; controller.abort(); };
  }, [client, enabled, epochRef, key, trackId, format, board, limit, cursor, around]);
  return { ...currentLeaderboardResult(key, result), retry: () => setAttempt((value) => value + 1) };
}
