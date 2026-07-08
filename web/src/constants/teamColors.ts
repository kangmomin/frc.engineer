/**
 * F1 Team Colors
 * Team ID to color mapping based on official team colors.
 * 0-10: F1 25 (2025 season) / 476-486: 2026 Season Pack ('26 teams)
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#27f4d2',   // Mercedes
  1: '#e8002d',   // Ferrari
  2: '#3671c6',   // Red Bull Racing
  3: '#64c4ff',   // Williams
  4: '#229971',   // Aston Martin
  5: '#ff87bc',   // Alpine
  6: '#6692ff',   // RB
  7: '#b6babd',   // Haas
  8: '#ff8000',   // McLaren
  9: '#52e252',   // Kick Sauber
  10: '#f50537',  // Audi
  255: '#6f7070', // Unknown/Safety Car
  // 2026 Season Pack team IDs
  476: '#27f4d2', // Mercedes '26
  477: '#e8002d', // Ferrari '26
  478: '#3671c6', // Red Bull Racing '26
  479: '#64c4ff', // Williams '26
  480: '#229971', // Aston Martin '26
  481: '#ff87bc', // Alpine '26
  482: '#6692ff', // RB '26
  483: '#b6babd', // Haas '26
  484: '#ff8000', // McLaren '26
  485: '#f50537', // Audi '26
  486: '#c8a25f', // Cadillac '26 (gold)
};

/**
 * Get team color by team ID
 * Returns default gray if team ID is not found
 */
export function getTeamColor(teamId: number): string {
  return TEAM_COLORS[teamId] ?? '#6f7070';
}

/**
 * Short team badges for the leaderboard driver cell. Same ID set as TEAM_NAMES
 * (0-10 / 255 / 476-486). Unknown falls back to an em dash.
 */
export const TEAM_SHORT: Record<number, string> = {
  0: 'MER',
  1: 'FER',
  2: 'RBR',
  3: 'WIL',
  4: 'AST',
  5: 'ALP',
  6: 'RB',
  7: 'HAA',
  8: 'MCL',
  9: 'SAU',
  10: 'AUD',
  255: '—',
  // 2026 Season Pack team IDs
  476: 'MER',
  477: 'FER',
  478: 'RBR',
  479: 'WIL',
  480: 'AST',
  481: 'ALP',
  482: 'RB',
  483: 'HAA',
  484: 'MCL',
  485: 'AUD',
  486: 'CAD',
};

/** Get short team badge by team ID; em dash for unknown IDs. */
export function getTeamShort(teamId: number): string {
  return TEAM_SHORT[teamId] ?? '—';
}

/**
 * Team names for display
 */
export const TEAM_NAMES: Record<number, string> = {
  0: 'Mercedes',
  1: 'Ferrari',
  2: 'Red Bull',
  3: 'Williams',
  4: 'Aston Martin',
  5: 'Alpine',
  6: 'RB',
  7: 'Haas',
  8: 'McLaren',
  9: 'Kick Sauber',
  10: 'Audi',
  255: 'Unknown',
  // 2026 Season Pack team IDs
  476: 'Mercedes',
  477: 'Ferrari',
  478: 'Red Bull',
  479: 'Williams',
  480: 'Aston Martin',
  481: 'Alpine',
  482: 'RB',
  483: 'Haas',
  484: 'McLaren',
  485: 'Audi',
  486: 'Cadillac',
};

export function getTeamName(teamId: number): string {
  return TEAM_NAMES[teamId] ?? 'Unknown';
}
