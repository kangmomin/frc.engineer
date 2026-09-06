import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntercomRuntime } from './core/runtime';
import { SFUAudioController } from './core/sfu';
import { IntercomRPCClient } from './core/transport';
import type { IntercomEnvelope, IntercomJoinedPayload, ServerIntercomEnvelope } from './core/protocol';

const credentials = { groupCode: '123456', password: 'secret', role: 'driver' as const, displayName: 'Driver' };
const joined: IntercomJoinedPayload = {
  membershipGeneration: 1, participantId: 'driver', resumeToken: 'resume', groupCode: '123456', sfuEnabled: false,
  snapshot: { revision: 1, topologyRevision: 1, groupCode: '123456', participants: [{
    id: 'driver', role: 'driver', driverKey: 'car', displayName: 'Driver', online: true,
    speaking: false, ptt: false, busEnabled: true, forcedMuted: false, talkingTo: [],
  }] },
};

function harness() {
  const runtime = new IntercomRuntime();
  const listeners = new Set<(message: ServerIntercomEnvelope) => void>();
  const sent: IntercomEnvelope[] = [];
  runtime.setTransport({
    generation: 1, joined: true, intercomVersion: 1,
    sendIntercom: (message) => { sent.push(message); return true; },
    subscribeIntercom: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  const receive = (message: ServerIntercomEnvelope) => { for (const listener of listeners) listener(message); };
  const reply = (request: string, type: ServerIntercomEnvelope['type'], payload: ServerIntercomEnvelope['payload']) => {
    const matching = sent.filter((value) => value.type === request);
    const message = matching[matching.length - 1];
    receive({ type, requestId: message.requestId, payload } as ServerIntercomEnvelope);
  };
  return { runtime, receive, reply };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('intercom local leave', () => {
  it('clears membership before ACK and ignores snapshots and late joined envelopes', async () => {
    const { runtime, receive, reply } = harness();
    try {
      const joining = runtime.join(credentials);
      reply('intercom_join', 'intercom_joined', joined);
      await joining;
      expect(runtime.getState().status).toBe('joined');
      const leaving = runtime.leave();
      expect(runtime.getState()).toMatchObject({ status: 'ready', snapshot: null, role: null });
      receive({ type: 'intercom_state', payload: { ...joined.snapshot, revision: 2 } });
      receive({ type: 'intercom_joined', payload: joined });
      reply('intercom_join', 'intercom_joined', joined);
      expect(runtime.getState()).toMatchObject({ status: 'ready', snapshot: null, mediaStatus: 'idle' });
      reply('intercom_leave', 'intercom_left', {});
      await leaving;
    } finally { runtime.close(); }
  });

  it.each(['join', 'create'] as const)('invalidates an outstanding %s and preserves a new join after the old leave ACK', async (operation) => {
    const { runtime, reply } = harness();
    try {
      const pending = operation === 'join' ? runtime.join(credentials) : runtime.createGroup('Driver', 'secret');
      const leaving = runtime.leave();
      reply(operation === 'join' ? 'intercom_join' : 'intercom_group_create', 'intercom_joined', joined);
      await pending;
      expect(runtime.getState().status).toBe('ready');
      const newJoin = runtime.join(credentials);
      reply('intercom_join', 'intercom_joined', { ...joined, membershipGeneration: 2 });
      await newJoin;
      reply('intercom_leave', 'intercom_left', {});
      await leaving;
      expect(runtime.getState().status).toBe('joined');
    } finally { runtime.close(); }
  });

  it('stops a microphone granted after leave without starting media', async () => {
    const { runtime, reply } = harness();
    let grant!: (stream: MediaStream) => void;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve; }) } });
    const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const audio = (runtime as unknown as { audio: SFUAudioController }).audio;
    const start = vi.spyOn(audio, 'start').mockResolvedValue();
    try {
      const joining = runtime.join(credentials);
      reply('intercom_join', 'intercom_joined', { ...joined, sfuEnabled: true });
      await Promise.resolve();
      expect(runtime.getState().microphoneStatus).toBe('requesting');
      const leaving = runtime.leave();
      grant({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream);
      await joining;
      expect(track.stop).toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      reply('intercom_leave', 'intercom_left', {});
      await leaving;
      expect(runtime.getState().microphoneStatus).toBe('idle');
    } finally { runtime.close(); }
  });

  it('tears down media synchronously while a previous SFU operation is blocked', async () => {
    const audio = new SFUAudioController(new IntercomRPCClient());
    let release!: () => void;
    const raw = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const clone = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
    const pc = { close: vi.fn() } as unknown as RTCPeerConnection;
    const internal = audio as unknown as {
      operation: Promise<void>; rawTrack: MediaStreamTrack; pc: RTCPeerConnection;
      publications: { clone: MediaStreamTrack }[];
    };
    internal.operation = new Promise<void>((resolve) => { release = resolve; });
    internal.rawTrack = raw;
    internal.publications = [{ clone }];
    internal.pc = pc;
    const stopped = audio.stop();
    expect(clone.enabled).toBe(false);
    expect(raw.stop).toHaveBeenCalled();
    expect(clone.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
    release();
    await stopped;
  });

  it('does not start an SFU operation that was queued before stop', async () => {
    const rpc = new IntercomRPCClient();
    const request = vi.spyOn(rpc, 'request');
    const audio = new SFUAudioController(rpc);
    const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const starting = audio.start('driver', track, []);
    await audio.stop();
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
