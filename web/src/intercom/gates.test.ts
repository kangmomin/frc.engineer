import { describe, expect, it } from 'vitest';
import {
  canReceiveParticipantAudio,
  computeSourceGates,
  isPrivateReadyRequired,
  isSnapshotNewer,
  shouldMuteRemoteRoute,
  type IntercomSnapshot,
} from './core';

const snapshot: IntercomSnapshot = {
  revision: 8,
  topologyRevision: 3,
  groupCode: '482915',
  privateSession: { phase: 'preparing', driverKey: 'driver-a' },
  participants: [
    { id: 'd', role: 'driver', displayName: 'D', driverKey: 'driver-a', online: true, speaking: false, ptt: false, busEnabled: true, forcedMuted: false, talkingTo: [] },
    { id: 'e', role: 'engineer', displayName: 'E', assignmentDriverKey: 'driver-a', online: true, speaking: false, ptt: false, busEnabled: true, forcedMuted: true, talkingTo: [] },
    { id: 'c', role: 'chief', displayName: 'C', online: true, speaking: false, ptt: false, busEnabled: false, forcedMuted: false, talkingTo: [] },
  ],
};

const open = { authorityFresh: true, mediaReady: true, locallyMuted: false, busEnabled: true, ptt: true };

describe('fail-closed intercom gates', () => {
  it('closes every engineer source while chief private is preparing', () => {
    expect(computeSourceGates('engineer', 'e', snapshot, open)).toEqual({ engineer_bus: false, driver_radio: false });
  });

  it('keeps driver-to-chief open but closes the engineer route', () => {
    expect(computeSourceGates('driver', 'd', snapshot, open)).toEqual({ driver_engineer: false, driver_chief: true });
  });

  it('enables only the active chief target', () => {
    const active = { ...snapshot, revision: 9, privateSession: { phase: 'active' as const, driverKey: 'driver-a' } };
    expect(computeSourceGates('chief', 'c', active, open, ['driver-a', 'driver-b'])).toEqual({
      engineer_bus: false,
      'chief_private:driver-a': true,
      'chief_private:driver-b': false,
    });
  });

  it('requires preparing ACKs only from the private barrier members', () => {
    expect(isPrivateReadyRequired('driver', 'd', snapshot)).toBe(true);
    expect(isPrivateReadyRequired('engineer', 'e', snapshot)).toBe(true);
    expect(isPrivateReadyRequired('chief', 'c', snapshot)).toBe(true);
    expect(shouldMuteRemoteRoute('driver', 'd', snapshot, { trackKey: 'r', participantId: 'e', class: 'driver_radio' })).toBe(true);
  });

  it('accepts revisions monotonically', () => {
    expect(isSnapshotNewer(snapshot, { ...snapshot, revision: 9 })).toBe(true);
    expect(isSnapshotNewer(snapshot, { ...snapshot, revision: 8 })).toBe(false);
  });

  it('exposes volume only for participants whose audio can be subscribed', () => {
    expect(canReceiveParticipantAudio('driver', 'd', snapshot, 'e')).toBe(true);
    expect(canReceiveParticipantAudio('driver', 'd', snapshot, 'c')).toBe(true);
    expect(canReceiveParticipantAudio('driver', 'd', snapshot, 'd')).toBe(false);
    expect(canReceiveParticipantAudio('engineer', 'e', snapshot, 'd')).toBe(true);
    expect(canReceiveParticipantAudio('chief', 'c', snapshot, 'e')).toBe(true);
  });
});
