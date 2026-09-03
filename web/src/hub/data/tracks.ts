// Track registry for the leaderboard / market track+format selector.
//
// This is a hand-maintained port of the id→displayName map in
// internal/tracks/names.go (the backend source of truth). The platform
// leaderboard/market endpoints key on the integer track_id, so the Hub needs a
// local id→name map to render a selector without a dedicated /tracks endpoint.
// Keep in sync with names.go when tracks are added.
export interface HubTrack {
  id: number;
  name: string;
}

export const HUB_TRACKS: HubTrack[] = [
  { id: 0, name: 'Australia' },
  { id: 2, name: 'China' },
  { id: 3, name: 'Bahrain' },
  { id: 4, name: 'Spain' },
  { id: 5, name: 'Monaco' },
  { id: 6, name: 'Canada' },
  { id: 7, name: 'Great Britain' },
  { id: 8, name: 'Hungary' },
  { id: 9, name: 'Belgium' },
  { id: 10, name: 'Italy (Monza)' },
  { id: 11, name: 'Singapore' },
  { id: 12, name: 'Japan' },
  { id: 13, name: 'Abu Dhabi' },
  { id: 14, name: 'United States (Austin)' },
  { id: 16, name: 'Brazil' },
  { id: 17, name: 'Austria' },
  { id: 19, name: 'Mexico' },
  { id: 20, name: 'Azerbaijan' },
  { id: 23, name: 'Netherlands' },
  { id: 24, name: 'Italy (Imola)' },
  { id: 25, name: 'Saudi Arabia' },
  { id: 26, name: 'United States (Miami)' },
  { id: 27, name: 'Qatar' },
  { id: 28, name: 'United States (Las Vegas)' },
  // 2026 Season Pack tracks (canonical ids, distinct from the F1 25 space).
  { id: 39, name: 'Great Britain (Reverse)' },
  { id: 40, name: 'Austria (Reverse)' },
  { id: 41, name: 'Netherlands (Reverse)' },
  { id: 42, name: 'Spain (Madrid)' },
];

// Game formats the platform partitions leaderboards/market by. These are the
// telemetry-reported format strings (see CLAUDE.md: F1 26 = 2026 Season Pack).
export const HUB_FORMATS = ['F1 25', 'F1 26'] as const;

export interface TrackContext {
  trackId: number;
  format: string;
}

// Fallback context when no viewer race is available (logged out / no uploads):
// Great Britain (Silverstone), current-season format.
export const DEFAULT_TRACK_CONTEXT: TrackContext = { trackId: 7, format: 'F1 25' };

export function isF126OnlyTrack(trackId: number): boolean {
  return trackId >= 39 && trackId <= 42;
}

// The Season Pack tracks do not exist in F1 25. Keep this normalization at
// every context handoff rather than allowing an invalid selector combination.
export function trackContextFor(trackId: number, format: string): TrackContext {
  return { trackId, format: isF126OnlyTrack(trackId) ? 'F1 26' : format };
}

export function trackName(id: number): string {
  return HUB_TRACKS.find((t) => t.id === id)?.name ?? `TRK ${id}`;
}
