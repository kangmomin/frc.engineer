import type { DataStorageMode } from '../types/telemetry';

/**
 * Format milliseconds to lap time string (M:SS.mmm)
 */
export function formatLapTime(ms: number): string {
  if (ms === 0) return '--:--.---';

  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Format delta time in milliseconds to seconds with sign
 */
export function formatDelta(ms: number): string {
  if (ms === 0) return '+0.000';

  const sign = ms >= 0 ? '+' : '';
  const seconds = ms / 1000;

  return `${sign}${seconds.toFixed(3)}`;
}

/**
 * Get gear display text
 */
export function formatGear(gear: number): string {
  if (gear === -1) return 'R';
  if (gear === 0) return 'N';
  return gear.toString();
}

/**
 * Format position (e.g., P1, P2)
 */
export function formatPosition(position: number): string {
  if (position === 0) return '--';
  return `P${position}`;
}

/**
 * Convert 0-1 value to percentage
 */
export function toPercentage(value: number): number {
  return Math.round(value * 100);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatRaceStorageModeBadge(mode: DataStorageMode | 'off' | undefined): string {
  switch (mode) {
    case 'advanced':
      return 'Race Adv';
    case 'summary':
      return 'Race Sum';
    case 'resultOnly':
      return 'Race Result';
    default:
      return 'Race Off';
  }
}
