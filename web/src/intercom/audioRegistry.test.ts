import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAudioRegistry, type IntercomSnapshot, type RemoteTrackRoute } from '../../../shared/intercom';

interface FakeAudioElement {
  autoplay: boolean;
  muted: boolean;
  dataset: Record<string, string>;
  style: Record<string, string>;
  srcObject: unknown;
  rejectNext: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
}

const snapshot: IntercomSnapshot = {
  revision: 1,
  topologyRevision: 1,
  groupCode: '123456',
  participants: [{
    id: 'driver',
    role: 'driver',
    displayName: 'Driver',
    driverKey: 'driver-a',
    online: true,
    speaking: false,
    ptt: false,
    busEnabled: true,
    forcedMuted: false,
    talkingTo: [],
  }],
};

const audibleRoute: RemoteTrackRoute = {
  trackKey: 'engineer:bus',
  participantId: 'engineer',
  class: 'engineer_bus',
};

function track(): MediaStreamTrack {
  return { addEventListener: vi.fn() } as unknown as MediaStreamTrack;
}

function installAudioHarness() {
  const elements: FakeAudioElement[] = [];
  let rejectNewElement = false;
  vi.stubGlobal('MediaStream', class {});
  vi.stubGlobal('document', {
    createElement: () => {
      const element: FakeAudioElement = {
        autoplay: false,
        muted: false,
        dataset: {},
        style: {},
        srcObject: null,
        rejectNext: rejectNewElement,
        play: vi.fn(),
        pause: vi.fn(),
        remove: vi.fn(),
        setAttribute: vi.fn(),
      };
      rejectNewElement = false;
      element.play.mockImplementation(() => {
        if (element.rejectNext) {
          element.rejectNext = false;
          return Promise.reject(new Error('autoplay blocked'));
        }
        return Promise.resolve();
      });
      elements.push(element);
      return element;
    },
    body: { appendChild: vi.fn() },
  });
  return {
    elements,
    rejectNextElement: () => { rejectNewElement = true; },
  };
}

async function flushPlayback(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => vi.unstubAllGlobals());

describe('authoritative remote audio playback', () => {
  it('does not unlock from muted playback and surfaces rejected audible autoplay', async () => {
    const { elements } = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.attach(audibleRoute, track());
    const element = elements[0];
    expect(element.muted).toBe(true);
    expect(element.play).toHaveBeenCalledTimes(1);

    element.rejectNext = true;
    registry.applySinkGates('driver', 'driver', snapshot);
    expect(element.muted).toBe(false);
    await flushPlayback();
    expect(registry.isBlocked()).toBe(true);
  });

  it('applies the last fresh gate and attempts audible playback for the first delayed attachment', async () => {
    const { elements } = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.applySinkGates('driver', 'driver', snapshot);
    registry.attach(audibleRoute, track());
    expect(elements[0].muted).toBe(false);
    expect(elements[0].play).toHaveBeenCalledTimes(1);
    await flushPlayback();
    expect(registry.isBlocked()).toBe(false);
  });

  it('manual enable plays current audible elements and records a genuine unlock', async () => {
    const harness = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.applySinkGates('driver', 'driver', snapshot);
    harness.rejectNextElement();
    registry.attach(audibleRoute, track());
    await flushPlayback();
    expect(registry.isBlocked()).toBe(true);
    await expect(registry.enableAudio()).resolves.toBe(true);
    expect(harness.elements[0].play).toHaveBeenCalledTimes(2);
    expect(registry.isBlocked()).toBe(false);
  });

  it('manual enable plays muted and audible elements without changing their gates', async () => {
    const { elements } = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.applySinkGates('driver', 'driver', {
      ...snapshot,
      privateSession: { phase: 'active', driverKey: 'driver-a' },
    });
    registry.attach(audibleRoute, track());
    registry.attach({ ...audibleRoute, trackKey: 'engineer:radio', class: 'driver_radio' }, track());
    await flushPlayback();
    expect(elements[1].muted).toBe(true);
    const mutedPlayCount = elements[1].play.mock.calls.length;
    await expect(registry.enableAudio()).resolves.toBe(true);
    expect(elements[0].muted).toBe(false);
    expect(elements[1].muted).toBe(true);
    expect(elements[1].play).toHaveBeenCalledTimes(mutedPlayCount + 1);
  });

  it('an all-muted user gesture unlocks later audible tracks without opening muted gates', async () => {
    const harness = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    const radioRoute = { ...audibleRoute, trackKey: 'engineer:radio', class: 'driver_radio' as const };
    registry.applySinkGates('driver', 'driver', snapshot);
    harness.rejectNextElement();
    registry.attach(radioRoute, track());
    await flushPlayback();
    expect(registry.isBlocked()).toBe(true);

    registry.applySinkGates('driver', 'driver', {
      ...snapshot,
      privateSession: { phase: 'active', driverKey: 'driver-a' },
    });
    expect(harness.elements[0].muted).toBe(true);
    await expect(registry.enableAudio()).resolves.toBe(true);
    expect(harness.elements[0].muted).toBe(true);
    expect(registry.isBlocked()).toBe(false);

    registry.attach({ ...audibleRoute, trackKey: 'chief:bus' }, track());
    await flushPlayback();
    expect(harness.elements[1].muted).toBe(false);
    expect(harness.elements[1].play).toHaveBeenCalledTimes(1);
  });

  it('auto-plays future audible tracks only while unlocked and re-blocks on rejection', async () => {
    const harness = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.applySinkGates('driver', 'driver', snapshot);
    harness.rejectNextElement();
    registry.attach(audibleRoute, track());
    await flushPlayback();
    await registry.enableAudio();

    harness.rejectNextElement();
    registry.attach({ ...audibleRoute, trackKey: 'chief:bus' }, track());
    await flushPlayback();
    expect(harness.elements[1].play).toHaveBeenCalledTimes(1);
    expect(registry.isBlocked()).toBe(true);

    registry.attach({ ...audibleRoute, trackKey: 'second-engineer:bus' }, track());
    expect(harness.elements[2].play).not.toHaveBeenCalled();
  });

  it('muteAll synchronously clears authority and keeps later tracks fail-closed', async () => {
    const { elements } = installAudioHarness();
    const registry = new RemoteAudioRegistry();
    registry.applySinkGates('driver', 'driver', snapshot);
    registry.attach(audibleRoute, track());
    await registry.enableAudio();
    registry.muteAll();
    expect(elements[0].muted).toBe(true);

    registry.attach({ ...audibleRoute, trackKey: 'late:bus' }, track());
    expect(elements[1].muted).toBe(true);
  });
});
