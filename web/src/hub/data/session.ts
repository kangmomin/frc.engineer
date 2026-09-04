// Hosted platform session state. The normal Steam session is durable in
// localStorage; a short-lived View As child is tab-scoped in sessionStorage.
// Only tokens (and an advisory child expiry) are persisted. Actor/subject
// identity is always rebuilt from explicit /me requests.
import { getPlatformBase, getPlatformUrl, isPlatformConfigured } from './platformBase';

export const PARENT_TOKEN_KEY = 'pitwall.platformToken';
export const VIEW_AS_TOKEN_KEY = 'pitwall.viewAsToken';
export const VIEW_AS_EXPIRY_KEY = 'pitwall.viewAsExpiresAt';
export const SESSION_UNAUTHORIZED_EVENT = 'pitwall:session-unauthorized';
const LOGIN_INTENT_KEY = 'pitwall.loginIntent';

export interface ViewAsIdentity {
  sessionId: string;
  actor: { id: string; persona: string };
  expiresAt: string;
}

export interface PlatformAccount {
  id: string;
  steamId64: string;
  persona: string;
  avatarUrl: string;
  kind: string;
  verified: boolean;
  banned: boolean;
  createdAt: string;
  admin?: boolean;
  permissions?: string[];
  viewAs?: ViewAsIdentity;
}

export interface StartViewAsResponse {
  token: string;
  sessionId: string;
  expiresAt: string;
  subject: Pick<PlatformAccount, 'id' | 'persona' | 'avatarUrl' | 'kind' | 'verified' | 'banned'>;
}

export class SessionRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'SessionRequestError';
  }
}

export function getParentSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage?.getItem(PARENT_TOKEN_KEY) ?? null;
}

export function getViewAsToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage?.getItem(VIEW_AS_TOKEN_KEY) ?? null;
}

export function getViewAsAdvisoryExpiry(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage?.getItem(VIEW_AS_EXPIRY_KEY) ?? null;
}

export function getActiveSessionToken(): string | null {
  return getViewAsToken() ?? getParentSessionToken();
}

// Backward-compatible alias for callers outside the Hub data layer.
export const getSessionToken = getActiveSessionToken;

function setParentSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PARENT_TOKEN_KEY, token);
}

export function storeViewAsSession(token: string, expiresAt: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(VIEW_AS_TOKEN_KEY, token);
  window.sessionStorage.setItem(VIEW_AS_EXPIRY_KEY, expiresAt);
}

export function clearParentSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PARENT_TOKEN_KEY);
}

export function clearViewAsSession(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(VIEW_AS_TOKEN_KEY);
  window.sessionStorage.removeItem(VIEW_AS_EXPIRY_KEY);
}

export function clearCurrentParentSession(parentToken: string, expectedChildToken: string | null): boolean {
  if (getParentSessionToken() !== parentToken || getViewAsToken() !== expectedChildToken) return false;
  clearViewAsSession();
  clearParentSessionToken();
  return true;
}

// Legacy name means the durable parent session only. Child cleanup is always
// explicit so a child 401 can never sign the actor out.
export const clearSessionToken = clearParentSessionToken;

export function captureTokenFromFragment(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  if (!hash || !hash.includes('token=')) return false;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  const clean = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', clean);
  const intended = window.sessionStorage.getItem(LOGIN_INTENT_KEY) !== null;
  window.sessionStorage.removeItem(LOGIN_INTENT_KEY);
  if (!intended || !token) return false;
  clearViewAsSession();
  setParentSessionToken(token);
  return true;
}

export function beginSteamLogin(): void {
  if (typeof window === 'undefined' || !isPlatformConfigured()) return;
  window.sessionStorage.setItem(LOGIN_INTENT_KEY, '1');
  window.location.href = getPlatformBase() + '/auth/steam/login';
}

async function tokenFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  if (!isPlatformConfigured()) throw new SessionRequestError(0, 'platform unavailable');
  return fetch(getPlatformUrl(path), {
    ...init,
    cache: init?.cache ?? 'no-store',
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

// Token-explicit and storage-neutral by design. Callers decide whether a 401
// belongs to the child or parent before changing either store.
export async function fetchMeWithToken(token: string): Promise<PlatformAccount> {
  const res = await tokenFetch(token, '/me');
  if (!res.ok) throw new SessionRequestError(res.status, `me failed (${res.status})`);
  return (await res.json()) as PlatformAccount;
}

// Convenience active-token fetch. It intentionally does not clear storage.
export async function fetchMe(): Promise<PlatformAccount | null> {
  const token = getActiveSessionToken();
  if (!token) return null;
  try {
    return await fetchMeWithToken(token);
  } catch {
    return null;
  }
}

export async function startViewAs(accountId: string, parentToken: string): Promise<StartViewAsResponse> {
  const res = await tokenFetch(parentToken, '/view-as', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) throw new SessionRequestError(res.status, `view as failed (${res.status})`);
  return (await res.json()) as StartViewAsResponse;
}

export async function exitViewAs(childToken: string): Promise<void> {
  await tokenFetch(childToken, '/view-as/exit', { method: 'POST' });
}

export async function revokeSession(token: string): Promise<void> {
  try {
    await tokenFetch(token, '/auth/logout', { method: 'POST' });
  } catch {
    // Local state ownership remains with the guarded caller.
  }
}

export async function platformLogout(): Promise<void> {
  const token = getParentSessionToken();
  if (token) await revokeSession(token);
  clearViewAsSession();
  clearParentSessionToken();
}

export async function createPairingCode(): Promise<string> {
  const token = getParentSessionToken();
  if (!token) throw new Error('pairing failed');
  const res = await tokenFetch(token, '/device/pair', { method: 'POST' });
  if (!res.ok) throw new Error('pairing failed');
  return ((await res.json()) as { code: string }).code;
}

export function notifySessionUnauthorized(token: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT, { detail: { token } }));
}

export function subscribeSessionUnauthorized(listener: (token: string) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<{ token: string }>).detail.token);
  window.addEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
}
