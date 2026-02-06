/**
 * F1 2025 Team Colors
 * Team ID to color mapping based on official team colors
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#00e701',   // Mercedes - Petronas Green
  1: '#dc0000',   // Ferrari - Rosso Corsa
  2: '#0600ef',   // Red Bull Racing - Dark Blue
  3: '#005aff',   // Williams - Blue
  4: '#ff8700',   // McLaren - Papaya Orange
  5: '#2b4562',   // Alpine - Blue/Pink
  6: '#006f62',   // Aston Martin - British Racing Green
  7: '#ffffff',   // Haas - White/Red
  8: '#ffffff',   // [Reserved]
  9: '#6692ff',   // Sauber (Stake F1) - Blue
  10: '#2b4562',  // RB (VCARB) - Blue
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
  4: 'McLaren',
  5: 'Alpine',
  6: 'Aston Martin',
  7: 'Haas',
  9: 'Sauber',
  10: 'RB',
  255: 'Unknown',
};

export function getTeamName(teamId: number): string {
  return TEAM_NAMES[teamId] ?? 'Unknown';
}
