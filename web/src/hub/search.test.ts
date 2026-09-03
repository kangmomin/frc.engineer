import { describe, expect, it } from 'vitest';
import {
  flattenSearchResults, isCurrentSearch, isSearchQueryReady, nextSearchIndex, searchTracks, selectedTrackContext,
  type SearchResponse,
} from './search';

const response: SearchResponse = {
  setups: [{
    id: 'listing-1', kind: 'setup', title: 'Silverstone dry', sellerPersona: 'Apex',
    trackId: 7, gameFormat: 'F1 25', priceCredits: 100, status: 'active',
    createdAt: '2026-09-01T00:00:00Z', rating: 0, reviewCount: 0,
  }],
  drivers: [{ accountId: 'account-1', persona: 'Apex', trackId: 42, gameFormat: 'F1 26' }],
};

describe('search tracks', () => {
  it('waits for two Unicode characters before searching', () => {
    expect(isSearchQueryReady('가')).toBe(false);
    expect(isSearchQueryReady('가나')).toBe(true);
    expect(isSearchQueryReady('😀')).toBe(false);
  });

  it('matches canonical track names literally and case-insensitively, capped at five', () => {
    expect(searchTracks('united').map((track) => track.id)).toEqual([14, 26, 28]);
    expect(searchTracks('ITALY').map((track) => track.id)).toEqual([10, 24]);
    expect(searchTracks('a').length).toBe(5);
  });

  it('selecting a 2026-only track always selects F1 26', () => {
    expect(selectedTrackContext({ id: 42, name: 'Spain (Madrid)' }, 'F1 25')).toEqual({ trackId: 42, format: 'F1 26' });
  });
});

describe('search result behavior', () => {
  it('flattens remote results before local tracks in their stable groups', () => {
    expect(flattenSearchResults('bahr', response).map((result) => result.type)).toEqual(['setup', 'driver', 'track']);
  });

  it('wraps arrow navigation and exposes no active option for an empty result set', () => {
    expect(nextSearchIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextSearchIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextSearchIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextSearchIndex(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('accepts only the most recent async search sequence', () => {
    expect(isCurrentSearch(2, 2)).toBe(true);
    expect(isCurrentSearch(1, 2)).toBe(false);
  });
});
