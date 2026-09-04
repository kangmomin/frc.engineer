import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformMarket, PlatformSearch, ListingError, isStintPayload } from './platform';
import { subscribeSessionUnauthorized } from './session';

function fakeWindow(token?: string, child?: string) {
  const store = new Map<string, string>();
  const session = new Map<string, string>();
  if (token) store.set('pitwall.platformToken', token);
  if (child) session.set('pitwall.viewAsToken', child);
  const storage = (values: Map<string, string>) => ({
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  });
  return {
    localStorage: storage(store),
    sessionStorage: storage(session),
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
const search = new PlatformSearch();

describe('PlatformSearch', () => {
  it('uses the public endpoint, forwards AbortSignal, and does not require a token', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn().mockResolvedValue(res(200, { setups: [], drivers: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(search.search('  apex  ', controller.signal)).resolves.toEqual({ setups: [], drivers: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/search?q=apex');
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toEqual({});
  });

  it('keeps public search anonymous even when a token exists', async () => {
    vi.stubGlobal('window', fakeWindow('tok_1'));
    const fetchMock = vi.fn().mockResolvedValue(res(200, { setups: [], drivers: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await search.search('apex');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it('keeps a server 400 as an error instead of treating it as empty', async () => {
    vi.stubGlobal('window', fakeWindow());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400)));
    await expect(search.search('a')).rejects.toMatchObject({ reason: 'bad-input' });
  });
});

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

  it('prefers the View As child for reads and rejects mutations before fetch', async () => {
    vi.stubGlobal('window', fakeWindow('parent', 'child'));
    const fetchMock = vi.fn().mockResolvedValue(res(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.listMyRaces();
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer child' });
    fetchMock.mockClear();
    await expect(mkt.createListing({ kind: 'setup', sourceRaceId: 'r', title: 'x', priceCredits: 1 }))
      .rejects.toMatchObject({ reason: 'view-as-read-only' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses strict-viewer auth for leaderboards while public browse stays anonymous', async () => {
    vi.stubGlobal('window', fakeWindow('parent', 'child'));
    const fetchMock = vi.fn().mockResolvedValue(res(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.leaderboardTT(1, 'F1 26');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer child' });
    await mkt.browse('setup', 1, 'F1 26');
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });
});

describe('My Setups owner API', () => {
  it('uses authenticated no-store list/detail endpoints', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const rows = [{ id: 's/1', name: '', rating: null, memo: '', params: {}, usageCount: 1, firstRecordedAt: null, lastRecordedAt: null, lastTrackId: 1, lastTrackName: 'Bahrain', lastGameFormat: 'F1 26' }];
    const fetchMock = vi.fn().mockResolvedValue(res(200, rows));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.listMySetups()).resolves.toEqual(rows);
    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.test/me/setups');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer tok' } });

    fetchMock.mockResolvedValueOnce(res(200, { ...rows[0], races: [] }));
    await mkt.getMySetup('s/1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://platform.test/me/setups/s%2F1');
  });

  it('sends the complete metadata replacement body on POST', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const fetchMock = vi.fn().mockResolvedValue(res(200, { name: 'Dry', rating: null, memo: 'note', updatedAt: '2026-09-04T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.updateMySetup('s1', { name: 'Dry', rating: null, memo: 'note' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/me/setups/s1');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' } });
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Dry', rating: null, memo: 'note' });
  });

  it.each([
    [400, 'bad-input'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [500, 'network'],
  ] as const)('maps My Setups status %i explicitly to %s', async (status, reason) => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
    await expect(mkt.getMySetup('s1')).rejects.toMatchObject({ reason });
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
  it('allows anonymous listing detail without an Authorization header', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn().mockResolvedValue(res(200, { id: 'L-x', owned: false, payload: null }));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.getListing('L-x');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it('sends the active viewer and emits its captured token on a strict-viewer 401', async () => {
    const target = new EventTarget();
    const win = {
      ...fakeWindow('parent', 'child'),
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
    class TestCustomEvent<T> extends Event {
      constructor(type: string, readonly detailInit: { detail: T }) { super(type); }
      get detail(): T { return this.detailInit.detail; }
    }
    vi.stubGlobal('window', win);
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    const listener = vi.fn();
    const unsubscribe = subscribeSessionUnauthorized(listener);
    const fetchMock = vi.fn().mockResolvedValue(res(401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.getListing('L-x')).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer child' });
    expect(listener).toHaveBeenCalledWith('child');
    unsubscribe();
  });

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
  it('getWallet returns balance and initialization state', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { balance: 850, initialized: true })));
    expect(await mkt.getWallet()).toEqual({ balance: 850, initialized: true });
  });

  it('browse 400 (missing track/format) → empty array', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400)));
    expect(await mkt.browse('setup', 99, 'F1 26')).toEqual([]);
  });

  it('browse is anonymous public transport', async () => {
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
    [429, 'rate-limited'],
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(429)));
    await expect(mkt.createReview('L-1', { stars: 5, perf, body: 'x' })).rejects.toMatchObject({ reason: 'rate-limited' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(201)));
    await expect(mkt.createReview('L-1', { stars: 5, perf, body: 'x' })).resolves.toBeUndefined();
  });
});

describe('feedback', () => {
  it('submitFeedback 201 returns feedbackId with the expected request shape', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const fetchMock = vi.fn().mockResolvedValue(res(201, { feedbackId: 'F-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await mkt.submitFeedback({ category: 'bug', body: '버그가 있어요' });
    expect(id).toBe('F-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/feedback');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ category: 'bug', body: '버그가 있어요' });
  });

  const submitCases: Array<[number, string]> = [
    [400, 'bad-input'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [500, 'network'],
  ];
  for (const [status, reason] of submitCases) {
    it(`submitFeedback maps ${status} → ${reason}`, async () => {
      vi.stubGlobal('window', fakeWindow('tok'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
      await expect(
        mkt.submitFeedback({ category: 'other', body: 'x' }),
      ).rejects.toMatchObject({ reason });
    });
  }

  it('submitFeedback does not fetch and throws unauthorized when no token is stored', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.submitFeedback({ category: 'bug', body: 'x' })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('listMyFeedback returns the array and hits /me/feedback', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const rows = [{ id: 'F-1', category: 'bug', body: 'x', status: 'open', createdAt: '2026-07-20T00:00:00Z' }];
    const fetchMock = vi.fn().mockResolvedValue(res(200, rows));
    vi.stubGlobal('fetch', fetchMock);
    const out = await mkt.listMyFeedback();
    expect(out).toEqual(rows);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/me/feedback');
  });

  it('listMyFeedback 401 → unauthorized', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)));
    await expect(mkt.listMyFeedback()).rejects.toMatchObject({ reason: 'unauthorized' });
  });

  it('listFeedbackInbox uses no-store and returns the identity-free response rows', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const rows = [{ id: 'F-1', category: 'suggestion', body: 'x', status: 'in_progress', createdAt: '2026-07-20T00:00:00Z' }];
    const fetchMock = vi.fn().mockResolvedValue(res(200, rows));
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.listFeedbackInbox()).resolves.toEqual(rows);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/feedback-inbox');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'network'],
  ] as const)('listFeedbackInbox maps %i explicitly to %s', async (status, reason) => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));
    await expect(mkt.listFeedbackInbox()).rejects.toMatchObject({ reason });
  });
});

