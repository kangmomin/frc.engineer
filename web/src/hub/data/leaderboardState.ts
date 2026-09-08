import type { LeaderboardBoard, LeaderboardPage, LeaderboardPosition } from './types';

export function leaderboardContextKey(board: LeaderboardBoard, trackId: number, format: string, accountId: string | null, epoch: number): string {
  return JSON.stringify([board, trackId, format, accountId, epoch]);
}

export function leaderboardPosition(context: string, selection: { context: string; position: LeaderboardPosition } | null): LeaderboardPosition {
  return selection?.context === context ? selection.position : {};
}

export type LeaderboardLoad =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: LeaderboardPage; error: null }
  | { status: 'error'; data: null; error: string };

export function currentLeaderboardResult(key: string, result: { key: string; value: LeaderboardLoad } | null): LeaderboardLoad {
  return result?.key === key ? result.value : { status: 'loading', data: null, error: null };
}

export function topTenDescription(rank: number, gapMs: number | null): string {
  if (rank <= 10) return '톱10 진입';
  if (gapMs === null) return '10위 비교 기록 없음';
  return `10위 기록과 ${(gapMs / 1000).toFixed(3)}s 차이${gapMs === 0 ? ' · 동률, 순위는 P' + rank : ''}`;
}
