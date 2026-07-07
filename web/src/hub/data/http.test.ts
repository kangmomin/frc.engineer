import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnHubDataSource } from './http';

const OWN = {
  recentSessions: [
    { track: 'Silverstone', type: 'TIME TRIAL', pos: 4, lapMs: 86377, atMs: 1_750_000_000_000 },
    { track: 'Monza', type: 'GRAND PRIX', pos: 2, lapMs: 80115, atMs: 1_749_000_000_000 },
  ],
  seasonBestMs: 80115,
  seasonBestTrack: 'Monza',
  sessionCount: 12,
  sessionsThisWeek: 3,
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OwnHubDataSource.getOverview', () => {
  it('returns own data on 200 (sessions valid, no credit ledger)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(OWN)));
    const o = await new OwnHubDataSource().getOverview();

    expect(o.recentSessions).toHaveLength(2);
    expect(o.recentSessions[0].track).toBe('Silverstone');
    expect(o.recentSessions[0].state).toBe('valid'); // no escrow concept for own data
    expect(o.recentSessions[0].crDelta).toBe(0); // no credit ledger yet
    expect(o.seasonBestMs).toBe(80115);
    expect(o.seasonBestTrack).toBe('Monza');
    expect(o.verifiedSessions).toBe(12);
    expect(o.verifiedSessionsDelta).toBe(3); // sessionsThisWeek
  });

  it('surfaces a real seasonBestMs 0 (no demo masking)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ ...OWN, seasonBestMs: 0, seasonBestTrack: '' })));
    const o = await new OwnHubDataSource().getOverview();
    expect(o.seasonBestMs).toBe(0);
    expect(o.seasonBestTrack).toBe('');
  });

  it('returns the empty overview when own recentSessions is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ ...OWN, recentSessions: [] })));
    const o = await new OwnHubDataSource().getOverview();
    expect(o.recentSessions).toEqual([]);
    expect(o.verifiedSessions).toBe(0);
  });

  it('returns the empty overview and warns on a non-ok response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    const o = await new OwnHubDataSource().getOverview();
    expect(o.recentSessions).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns the empty overview and warns on a network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const o = await new OwnHubDataSource().getOverview();
    expect(o.recentSessions).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
