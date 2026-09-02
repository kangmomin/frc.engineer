import { describe, expect, it, vi } from 'vitest';
import {
  IntercomRPCClient,
  IntercomRPCError,
  type IntercomEnvelope,
  type IntercomSignalingAdapter,
  type ServerIntercomEnvelope,
} from './core';

function harness() {
  const sent: IntercomEnvelope[] = [];
  const listeners = new Set<(message: ServerIntercomEnvelope) => void>();
  const adapter: IntercomSignalingAdapter = {
    generation: 1,
    joined: true,
    intercomVersion: 1,
    sendIntercom: (message) => { sent.push(message); return true; },
    subscribeIntercom: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { sent, listeners, adapter };
}

describe('generation-aware intercom RPC', () => {
  it('correlates typed success responses', async () => {
    const { sent, listeners, adapter } = harness();
    const client = new IntercomRPCClient();
    client.setAdapter(adapter);
    const pending = client.request('intercom_sfu_session_new', {}, 'intercom_sfu_session');
    const requestId = sent[0].requestId!;
    for (const listener of listeners) listener({ type: 'intercom_sfu_session', requestId, payload: { sessionHandle: 'session-1' } });
    await expect(pending).resolves.toMatchObject({ type: 'intercom_sfu_session' });
    client.close();
  });

  it('rejects pending work when the transport generation changes', async () => {
    const { adapter } = harness();
    const client = new IntercomRPCClient();
    client.setAdapter(adapter);
    const pending = client.request('intercom_sfu_session_new', {}, 'intercom_sfu_session');
    client.setAdapter({ ...adapter, generation: 2 });
    await expect(pending).rejects.toThrow('generation changed');
    client.close();
  });

  it('preserves structured codes on correlated intercom errors', async () => {
    const { sent, listeners, adapter } = harness();
    const client = new IntercomRPCClient();
    client.setAdapter(adapter);
    const pending = client.request('intercom_sfu_subscribe', { sessionHandle: 'session-1' }, 'intercom_sfu_subscribed');
    const requestId = sent[0].requestId!;
    for (const listener of listeners) listener({
      type: 'intercom_error',
      requestId,
      payload: { code: 'broker_rebuild_required', message: 'rebuild', retryable: true },
    });
    await expect(pending).rejects.toMatchObject({
      name: 'IntercomRPCError',
      code: 'broker_rebuild_required',
      retryable: true,
    });
    await pending.catch((error: unknown) => expect(error).toBeInstanceOf(IntercomRPCError));
    client.close();
  });

  it('rate-limits an activity lease to four updates per second', async () => {
    vi.useFakeTimers();
    const { ActivityLease } = await import('./core');
    const send = vi.fn();
    const lease = new ActivityLease(send);
    lease.update({ speaking: true });
    lease.update({ ptt: true });
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    lease.update({ ptt: true });
    expect(send).toHaveBeenCalledTimes(2);
    lease.stop();
    vi.useRealTimers();
  });
});
