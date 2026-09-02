export type IceServerSource = 'cloudflare' | 'static' | 'default';
export type TurnFallbackReason = 'disabled' | 'temporarily_unavailable';

export interface RuntimeIceConfiguration {
  iceServers: RTCIceServer[];
  expiresAt: string;
  expiresAtMs: number;
  source: 'cloudflare';
}

export interface TurnFallbackConfiguration {
  source: 'fallback';
  reason: TurnFallbackReason;
}

export type TurnCredentialsConfiguration = RuntimeIceConfiguration | TurnFallbackConfiguration;

export interface IceServerSelection {
  iceServers: RTCIceServer[];
  source: IceServerSource;
  expiresAt?: string;
}

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ICE_URL_SCHEME = /^(?:stun|turn|turns):[^\s]+$/i;
const MAX_ICE_SERVERS = 16;
const MAX_URLS_PER_SERVER = 8;
const MAX_ICE_URL_LENGTH = 2_048;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_TURN_CREDENTIAL_LIFETIME_MS = 48 * 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseRfc3339Timestamp(value: string): number | null {
  if (!RFC3339_TIMESTAMP.test(value)) return null;
  const [date, timeWithOffset] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const time = timeWithOffset.slice(0, 8).split(':').map(Number);
  const [hour, minute, second] = time;
  const offset = timeWithOffset.slice(8);
  const offsetHours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHours > 23 || offsetMinutes > 59) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseIceServer(value: unknown): RTCIceServer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['urls', 'username', 'credential'])) return null;

  const rawUrls = value.urls;
  if (!Array.isArray(rawUrls) || rawUrls.length === 0 || rawUrls.length > MAX_URLS_PER_SERVER) {
    return null;
  }
  const urls = rawUrls;
  if (!urls.every((url) => typeof url === 'string'
    && url.length <= MAX_ICE_URL_LENGTH
    && url.trim() === url
    && ICE_URL_SCHEME.test(url))) {
    return null;
  }

  if ((value.username !== undefined && typeof value.username !== 'string')
    || (value.credential !== undefined && typeof value.credential !== 'string')) {
    return null;
  }
  const username = typeof value.username === 'string' && value.username.length > 0 ? value.username : undefined;
  const credential = typeof value.credential === 'string' && value.credential.length > 0 ? value.credential : undefined;
  if ((username && (username.length > MAX_CREDENTIAL_LENGTH || username.trim() !== username))
    || (credential && (credential.length > MAX_CREDENTIAL_LENGTH || credential.trim() !== credential))) {
    return null;
  }
  const hasUsername = username !== undefined;
  const hasCredential = credential !== undefined;
  if (hasUsername !== hasCredential) return null;

  const hasRelayUrl = urls.some((url) => /^(?:turn|turns):/i.test(url));
  if (hasRelayUrl !== hasUsername) return null;

  return hasUsername
    ? { urls: [...urls] as string[], username: username!, credential: credential! }
    : { urls: [...urls] as string[] };
}

/**
 * Validates the optional TURN response without retaining any raw payload fields.
 * Runtime credentials are intentionally returned only for in-memory RTC configuration.
 */
export function parseTurnCredentialsPayload(payload: unknown): TurnCredentialsConfiguration | null {
  if (!isRecord(payload) || typeof payload.source !== 'string') return null;

  if (payload.source === 'fallback') {
    if (!hasOnlyKeys(payload, ['source', 'reason'])) return null;
    if (payload.reason !== 'disabled' && payload.reason !== 'temporarily_unavailable') return null;
    return { source: 'fallback', reason: payload.reason };
  }

  if (!hasOnlyKeys(payload, ['source', 'iceServers', 'expiresAt'])) return null;
  if (payload.source !== 'cloudflare' || payload.reason !== undefined) return null;
  if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0 || payload.iceServers.length > MAX_ICE_SERVERS) return null;
  if (typeof payload.expiresAt !== 'string') return null;
  const expiresAtMs = parseRfc3339Timestamp(payload.expiresAt);
  if (expiresAtMs === null) return null;

  const iceServers = payload.iceServers.map(parseIceServer);
  if (iceServers.some((server) => server === null)) return null;
  const hasRelay = iceServers.some((server) => {
    const urls = server && Array.isArray(server.urls) ? server.urls : [];
    return urls.some((url) => /^(?:turn|turns):/i.test(url));
  });
  if (!hasRelay) return null;

  return {
    iceServers: iceServers as RTCIceServer[],
    expiresAt: payload.expiresAt,
    expiresAtMs,
    source: 'cloudflare',
  };
}

export function isRuntimeIceCurrent(configuration: RuntimeIceConfiguration | null, nowMs: number): configuration is RuntimeIceConfiguration {
  return configuration !== null && configuration.expiresAtMs > nowMs;
}

export function isRuntimeIceLifetimeAllowed(configuration: RuntimeIceConfiguration, receivedAtMs: number): boolean {
  const lifetimeMs = configuration.expiresAtMs - receivedAtMs;
  return lifetimeMs > 0 && lifetimeMs <= MAX_TURN_CREDENTIAL_LIFETIME_MS;
}

export function selectIceServers(
  runtime: RuntimeIceConfiguration | null,
  fallbackIceServers: RTCIceServer[],
  fallbackSource: Extract<IceServerSource, 'static' | 'default'>,
  nowMs: number,
): IceServerSelection {
  if (isRuntimeIceCurrent(runtime, nowMs)) {
    return {
      iceServers: runtime.iceServers,
      source: runtime.source,
      expiresAt: runtime.expiresAt,
    };
  }
  return { iceServers: fallbackIceServers, source: fallbackSource };
}

/** Schedules refresh at 80% of the observed credential lifetime. */
export function getTurnRefreshDelayMs(
  configuration: RuntimeIceConfiguration,
  receivedAtMs: number,
  nowMs: number,
): number {
  const refreshAtMs = receivedAtMs + (configuration.expiresAtMs - receivedAtMs) * 0.8;
  return Math.max(0, Math.floor(refreshAtMs - nowMs));
}

/** Only this exact old-server error makes TURN support an optional fallback. */
export function isLegacyTurnUnsupportedError(error: string): boolean {
  return error === 'unknown message type: turn_credentials_request';
}
