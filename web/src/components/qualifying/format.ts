import type { SessionInfo } from '../../types/telemetry';

export type QualifyingFormat = Pick<SessionInfo, 'formula' | 'qualifyingGridSize'>;

/** FIA 2026 Sporting B2.4.2–3: 20/22/24 entries eliminate 5/6/7 per stage.
 * The backend publishes an observed full roster; missing or non-F1 metadata
 * cannot be reconstructed from a transient driver array or UDP capacity. */
export function q1AdvancingCount(format?: QualifyingFormat | null): number | null {
  if (format?.formula !== 0 && format?.formula !== 13) return null;
  const grid = format.qualifyingGridSize;
  return grid === 20 || grid === 22 || grid === 24 ? (grid + 10) / 2 : null;
}
