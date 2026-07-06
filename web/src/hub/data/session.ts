// Platform session: Steam login round-trip, Bearer token storage, and the
// authenticated /me, logout, and device-pairing calls.
//
// Auth transport is a Bearer token (no cookies → no CSRF surface). The token
// arrives once via the OpenID callback's URL fragment (#token=…), is stashed in
// localStorage, and is attached as `Authorization: Bearer …` to platform calls.
import { getPlatformBase, getPlatformUrl, isPlatformConfigured } from './platformBase';

const TOKEN_KEY = 'pitwall.platformToken';
// One-shot flag set in this tab's sessionStorage by beginSteamLogin, checked (and
// cleared) by captureTokenFromFragment. It proves the token fragment belongs to a
// login THIS browser initiated — a token planted in a crafted #token=… link has no
// flag and is rejected (defeats login-CSRF / session fixation). sessionStorage is
// tab+origin scoped, so an attacker cannot pre-seed it.
const LOGIN_INTENT_KEY = 'pitwall.loginIntent';

export interface PlatformAccount {
  id: string;
  steamId64: string;
  persona: string;
  avatarUrl: string;
  kind: string;
  verified: boolean;
  banned: boolean;
  createdAt: string;
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function setSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

// captureTokenFromFragment reads a token delivered in the URL fragment by the
// OpenID callback, persists it, and strips it from the address bar (so it does
// not linger in history or get shared). It only accepts a token for a login THIS
// browser started (the one-shot LOGIN_INTENT flag): a token planted in a crafted
// link has no flag and is rejected — but the fragment is stripped regardless.
// Returns true only when a token was actually captured.
export function captureTokenFromFragment(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  if (!hash || !hash.includes('token=')) return false;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  // Strip the fragment without reloading or adding a history entry, even when we
  // reject it, so a planted token never lingers in history or gets shared.
  const clean = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', clean);
  // Consume the one-shot login-intent flag; only proceed if this browser started
  // the login that produced this token.
  const intended = window.sessionStorage.getItem(LOGIN_INTENT_KEY) !== null;
  window.sessionStorage.removeItem(LOGIN_INTENT_KEY);
  if (!intended || !token) return false;
  setSessionToken(token);
  return true;
}

// beginSteamLogin navigates the browser to the platform's Steam login. Full-page
// redirect: the platform → Steam → platform callback → back here with a token
// fragment. It first marks login intent in this tab so captureTokenFromFragment
// accepts the returned token (and rejects any it did not ask for).
export function beginSteamLogin(): void {
  if (typeof window === 'undefined' || !isPlatformConfigured()) return;
  window.sessionStorage.setItem(LOGIN_INTENT_KEY, '1');
  window.location.href = getPlatformBase() + '/auth/steam/login';
}

async function authFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const token = getSessionToken();
  if (!token || !isPlatformConfigured()) return null;
  return fetch(getPlatformUrl(path), {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

// fetchMe returns the authenticated account, or null if unauthenticated /
// unconfigured. A 401/403 clears the stale token; transient network errors keep
// it (caller may retry later).
export async function fetchMe(): Promise<PlatformAccount | null> {
  try {
    const res = await authFetch('/me');
    if (!res) return null;
    if (res.status === 401 || res.status === 403) {
      clearSessionToken();
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as PlatformAccount;
  } catch {
    return null;
  }
}

// platformLogout revokes the token server-side (best-effort) and clears it
// locally regardless of the network result.
export async function platformLogout(): Promise<void> {
  try {
    await authFetch('/auth/logout', { method: 'POST' });
  } catch {
    // ignore — local clear below is what matters
  }
  clearSessionToken();
}

// createPairingCode mints a device pairing code for the local desktop server to
// exchange for an upload-scope token. Throws if the request fails.
export async function createPairingCode(): Promise<string> {
  const res = await authFetch('/device/pair', { method: 'POST' });
  if (!res || !res.ok) {
    throw new Error('pairing failed');
  }
  const body = (await res.json()) as { code: string };
  return body.code;
}
