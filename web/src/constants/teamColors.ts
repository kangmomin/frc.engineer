/**
 * F1 2025 Team Colors
 * Team ID to color mapping based on official team colors
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
};

/**
 * Get team color by team ID
 * Returns default gray if team ID is not found
 */
export function getTeamColor(teamId: number): string {
  return TEAM_COLORS[teamId] ?? '#6f7070';
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
};

export function getTeamName(teamId: number): string {
  return TEAM_NAMES[teamId] ?? 'Unknown';
}
