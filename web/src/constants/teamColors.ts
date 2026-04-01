/**
 * F1 2025 Team Colors
 * Team ID to color mapping based on official team colors
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#27f4d2',   // Mercedes - Tiffany/Mint
  1: '#e8002d',   // Ferrari - Rosso Corsa
  2: '#3671c6',   // Red Bull Racing - Blue
  3: '#64c4ff',   // Williams - Light Blue
  4: '#229971',   // Aston Martin - British Racing Green
  5: '#ff87bc',   // Alpine - Pink
  6: '#6692ff',   // RB (VCARB) - Blue
  7: '#b6babd',   // Haas - Silver/Gray
  8: '#ff8000',   // McLaren - Papaya Orange
  9: '#52e252',   // Sauber (Stake F1) - Green
  11: '#ffffff',  // [Reserved]
  255: '#888888', // Unknown/Safety Car
};

/**
 * Get team color by team ID
 * Returns default gray if team ID is not found
 */
export function getTeamColor(teamId: number): string {
  return TEAM_COLORS[teamId] ?? '#888888';
}

/**
 * Team names for display
 */
export const TEAM_NAMES: Record<number, string> = {
  0: 'Mercedes',
  1: 'Ferrari',
  2: 'Red Bull Racing',
  3: 'Williams',
  4: 'Aston Martin',
  5: 'Alpine',
  6: 'RB',
  7: 'Haas',
  8: 'McLaren',
  9: 'Sauber',
  255: 'Unknown',
};

export function getTeamName(teamId: number): string {
  return TEAM_NAMES[teamId] ?? 'Unknown';
}
