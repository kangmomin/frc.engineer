import { HUB_TRACKS, trackContextFor, type HubTrack, type TrackContext } from './data/tracks';
import type { PlatformDriverSearchHit, PlatformListingCard, PlatformSearchResponse } from './data/platform';

export type DriverSearchHit = PlatformDriverSearchHit;
export type SearchResponse = PlatformSearchResponse;

export type SearchResult =
  | { type: 'setup'; card: PlatformListingCard }
  | { type: 'driver'; driver: DriverSearchHit }
  | { type: 'track'; track: HubTrack };

export function isSearchQueryReady(query: string): boolean {
  return Array.from(query.trim()).length >= 2;
}

// Track search stays local so the canonical catalog remains useful when the
// public service is temporarily unavailable. It deliberately uses literal
// substring matching, matching the server-side search contract.
export function searchTracks(query: string, tracks = HUB_TRACKS): HubTrack[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return tracks.filter((track) => track.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}

export function flattenSearchResults(query: string, response: SearchResponse): SearchResult[] {
  return [
    ...response.setups.slice(0, 5).map((card): SearchResult => ({ type: 'setup', card })),
    ...response.drivers.slice(0, 5).map((driver): SearchResult => ({ type: 'driver', driver })),
    ...searchTracks(query).map((track): SearchResult => ({ type: 'track', track })),
  ];
}

export function selectedTrackContext(track: HubTrack, format: string): TrackContext {
  return trackContextFor(track.id, format);
}

export function nextSearchIndex(index: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count === 0) return -1;
  if (key === 'ArrowDown') return index < 0 || index === count - 1 ? 0 : index + 1;
  return index <= 0 ? count - 1 : index - 1;
}

// Request sequence numbers let a later query win even if an aborted/slow
// earlier request resolves after it.
export function isCurrentSearch(sequence: number, currentSequence: number): boolean {
  return sequence === currentSequence;
}
