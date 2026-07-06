import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformMarket, ListingError, isStintPayload } from './platform';

function fakeWindow(token?: string) {
  const store = new Map<string, string>();
  if (token) store.set('pitwall.platformToken', token);
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { hash: '', pathname: '/hub', search: '' },
    history: { replaceState: vi.fn() },
  };
}

function res(status: number, body?: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  vi.stubEnv('VITE_PLATFORM_URL', 'https://platform.test');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const mkt = new PlatformMarket();

describe('PlatformMarket auth', () => {
  it('does not fetch and throws unauthorized when no token is stored', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.listMyRaces()).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches the Bearer token', async () => {
    vi.stubGlobal('window', fakeWindow('tok_1'));
    const fetchMock = vi.fn().mockResolvedValue(res(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.listMyRaces();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/me/races');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_1');
  });
});

describe('createListing status mapping', () => {
  const cases: Array<[number, string]> = [
    [400, 'bad-input'],
    [404, 'not-found'],
    [409, 'conflict'],
    [422, 'not-sellable'],
    [429, 'rate-limited'],
  ];
  for (const [status, reason] of cases) {
    it(`maps ${status} → ${reason}`, async () => {
      vi.stubGlobal('window', fakeWindow('tok'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
      await expect(
        mkt.createListing({ kind: 'setup', sourceRaceId: 'r1', title: 'T', priceCredits: 100 }),
      ).rejects.toMatchObject({ reason });
    });
  }

  it('returns listingId on 201', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(201, { listingId: 'L-9' })));
    const id = await mkt.createListing({ kind: 'setup', sourceRaceId: 'r1', title: 'T', priceCredits: 100 });
    expect(id).toBe('L-9');
  });
});

describe('detail / similar / delist', () => {
  it('getListing 404 → not-found ListingError', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    await expect(mkt.getListing('L-x')).rejects.toBeInstanceOf(ListingError);
  });

  it('getSimilar 404 → empty array (no throw)', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    expect(await mkt.getSimilar('L-x')).toEqual([]);
  });

  it('delist 204 resolves, 404 throws not-found', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(204)));
    await expect(mkt.delist('L-1')).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    await expect(mkt.delist('L-1')).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('owner payload narrows: setup object vs stint array', async () => {
    expect(isStintPayload([{ compound: 'Soft', laps: 3 }])).toBe(true);
    expect(isStintPayload({ frontWing: 5 })).toBe(false);
  });
});

describe('economy (3D1)', () => {
  it('getWallet returns the balance', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { balance: 850 })));
    expect(await mkt.getWallet()).toBe(850);
  });

  it('browse 400 (missing track/format) → empty array', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400)));
    expect(await mkt.browse('setup', 99, 'F1 26')).toEqual([]);
  });

  it('browse attaches token when present but is public', async () => {
    vi.stubGlobal('window', fakeWindow()); // no token
    const fetchMock = vi.fn().mockResolvedValue(res(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.browse('strategy', 5, 'F1 26');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/market/strategies?track=5&format=F1%2026');
    expect(init.headers).toEqual({}); // no Authorization without a token
  });

  const purchaseCases: Array<[number, string]> = [
    [402, 'bad-input'],
    [404, 'not-found'],
    [409, 'conflict'],
    [422, 'not-sellable'],
  ];
  for (const [status, reason] of purchaseCases) {
    it(`purchase maps ${status} → ${reason}`, async () => {
      vi.stubGlobal('window', fakeWindow('tok'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
      await expect(mkt.purchase('L-1')).rejects.toMatchObject({ reason });
    });
  }

  it('purchase 200 returns the unlocked result', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { purchaseId: 'P-1', kind: 'setup', price: 150, fee: 22, payload: { frontWing: 5 }, alreadyOwned: false })));
    const r = await mkt.purchase('L-1');
    expect(r.fee).toBe(22);
    expect(isStintPayload(r.payload)).toBe(false);
  });

  it('listReviews 404 → empty; createReview maps 403/409', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    expect(await mkt.listReviews('L-1')).toEqual([]);

    const perf = { downforce: 80, topSpeed: 60, cornering: 90, tyre: 70, response: 65 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(403)));
    await expect(mkt.createReview('L-1', { stars: 5, perf, body: 'x' })).rejects.toMatchObject({ reason: 'not-sellable' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(409)));
    await expect(mkt.createReview('L-1', { stars: 5, perf, body: 'x' })).rejects.toMatchObject({ reason: 'conflict' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(201)));
    await expect(mkt.createReview('L-1', { stars: 5, perf, body: 'x' })).resolves.toBeUndefined();
  });
});
