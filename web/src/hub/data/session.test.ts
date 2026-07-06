import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureTokenFromFragment, getSessionToken, clearSessionToken, fetchMe,
} from './session';

// jsdom is not configured, so stand up a minimal window (local/session storage +
// location + history) for these DOM-touching helpers. `intent` seeds the
// login-intent flag as if beginSteamLogin ran in this tab.
function fakeWindow(hash = '', intent = false) {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  if (intent) session.set('pitwall.loginIntent', '1');
  const store = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return {
    localStorage: store(local),
    sessionStorage: store(session),
    location: { hash, pathname: '/hub', search: '' },
    history: { replaceState: vi.fn() },
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_PLATFORM_URL', 'https://platform.test');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('captureTokenFromFragment', () => {
  it('extracts, stores, and strips the token fragment when login intent is set', () => {
    const win = fakeWindow('#token=tok_abc', true);
    vi.stubGlobal('window', win);
    expect(captureTokenFromFragment()).toBe(true);
    expect(getSessionToken()).toBe('tok_abc');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/hub');
    // intent flag is one-shot: a second call (no fresh login) is rejected.
    expect(win.sessionStorage.getItem('pitwall.loginIntent')).toBeNull();
  });

  it('rejects a planted token with no login intent but still strips the fragment', () => {
    const win = fakeWindow('#token=attacker'); // no intent → crafted-link attack
    vi.stubGlobal('window', win);
    expect(captureTokenFromFragment()).toBe(false);
    expect(getSessionToken()).toBeNull();
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/hub');
  });

  it('returns false when no token fragment is present', () => {
    vi.stubGlobal('window', fakeWindow('#other=1', true));
    expect(captureTokenFromFragment()).toBe(false);
    expect(getSessionToken()).toBeNull();
  });
});

describe('fetchMe', () => {
  it('attaches the Bearer token and returns the account on 200', async () => {
    const win = fakeWindow();
    win.localStorage.setItem('pitwall.platformToken', 'tok_xyz');
    vi.stubGlobal('window', win);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: '1', persona: 'Ayrton', verified: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const acc = await fetchMe();
    expect(acc?.persona).toBe('Ayrton');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.test/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_xyz');
  });

  it('clears the token and returns null on 401', async () => {
    const win = fakeWindow();
    win.localStorage.setItem('pitwall.platformToken', 'stale');
    vi.stubGlobal('window', win);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    expect(await fetchMe()).toBeNull();
    expect(getSessionToken()).toBeNull();
  });

  it('returns null without fetching when no token is stored', async () => {
    vi.stubGlobal('window', fakeWindow());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchMe()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null and keeps the token on a network error', async () => {
    const win = fakeWindow();
    win.localStorage.setItem('pitwall.platformToken', 'tok');
    vi.stubGlobal('window', win);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchMe()).toBeNull();
    expect(getSessionToken()).toBe('tok');
    clearSessionToken();
  });
});
