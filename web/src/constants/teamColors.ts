/**
 * F1 2025 Team Colors
 * Team ID to color mapping based on official team colors
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#00a19b',   // Mercedes - Petronas Green
  1: '#ef1b23',   // Ferrari - Rosso Corsa
  2: '#001a2d',   // Red Bull Racing - Navy Blue
  3: '#0052d4',   // Williams - Dark Blue
  4: '#006747',   // Aston Martin - British Racing Green
  5: '#0078bf',   // Alpine - Alpine Blue
  6: '#0a34ed',   // RB (VCARB) - Racing Blue
  7: '#b6babd',   // Haas - Silver/Gray
  8: '#ff8000',   // McLaren - Papaya Orange
  9: '#52ff00',   // Sauber - Neon Green
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
