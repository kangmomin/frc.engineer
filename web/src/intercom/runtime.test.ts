import { describe, expect, it, vi } from 'vitest';
import {
  IntercomRPCClient,
  IntercomRPCError,
  IntercomRuntime,
  type IntercomRuntimeState,
  type IntercomSignalingAdapter,
  type IntercomSnapshot,
} from './core';

const preparingSnapshot: IntercomSnapshot = {
  revision: 1,
  topologyRevision: 1,
  groupCode: '123456',
  privateSession: { phase: 'preparing', driverKey: 'driver-a' },
  participants: [{
    id: 'chief',
    role: 'chief',
    displayName: 'Chief',
    online: true,
    speaking: false,
    ptt: false,
    busEnabled: true,
    forcedMuted: false,
    talkingTo: [],
  }],
};

interface RuntimeInternals {
  state: IntercomRuntimeState;
  rpc: IntercomRPCClient;
  joined: object | null;
  acknowledgedPrivateRevision: number;
  tryPrivateReady: (revision: number) => void;
  rebuildMedia: () => Promise<void>;
  scheduleBrokerRebuild: (error: unknown) => boolean;
  audio: {
    disableAll: () => void;
    reconcileSubscriptions: () => Promise<void>;
    remoteAudio: { muteAll: () => void };
  };
  reconcileTopology: () => Promise<void>;
}

describe('intercom runtime recovery', () => {
  it('records private readiness only after delivery succeeds and retries the latest revision', async () => {
    vi.useFakeTimers();
    const runtime = new IntercomRuntime();
    const internal = runtime as unknown as RuntimeInternals;
    const notify = vi.spyOn(internal.rpc, 'notify').mockReturnValueOnce(false).mockReturnValueOnce(true);
    internal.state = {
      ...runtime.getState(),
      role: 'chief',
      participantId: 'chief',
      snapshot: preparingSnapshot,
    };
    try {
      internal.tryPrivateReady(1);
      expect(internal.acknowledgedPrivateRevision).toBe(-1);
      internal.state = {
        ...internal.state,
        snapshot: { ...preparingSnapshot, revision: 2 },
      };
      await vi.advanceTimersByTimeAsync(250);
      expect(notify).toHaveBeenNthCalledWith(1, 'intercom_private_ready', { revision: 1 });
      expect(notify).toHaveBeenNthCalledWith(2, 'intercom_private_ready', { revision: 2 });
      expect(internal.acknowledgedPrivateRevision).toBe(2);
    } finally {
      runtime.close();
      vi.useRealTimers();
    }
  });

  it('automatically schedules one bounded rebuild for a structured broker error', () => {
    const runtime = new IntercomRuntime();
    const internal = runtime as unknown as RuntimeInternals;
    const adapter: IntercomSignalingAdapter = {
      generation: 1,
      joined: true,
      intercomVersion: 1,
      sendIntercom: () => true,
      subscribeIntercom: () => () => {},
    };
    runtime.setTransport(adapter);
    internal.joined = {};
    const rebuild = vi.spyOn(internal, 'rebuildMedia').mockResolvedValue();
    try {
      const error = new IntercomRPCError('broker_rebuild_required', 'rebuild', true);
      expect(internal.scheduleBrokerRebuild(error)).toBe(true);
      expect(internal.scheduleBrokerRebuild(error)).toBe(true);
      expect(rebuild).toHaveBeenCalledTimes(1);
    } finally {
      internal.joined = null;
      runtime.close();
    }
  });

  it('fail-closes sources and sinks synchronously on adapter invalidation', () => {
    const runtime = new IntercomRuntime();
    const internal = runtime as unknown as RuntimeInternals;
    let invalidate = () => {};
    const adapter: IntercomSignalingAdapter = {
      generation: 1,
      joined: true,
      intercomVersion: 1,
      sendIntercom: () => true,
      subscribeIntercom: () => () => {},
      subscribeInvalidation: (listener) => {
        invalidate = listener;
        return () => { invalidate = () => {}; };
      },
    };
    runtime.setTransport(adapter);
    internal.joined = {};
    const disableSources = vi.spyOn(internal.audio, 'disableAll');
    const muteSinks = vi.spyOn(internal.audio.remoteAudio, 'muteAll');
    try {
      invalidate();
      expect(disableSources).toHaveBeenCalled();
      expect(muteSinks).toHaveBeenCalled();
      expect(runtime.getState().status).toBe('reconnecting');
    } finally {
      internal.joined = null;
      runtime.close();
    }
  });

  it('fail-closes a connected runtime when media reconciliation fails', async () => {
    const runtime = new IntercomRuntime();
    const internal = runtime as unknown as RuntimeInternals;
    internal.joined = {};
    internal.state = {
      ...runtime.getState(),
      status: 'joined',
      mediaStatus: 'connected',
      role: 'engineer',
      participantId: 'engineer',
      snapshot: preparingSnapshot,
    };
    vi.spyOn(internal.audio, 'reconcileSubscriptions').mockRejectedValue(new Error('SFU ICE gathering timed out.'));
    const disableSources = vi.spyOn(internal.audio, 'disableAll');
    const muteSinks = vi.spyOn(internal.audio.remoteAudio, 'muteAll');
    try {
      await internal.reconcileTopology();
      expect(disableSources).toHaveBeenCalled();
      expect(muteSinks).toHaveBeenCalled();
      expect(runtime.getState()).toMatchObject({
        mediaStatus: 'failed',
        error: 'SFU ICE gathering timed out.',
      });
    } finally {
      internal.joined = null;
      runtime.close();
    }
  });

  it('fail-closes synchronously when hook cleanup deactivates its surface', () => {
    const runtime = new IntercomRuntime();
    const internal = runtime as unknown as RuntimeInternals;
    const disableSources = vi.spyOn(internal.audio, 'disableAll');
    const muteSinks = vi.spyOn(internal.audio.remoteAudio, 'muteAll');
    internal.state = { ...runtime.getState(), ptt: true };
    try {
      runtime.setSurfaceActive(false);
      expect(disableSources).toHaveBeenCalled();
      expect(muteSinks).toHaveBeenCalled();
      expect(runtime.getState().ptt).toBe(false);
    } finally {
      runtime.close();
    }
  });
});
