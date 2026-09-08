import { describe, expect, it } from 'vitest';
import { currentLeaderboardResult, leaderboardContextKey, leaderboardPosition, topTenDescription } from './leaderboardState';
import type { LeaderboardPage } from './types';

const page: LeaderboardPage = { board: 'pb', rows: [], total: 300, leaderMs: 80000, viewer: null, viewerGapToTop10Ms: null, nextCursor: null, previousCursor: null, anchorFound: false, asOf: '2026-09-08T00:00:00Z' };
describe('leaderboard query identity', () => {
  const base = leaderboardContextKey('pb', 7, 'F1 26', 'actor', 1);
  it('resets page selection across board, track, format, account and epoch changes', () => {
    const selection = { context: base, position: { cursor: 'page2' } };
    expect(leaderboardPosition(base, selection)).toEqual({ cursor: 'page2' });
    for (const key of [leaderboardContextKey('tt', 7, 'F1 26', 'actor', 1), leaderboardContextKey('pb', 8, 'F1 26', 'actor', 1), leaderboardContextKey('pb', 7, 'F1 25', 'actor', 1), leaderboardContextKey('pb', 7, 'F1 26', 'subject', 1), leaderboardContextKey('pb', 7, 'F1 26', 'actor', 2)]) {
      expect(leaderboardPosition(key, selection)).toEqual({});
      expect(currentLeaderboardResult(key, { key: base, value: { status: 'ready', data: page, error: null } }).status).toBe('loading');
    }
  });
  it('lets next/previous replace an around request completely', () => {
    const around = { context: base, position: { around: 'driver' } };
    expect(leaderboardPosition(base, around)).toEqual({ around: 'driver' });
    expect(leaderboardPosition(base, { ...around, position: { cursor: 'next' } })).toEqual({ cursor: 'next' });
  });
  it('preserves actual errors and does not turn them into empty records', () => {
    expect(currentLeaderboardResult(base, { key: base, value: { status: 'error', data: null, error: 'offline' } })).toEqual({ status: 'error', data: null, error: 'offline' });
  });
});

describe('top 10 membership', () => {
  it('uses rank, not zero gap, to determine membership', () => {
    expect(topTenDescription(11, 0)).toBe('10위 기록과 0.000s 차이 · 동률, 순위는 P11');
    expect(topTenDescription(10, 0)).toBe('톱10 진입');
    expect(topTenDescription(5, null)).toBe('톱10 진입');
    expect(topTenDescription(11, null)).toBe('10위 비교 기록 없음');
  });
});
