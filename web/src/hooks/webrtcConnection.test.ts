import { describe, expect, it } from 'vitest';
import {
  parseReliableDataPing,
  reconnectKindForSignalingClose,
  shouldInvalidateIntercomCleanup,
  shouldInvalidateIntercomTransport,
  shouldRunSignalingCleanup,
  shouldRetrySignalingError,
} from './webrtcConnection';

describe('parseReliableDataPing', () => {
  it('counts only a JSON ping on the reliable data channel', () => {
    expect(parseReliableDataPing('data', JSON.stringify({ type: 'ping', ts: 42 }))).toEqual({ ts: 42 });
    expect(parseReliableDataPing('data', JSON.stringify({ type: 'telemetry' }))).toBeNull();
    expect(parseReliableDataPing('fast', JSON.stringify({ type: 'ping', ts: 42 }))).toBeNull();
    expect(parseReliableDataPing('data', JSON.stringify({ type: 'ping' }))).toBeNull();
    expect(parseReliableDataPing('data', JSON.stringify({ type: 'ping', ts: '42' }))).toBeNull();
    expect(parseReliableDataPing('data', JSON.stringify({ type: 'ping', ts: 42, extra: true }))).toBeNull();
    expect(parseReliableDataPing('data', 'not-json')).toBeNull();
  });
});

describe('reconnectKindForSignalingClose', () => {
  it('reuses peer identity only while the P2P connection remains live', () => {
    expect(reconnectKindForSignalingClose('connected')).toBe('signaling-rebind');
    expect(reconnectKindForSignalingClose('disconnected')).toBe('full-rebuild');
    expect(reconnectKindForSignalingClose(undefined)).toBe('full-rebuild');
  });
});

describe('shouldInvalidateIntercomTransport', () => {
  const live = { generation: 4, joined: true, intercomVersion: 1 };

  it('invalidates immediately on signaling loss, generation replacement, or version loss', () => {
    expect(shouldInvalidateIntercomTransport(live, { ...live, joined: false }, 1)).toBe(true);
    expect(shouldInvalidateIntercomTransport(live, { ...live, generation: 5 }, 1)).toBe(true);
    expect(shouldInvalidateIntercomTransport(live, { ...live, intercomVersion: undefined }, 1)).toBe(true);
  });

  it('does not invalidate unchanged live authority or a transport that was already down', () => {
    expect(shouldInvalidateIntercomTransport(live, live, 1)).toBe(false);
    expect(shouldInvalidateIntercomTransport({ ...live, joined: false }, { ...live, joined: false }, 1)).toBe(false);
  });
});

describe('shouldRunSignalingCleanup', () => {
  it('allows explicit disconnect and terminal cleanup of current authority', () => {
    const socket = {};
    expect(shouldRunSignalingCleanup(socket, 4)).toBe(true);
    expect(shouldRunSignalingCleanup(socket, 4, { socket, intercomGeneration: 4 })).toBe(true);
  });

  it('rejects stale cleanup after either socket or membership generation replacement', () => {
    const oldSocket = {};
    const newSocket = {};
    const owner = { socket: oldSocket, intercomGeneration: 4 };
    expect(shouldRunSignalingCleanup(newSocket, 5, owner)).toBe(false);
    expect(shouldRunSignalingCleanup(newSocket, 4, owner)).toBe(false);
    expect(shouldRunSignalingCleanup(oldSocket, 5, owner)).toBe(false);
  });
});

describe('shouldInvalidateIntercomCleanup', () => {
  const live = { generation: 4, joined: true, intercomVersion: 1 };

  it('invalidates current authority once for explicit disconnect and terminal failure', () => {
    expect(shouldInvalidateIntercomCleanup(live)).toBe(true);
    expect(shouldInvalidateIntercomCleanup(live, 4)).toBe(true);
    expect(shouldInvalidateIntercomCleanup({ ...live, joined: false })).toBe(false);
  });

  it('does not let stale cleanup invalidate a replacement generation', () => {
    expect(shouldInvalidateIntercomCleanup(live, 3)).toBe(false);
  });
});

describe('shouldRetrySignalingError', () => {
  it('briefly retries a full room while recovering an established session', () => {
    expect(shouldRetrySignalingError('room abc is full', true, 1)).toBe(true);
    expect(shouldRetrySignalingError('room abc is full', true, 2)).toBe(true);
    expect(shouldRetrySignalingError('room abc is full', true, 3)).toBe(false);
  });

  it('does not retry terminal initial or password failures', () => {
    expect(shouldRetrySignalingError('room abc is full', false, 0)).toBe(false);
    expect(shouldRetrySignalingError('invalid password', true, 0)).toBe(false);
  });
});
