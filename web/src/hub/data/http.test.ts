import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompositeHubDataSource } from './http';
import { MockHubDataSource } from './mock';
import type { HubDataSource } from './types';

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

describe('CompositeHubDataSource.getOverview', () => {
  it('merges own data over the mock overview on 200, keeping platform fields mock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(OWN)));
    const o = await new CompositeHubDataSource(new MockHubDataSource()).getOverview();

    expect(o.recentSessions).toHaveLength(2);
    expect(o.recentSessions[0].track).toBe('Silverstone');
    expect(o.recentSessions[0].state).toBe('valid'); // no escrow concept for own data
    expect(o.recentSessions[0].crDelta).toBe(0); // no credit ledger yet
    expect(o.seasonBestMs).toBe(80115);
    expect(o.seasonBestTrack).toBe('Monza');
    expect(o.verifiedSessions).toBe(12);
    expect(o.verifiedSessionsDelta).toBe(3); // sessionsThisWeek override

    // platform fields remain from the mock
    expect(o.ledger.length).toBeGreaterThan(0);
    expect(typeof o.spendableCredits).toBe('number');
  });

  it('does not mask a real seasonBestMs 0 with the mock value (all-or-nothing)', async () => {
    const mockBest = (await new MockHubDataSource().getOverview()).seasonBestMs;
    expect(mockBest).toBeGreaterThan(0); // sanity: the mock carries a real best

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ ...OWN, seasonBestMs: 0, seasonBestTrack: '' })));
    const o = await new CompositeHubDataSource(new MockHubDataSource()).getOverview();
    expect(o.seasonBestMs).toBe(0);
    expect(o.seasonBestTrack).toBe('');
  });

  it('keeps the full mock overview when own recentSessions is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ ...OWN, recentSessions: [] })));
    const mock = new MockHubDataSource();
    const expected = await mock.getOverview();
    const o = await new CompositeHubDataSource(mock).getOverview();
    expect(o.recentSessions).toEqual(expected.recentSessions);
    expect(o.verifiedSessions).toBe(expected.verifiedSessions);
  });

  it('falls back to mock and warns on a non-ok response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response));
    const mock = new MockHubDataSource();
    const expected = await mock.getOverview();
    const o = await new CompositeHubDataSource(mock).getOverview();
    expect(o.recentSessions).toEqual(expected.recentSessions);
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to mock and warns on a network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const mock = new MockHubDataSource();
    const expected = await mock.getOverview();
    const o = await new CompositeHubDataSource(mock).getOverview();
    expect(o.recentSessions).toEqual(expected.recentSessions);
    expect(warn).toHaveBeenCalled();
  });
});

describe('CompositeHubDataSource delegates other domains to mock', () => {
  it('setup / strategy come from the mock unchanged', async () => {
    const mock = new MockHubDataSource();
    // The type annotation is itself the compile-time HubDataSource conformance check.
    const ds: HubDataSource = new CompositeHubDataSource(mock);
    expect((await ds.getSetupMarket()).setups.length).toBe(6);
    expect((await ds.getStrategyMarket()).strategies.length).toBe(6);
  });
});
