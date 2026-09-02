import { describe, expect, it, vi } from 'vitest';
import {
  AuthoritativeRemoteTrackBinder,
  RemoteAudioRegistry,
  cloneDisabledTrack,
  isPTTKeyDown,
  publicationSpecsForRole,
  waitForIceGatheringComplete,
} from './core';

function remoteTrack(): MediaStreamTrack {
  return {
    readyState: 'live',
    addEventListener: () => {},
  } as unknown as MediaStreamTrack;
}

const remoteRoute = {
  mid: 'audio-1',
  trackKey: 'participant-1:driver_engineer',
  class: 'driver_engineer' as const,
  participantId: 'participant-1',
};

describe('intercom media helpers', () => {
  it('defines the frozen publication topology for each role', () => {
    expect(publicationSpecsForRole('driver', [])).toEqual([
      { class: 'driver_engineer' },
      { class: 'driver_chief' },
    ]);
    expect(publicationSpecsForRole('engineer', [])).toEqual([
      { class: 'engineer_bus' },
      { class: 'driver_radio' },
    ]);
    expect(publicationSpecsForRole('chief', ['a', 'b'])).toEqual([
      { class: 'engineer_bus' },
      { class: 'chief_private', targetDriverKey: 'a' },
      { class: 'chief_private', targetDriverKey: 'b' },
    ]);
  });

  it('disables a clone before it can be published', () => {
    const clone = { enabled: true };
    const source = { clone: () => clone } as unknown as MediaStreamTrack;
    expect(cloneDisabledTrack(source)).toBe(clone);
    expect(clone.enabled).toBe(false);
  });

  it('recognizes only an unmodified, non-repeat Space keydown', () => {
    const event = {
      code: 'Space', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null,
    } as unknown as KeyboardEvent;
    expect(isPTTKeyDown(event)).toBe(true);
    expect(isPTTKeyDown({ ...event, repeat: true } as KeyboardEvent)).toBe(false);
    expect(isPTTKeyDown({ ...event, ctrlKey: true } as KeyboardEvent)).toBe(false);
  });

  it('waits until ICE gathering completes', async () => {
    let listener: (() => void) | undefined;
    const pc = {
      iceGatheringState: 'gathering',
      addEventListener: (_type: string, next: () => void) => { listener = next; },
      removeEventListener: () => {},
    } as unknown as RTCPeerConnection;
    const pending = waitForIceGatheringComplete(pc, 100);
    Object.defineProperty(pc, 'iceGatheringState', { value: 'complete' });
    listener?.();
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects instead of sending an incomplete description after the ICE deadline', async () => {
    vi.useFakeTimers();
    const removeEventListener = vi.fn();
    const pc = {
      iceGatheringState: 'gathering',
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as RTCPeerConnection;
    try {
      const pending = waitForIceGatheringComplete(pc, 100);
      const rejected = expect(pending).rejects.toThrow('ICE gathering timed out');
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(removeEventListener).toHaveBeenCalledWith('icegatheringstatechange', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('binds a delayed remote track only after its authoritative route arrives', () => {
    const binder = new AuthoritativeRemoteTrackBinder();
    const track = remoteTrack();
    expect(binder.receive(remoteRoute.mid, track)).toBeNull();
    expect(binder.setRoutes([remoteRoute])).toEqual([{ route: remoteRoute, track }]);
    expect(binder.receive(remoteRoute.mid, track)).toBeNull();
  });

  it('binds an ontrack event when its authoritative route is already known', () => {
    const binder = new AuthoritativeRemoteTrackBinder();
    const track = remoteTrack();
    expect(binder.setRoutes([remoteRoute])).toEqual([]);
    expect(binder.receive(remoteRoute.mid, track)).toEqual({ route: remoteRoute, track });
    expect(binder.receive(remoteRoute.mid, track)).toBeNull();
  });

  it('does not reuse a pending track when authority replaces the track key for a mid', () => {
    const binder = new AuthoritativeRemoteTrackBinder();
    const track = remoteTrack();
    binder.setRoutes([remoteRoute]);
    expect(binder.receive(remoteRoute.mid, track)).toEqual({ route: remoteRoute, track });
    const replacement = { ...remoteRoute, trackKey: 'participant-2:driver_engineer', participantId: 'participant-2' };
    expect(binder.setRoutes([replacement])).toEqual([]);
  });

  it('creates remote audio sinks muted until authority gates are applied', () => {
    const element = {
      autoplay: false,
      muted: false,
      dataset: {},
      style: {},
      srcObject: null,
      setAttribute: () => {},
      play: () => Promise.resolve(),
      pause: () => {},
      remove: () => {},
    };
    vi.stubGlobal('MediaStream', class {});
    vi.stubGlobal('document', {
      createElement: () => element,
      body: { appendChild: () => {} },
    });
    try {
      const registry = new RemoteAudioRegistry();
      registry.attach(remoteRoute, remoteTrack());
      expect(element.muted).toBe(true);
      registry.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