describe('analysis reports', () => {
  it('listAnalyses hits /analysis and returns metadata rows', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const rows = [{ id: 'A-1', sessionUid: '9116587583701622513', trackName: 'Bahrain', title: '종합 분석', createdAt: '2026-08-06T00:00:00Z' }];
    const fetchMock = vi.fn().mockResolvedValue(res(200, rows));
    vi.stubGlobal('fetch', fetchMock);
    const out = await mkt.listAnalyses();
    expect(out).toEqual(rows);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/analysis');
  });

  it('listAnalyses 403 (non-admin) → unauthorized', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(403)));
    await expect(mkt.listAnalyses()).rejects.toMatchObject({ reason: 'unauthorized' });
  });

  it('getAnalysis returns the full doc and 404 → not-found', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const doc = { id: 'A-1', title: 'T', createdAt: '2026-08-06T00:00:00Z', html: '<html></html>' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, doc)));
    expect(await mkt.getAnalysis('A-1')).toEqual(doc);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    await expect(mkt.getAnalysis('A-x')).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('deleteAnalysis resolves on 204 and maps 404 → not-found', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const fetchMock = vi.fn().mockResolvedValue(res(204));
    vi.stubGlobal('fetch', fetchMock);
    await mkt.deleteAnalysis('A-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/analysis/A-1/delete');
    expect(init.method).toBe('POST');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)));
    await expect(mkt.deleteAnalysis('A-x')).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('deleteAnalysis does not fetch without a token', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(mkt.deleteAnalysis('A-1')).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('driver profile', () => {
  it('does not fetch without a session token', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(mkt.getDriverProfile('driver-1')).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the encoded authenticated no-store endpoint and forwards cancellation', async () => {
    vi.stubGlobal('window', fakeWindow('tok_1'));
    const body = { accountId: 'driver/1', persona: 'Driver', avatarUrl: '', verified: true, summary: { verifiedRaces: 0, validLaps: 0, trackFormats: 0 }, tracks: [] };
    const fetchMock = vi.fn().mockResolvedValue(res(200, body));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(mkt.getDriverProfile('driver/1', controller.signal)).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/profiles/driver%2F1');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok_1' });
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(controller.signal);
  });

  it('preserves AbortError from authenticated fetches', async () => {
    vi.stubGlobal('window', fakeWindow('tok'));
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    await expect(mkt.getDriverProfile('driver-1')).rejects.toBe(abort);
  });

  for (const [status, reason] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [500, 'network']] as const) {
    it(`maps ${status} to ${reason}`, async () => {
      vi.stubGlobal('window', fakeWindow('tok'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(status)));

      await expect(mkt.getDriverProfile('driver-1')).rejects.toMatchObject({ reason });
    });
  }
});
