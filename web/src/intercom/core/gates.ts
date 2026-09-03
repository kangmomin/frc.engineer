import type { IntercomParticipant, IntercomRole, IntercomSnapshot, IntercomTrackClass } from './protocol';

export interface LocalIntercomControls {
  authorityFresh: boolean;
  mediaReady: boolean;
  locallyMuted: boolean;
  busEnabled: boolean;
  ptt: boolean;
}

export type SourceGates = Record<string, boolean>;

function selfParticipant(snapshot: IntercomSnapshot, participantId: string): IntercomParticipant | undefined {
  return snapshot.participants.find((participant) => participant.id === participantId);
}

export function publicationKey(trackClass: IntercomTrackClass, targetDriverKey?: string): string {
  return targetDriverKey ? `${trackClass}:${targetDriverKey}` : trackClass;
}

export function computeSourceGates(
  role: IntercomRole,
  participantId: string,
  snapshot: IntercomSnapshot | null,
  controls: LocalIntercomControls,
  chiefTargets: string[] = [],
): SourceGates {
  const closed: SourceGates = {};
  if (!snapshot || !controls.authorityFresh || !controls.mediaReady || controls.locallyMuted) return closed;
  const self = selfParticipant(snapshot, participantId);
  if (!self || !self.online) return closed;
  const privateSession = snapshot.privateSession;
  const privateTarget = privateSession?.driverKey;

  if (role === 'driver') {
    const selected = Boolean(privateTarget && self.driverKey === privateTarget);
    return {
      driver_engineer: !selected,
      driver_chief: true,
    };
  }
  if (role === 'engineer') {
    const blocked = self.forcedMuted || Boolean(privateTarget && self.assignmentDriverKey === privateTarget);
    return {
      engineer_bus: controls.busEnabled && !blocked,
      driver_radio: controls.ptt && !blocked,
    };
  }

  const gates: SourceGates = {
    engineer_bus: controls.busEnabled && !privateSession,
  };
  for (const driverKey of chiefTargets) {
    gates[publicationKey('chief_private', driverKey)] = privateSession?.phase === 'active' && privateTarget === driverKey;
  }
  return gates;
}

export function isPrivateReadyRequired(role: IntercomRole, participantId: string, snapshot: IntercomSnapshot): boolean {
  if (snapshot.privateSession?.phase !== 'preparing') return false;
  if (role === 'chief') return true;
  const self = selfParticipant(snapshot, participantId);
  if (!self) return false;
  return role === 'driver'
    ? self.driverKey === snapshot.privateSession.driverKey
    : self.assignmentDriverKey === snapshot.privateSession.driverKey;
}

export interface RemoteTrackRoute {
  trackKey: string;
  participantId: string;
  class: IntercomTrackClass;
  targetDriverKey?: string;
}

/** Whether the server topology can expose any remote audio track from `remoteId` to this member. */
export function canReceiveParticipantAudio(
  localRole: IntercomRole,
  localParticipantId: string,
  snapshot: IntercomSnapshot | null,
  remoteId: string,
): boolean {
  if (!snapshot || localParticipantId === remoteId) return false;
  const self = selfParticipant(snapshot, localParticipantId);
  const remote = selfParticipant(snapshot, remoteId);
  if (!self?.online || !remote?.online) return false;
  if (localRole === 'driver') {
    return remote.role === 'chief'
      || (remote.role === 'engineer' && remote.assignmentDriverKey === self.driverKey);
  }
  if (localRole === 'engineer') {
    return remote.role === 'chief'
      || remote.role === 'engineer'
      || (remote.role === 'driver' && remote.driverKey === self.assignmentDriverKey);
  }
  return remote.role === 'engineer' || remote.role === 'driver';
}

export function shouldMuteRemoteRoute(
  localRole: IntercomRole,
  localParticipantId: string,
  snapshot: IntercomSnapshot | null,
  route: RemoteTrackRoute,
): boolean {
  if (!snapshot) return true;
  const privateSession = snapshot.privateSession;
  if (!privateSession) return false;
  const self = selfParticipant(snapshot, localParticipantId);
  if (localRole === 'driver' && self?.driverKey === privateSession.driverKey) {
    return route.class === 'driver_radio';
  }
  if (localRole === 'engineer' && self?.assignmentDriverKey === privateSession.driverKey) {
    const source = snapshot.participants.find((participant) => participant.id === route.participantId);
    return source?.driverKey === privateSession.driverKey;
  }
  if (localRole === 'chief') return route.class === 'engineer_bus';
  return false;
}

export function isSnapshotNewer(current: IntercomSnapshot | null, next: IntercomSnapshot): boolean {
  return current === null || next.revision > current.revision;
}
