/**
 * F1 Tyre Compound Colors and Information
 */

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet' | 'unknown';

export const TYRE_COLORS: Record<string, string> = {
  soft: '#ff3333',      // Red
  medium: '#ffcc00',    // Yellow
  hard: '#ffffff',      // White
  inter: '#33cc33',     // Green
  wet: '#3399ff',       // Blue
  unknown: '#888888',   // Gray
  // Alternative casing from backend
  Soft: '#ff3333',
  Medium: '#ffcc00',
  Hard: '#ffffff',
  Inter: '#33cc33',
  Wet: '#3399ff',
  Unknown: '#888888',
};

/**
 * Get tyre color by compound name
 */
export function getTyreColor(compound: string): string {
  return TYRE_COLORS[compound] ?? TYRE_COLORS['unknown'];
}

/**
 * Short labels for tyre compounds
 */
export const TYRE_SHORT_LABELS: Record<string, string> = {
  soft: 'S',
  medium: 'M',
  hard: 'H',
  inter: 'I',
  wet: 'W',
  unknown: '?',
  Soft: 'S',
  Medium: 'M',
  Hard: 'H',
  Inter: 'I',
  Wet: 'W',
  Unknown: '?',
};

export function getTyreShortLabel(compound: string): string {
  return TYRE_SHORT_LABELS[compound] ?? '?';
}

/**
 * Tyre wear thresholds for visual indicators
 */
export const TYRE_WEAR_THRESHOLDS = {
  good: 30,       // 0-30%: Good condition (green)
  warning: 60,    // 30-60%: Warning (yellow)
  critical: 80,   // 60-80%: Critical (orange)
  // 80%+: Danger (red)
};

/**
 * Get wear status color based on wear percentage
 */
export function getWearStatusColor(wearPercent: number): string {
  if (wearPercent < TYRE_WEAR_THRESHOLDS.good) return '#00ff00';
  if (wearPercent < TYRE_WEAR_THRESHOLDS.warning) return '#ffcc00';
  if (wearPercent < TYRE_WEAR_THRESHOLDS.critical) return '#ff8700';
  return '#ff0000';
}

/**
 * Tyre temperature optimal ranges (Celsius)
 */
export const TYRE_TEMP_RANGES = {
  cold: 80,       // Below 80°C: Too cold (blue)
  optimal: 100,   // 80-100°C: Optimal (green)
  hot: 110,       // 100-110°C: Hot (yellow)
  // 110°C+: Overheating (red)
};

/**
 * Get temperature status color
 */
export function getTempStatusColor(tempCelsius: number): string {
  if (tempCelsius < TYRE_TEMP_RANGES.cold) return '#3399ff';
  if (tempCelsius < TYRE_TEMP_RANGES.optimal) return '#00ff00';
  if (tempCelsius < TYRE_TEMP_RANGES.hot) return '#ffcc00';
  return '#ff0000';
}
