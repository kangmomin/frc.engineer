import { describe, expect, it } from 'vitest';
import {
  CLIENT_INTERCOM_TYPES,
  SERVER_INTERCOM_TYPES,
  isClientIntercomEnvelope,
  parseServerIntercomEnvelope,
} from './core';

const rawFixtures = import.meta.glob('../../../internal/signaling/testdata/intercom/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('intercom canonical protocol fixtures', () => {
  it('consumes every backend-owned fixture', () => {
    expect(Object.keys(rawFixtures)).toHaveLength(23);
    for (const [path, raw] of Object.entries(rawFixtures)) {
      const envelope = JSON.parse(raw) as { type: string };
      if (CLIENT_INTERCOM_TYPES.has(envelope.type)) {
        expect(isClientIntercomEnvelope(envelope), path).toBe(true);
      } else if (SERVER_INTERCOM_TYPES.has(envelope.type)) {
        expect(parseServerIntercomEnvelope(envelope), path).not.toBeNull();
      } else {
        expect(['intercom_bridge_state', 'room_joined'], path).toContain(envelope.type);
      }
    }
  });

  it('rejects malformed and oversized fields', () => {
    expect(isClientIntercomEnvelope({ type: 'intercom_leave', payload: {} })).toBe(false);
    expect(parseServerIntercomEnvelope({
      type: 'intercom_state',
      payload: { revision: -1, topologyRevision: 0, groupCode: '1', participants: [] },
    })).toBeNull();
    expect(parseServerIntercomEnvelope({
      type: 'intercom_error',
      payload: { code: 'x', message: 'x'.repeat(1_025), retryable: false },
    })).toBeNull();
  });

  it('enforces frozen string limits as UTF-8 bytes', () => {
    const requestId = 'request-1';
    expect(isClientIntercomEnvelope({
      type: 'intercom_group_create',
      requestId,
      payload: { displayName: '가'.repeat(14), password: 'pw' },
    })).toBe(false);
    expect(isClientIntercomEnvelope({
      type: 'intercom_group_create',
      requestId,
      payload: { displayName: 'Driver', password: '가'.repeat(43) },
    })).toBe(false);
    expect(isClientIntercomEnvelope({
      type: 'intercom_sfu_renegotiate',
      requestId,
      payload: {
        sessionHandle: 'session-1',
        sessionDescription: { type: 'answer', sdp: '가'.repeat(21_846) },
      },
    })).toBe(false);
    expect(parseServerIntercomEnvelope({
      type: 'intercom_left',
      requestId: '가'.repeat(43),
      payload: {},
    })).toBeNull();
  });
});
