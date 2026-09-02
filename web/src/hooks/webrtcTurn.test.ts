import { describe, expect, it } from 'vitest';
import {
  getTurnRefreshDelayMs,
  isLegacyTurnUnsupportedError,
  isRuntimeIceLifetimeAllowed,
  parseTurnCredentialsPayload,
  selectIceServers,
} from './webrtcTurn';

const receivedAtMs = Date.parse('2026-09-03T00:00:00Z');
const expiresAt = '2026-09-03T01:00:00Z';

function runtimePayload(overrides: Record<string, unknown> = {}) {
  return {
    source: 'cloudflare',
    iceServers: [{
      urls: ['stun:stun.example.test:3478', 'turn:turn.example.test:3478?transport=udp'],
      username: 'fake-user',
      credential: 'fake-credential',
    }],
    expiresAt,
    ...overrides,
  };
}

describe('parseTurnCredentialsPayload', () => {
  it('accepts a valid short-lived Cloudflare ICE configuration', () => {
    const parsed = parseTurnCredentialsPayload(runtimePayload());

    expect(parsed).toMatchObject({ source: 'cloudflare', expiresAt });
    expect(parsed && 'iceServers' in parsed && parsed.iceServers).toHaveLength(1);
  });

  it('rejects malformed runtime credentials rather than passing them to RTCPeerConnection', () => {
    expect(parseTurnCredentialsPayload(runtimePayload({ expiresAt: 'tomorrow' }))).toBeNull();
    expect(parseTurnCredentialsPayload(runtimePayload({ expiresAt: '2026-02-30T01:00:00Z' }))).toBeNull();
    expect(parseTurnCredentialsPayload(runtimePayload({
      iceServers: [{ urls: 'turn:turn.example.test:3478', username: 'fake-user' }],
    }))).toBeNull();
    expect(parseTurnCredentialsPayload(runtimePayload({ source: 'fallback', reason: 'disabled' }))).toBeNull();
    expect(parseTurnCredentialsPayload({ ...runtimePayload(), unexpected: true })).toBeNull();
    expect(parseTurnCredentialsPayload(runtimePayload({
      iceServers: [{ urls: ['stun:stun.example.test:3478'] }],
    }))).toBeNull();
    expect(parseTurnCredentialsPayload(runtimePayload({
      iceServers: [{ urls: ['turn:turn.example.test:3478 '], username: 'fake-user', credential: 'fake-credential' }],
    }))).toBeNull();
  });

  it('accepts only the documented fallback payload', () => {
    expect(parseTurnCredentialsPayload({ source: 'fallback', reason: 'temporarily_unavailable' }))
      .toEqual({ source: 'fallback', reason: 'temporarily_unavailable' });
    expect(parseTurnCredentialsPayload({ source: 'fallback', reason: 'disabled', iceServers: [] })).toBeNull();
  });
});

describe('runtime ICE priority and refresh', () => {
  it('prefers an unexpired runtime config and refreshes at 80% of its lifetime', () => {
    const runtime = parseTurnCredentialsPayload(runtimePayload());
    if (!runtime || !('iceServers' in runtime)) throw new Error('test fixture must be valid');

    const selected = selectIceServers(runtime, [{ urls: 'stun:static.example.test:3478' }], 'static', receivedAtMs + 1);
    expect(selected.source).toBe('cloudflare');
    expect(selected.expiresAt).toBe(expiresAt);
    expect(getTurnRefreshDelayMs(runtime, receivedAtMs, receivedAtMs)).toBe(2_880_000);
    expect(isRuntimeIceLifetimeAllowed(runtime, receivedAtMs)).toBe(true);
    expect(isRuntimeIceLifetimeAllowed(runtime, runtime.expiresAtMs - (48 * 60 * 60 * 1_000) - 1)).toBe(false);
  });

  it('falls back once runtime credentials have expired', () => {
    const runtime = parseTurnCredentialsPayload(runtimePayload());
    if (!runtime || !('iceServers' in runtime)) throw new Error('test fixture must be valid');

    const selected = selectIceServers(runtime, [{ urls: 'stun:default.example.test:3478' }], 'default', runtime.expiresAtMs);
    expect(selected).toEqual({
      iceServers: [{ urls: 'stun:default.example.test:3478' }],
      source: 'default',
    });
  });
});

describe('legacy TURN fallback', () => {
  it('recognizes only the exact old-server unknown-message response', () => {
    expect(isLegacyTurnUnsupportedError('unknown message type: turn_credentials_request')).toBe(true);
    expect(isLegacyTurnUnsupportedError('unknown message type: other')).toBe(false);
    expect(isLegacyTurnUnsupportedError('not in a room')).toBe(false);
  });
});
