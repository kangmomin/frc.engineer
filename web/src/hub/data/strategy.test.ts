import { afterEach, describe, expect, it, vi } from 'vitest';
import { strategyClient } from './strategy';

const auth = vi.hoisted(() => ({ token: 'owner-token', viewAs: false, unauthorized: vi.fn() }));
vi.mock('./session', () => ({ getActiveSessionToken: () => auth.token, getViewAsToken: () => auth.viewAs ? 'child' : null, notifySessionUnauthorized: auth.unauthorized }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); auth.viewAs = false; auth.unauthorized.mockClear(); });

describe('strategy HTTP boundary', () => {
  it('sends authenticated, abortable contexts and explicit simulation constraints', async () => {
    vi.stubEnv('VITE_PLATFORM_URL', 'https://platform.test');
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await strategyClient.contexts({ trackId: 42, format: 'F1 26' }, controller.signal);
    expect(fetch).toHaveBeenCalledWith('https://platform.test/strategies/contexts?trackId=42&gameFormat=F1+26', expect.objectContaining({ method: 'GET', cache: 'no-store', signal: controller.signal, headers: { Authorization: 'Bearer owner-token' } }));
    fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const body = { contextId: 'a'.repeat(32), maxStops: 1, availableSets: { Soft: 1, Hard: 1 }, requireTwoCompounds: true };
    await strategyClient.simulate({ trackId: 42, format: 'F1 26' }, body, controller.signal);
    expect(fetch.mock.calls[1][0]).toBe('https://platform.test/strategies/simulate?trackId=42&gameFormat=F1+26');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body);
  });

  it('blocks View As locally and keeps forbidden/unauthorized responses explicit', async () => {
    vi.stubEnv('VITE_PLATFORM_URL', 'https://platform.test');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); auth.viewAs = true;
    await expect(strategyClient.contexts({ trackId: 7, format: 'F1 25' })).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled(); auth.viewAs = false;
    fetch.mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(strategyClient.contexts({ trackId: 7, format: 'F1 25' })).rejects.toMatchObject({ status: 403 });
    fetch.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(strategyClient.contexts({ trackId: 7, format: 'F1 25' })).rejects.toMatchObject({ status: 401 });
    expect(auth.unauthorized).toHaveBeenCalledWith('owner-token');
  });
});
