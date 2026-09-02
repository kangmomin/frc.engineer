export const INTERCOM_VERSION = 1;
export const MAX_INTERCOM_ENVELOPE_BYTES = 96 * 1024;
export const MAX_INTERCOM_SDP_BYTES = 64 * 1024;

export type IntercomRole = 'driver' | 'engineer' | 'chief';
export type IntercomTrackClass =
  | 'driver_engineer'
  | 'driver_chief'
  | 'engineer_bus'
  | 'driver_radio'
  | 'chief_private';
export type IntercomPrivatePhase = 'preparing' | 'active';

export interface IntercomSessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IntercomPrivateSession {
  phase: IntercomPrivatePhase;
  driverKey: string;
}

export interface IntercomParticipant {
  id: string;
  role: IntercomRole;
  displayName: string;
  driverKey?: string;
  assignmentDriverKey?: string;
  online: boolean;
  speaking: boolean;
  ptt: boolean;
  busEnabled: boolean;
  forcedMuted: boolean;
  talkingTo: string[];
}

export interface IntercomSnapshot {
  revision: number;
  topologyRevision: number;
  groupCode: string;
  participants: IntercomParticipant[];
  privateSession?: IntercomPrivateSession;
}

export interface IntercomJoinedPayload {
  membershipGeneration: number;
  participantId: string;
  resumeToken: string;
  groupCode: string;
  chiefCode?: string;
  snapshot: IntercomSnapshot;
  sfuEnabled: boolean;
}

export interface IntercomErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export interface IntercomPublishedTrack {
  mid: string;
  trackKey: string;
  class: IntercomTrackClass;
}

export interface IntercomSubscribedTrack extends IntercomPublishedTrack {
  participantId: string;
  targetDriverKey?: string;
}

export interface IntercomEnvelope<T = unknown> {
  type: string;
  requestId?: string;
  payload: T;
}

export type ServerIntercomEnvelope =
  | IntercomEnvelope<IntercomJoinedPayload>
  | IntercomEnvelope<Record<string, never>>
  | IntercomEnvelope<IntercomSnapshot>
  | IntercomEnvelope<IntercomErrorPayload>
  | IntercomEnvelope<{ sessionHandle: string }>
  | IntercomEnvelope<{
    sessionDescription?: IntercomSessionDescription;
    requiresImmediateRenegotiation: boolean;
    tracks: IntercomPublishedTrack[];
  }>
  | IntercomEnvelope<{
    sessionDescription?: IntercomSessionDescription;
    requiresImmediateRenegotiation: boolean;
    tracks: IntercomSubscribedTrack[];
    removedTrackKeys: string[];
  }>;

export const CLIENT_INTERCOM_TYPES = new Set([
  'intercom_group_create',
  'intercom_join',
  'intercom_leave',
  'intercom_activity',
  'intercom_private_set',
  'intercom_private_ready',
  'intercom_sfu_session_new',
  'intercom_sfu_publish',
  'intercom_sfu_subscribe',
  'intercom_sfu_renegotiate',
  'intercom_sfu_close',
]);

export const SERVER_INTERCOM_TYPES = new Set([
  'intercom_joined',
  'intercom_left',
  'intercom_state',
  'intercom_error',
  'intercom_sfu_session',
  'intercom_sfu_published',
  'intercom_sfu_subscribed',
  'intercom_sfu_renegotiated',
  'intercom_sfu_closed',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown, max = 1_024): value is string {
  return typeof value === 'string' && value.length <= max;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isUTF8String(value: unknown, max: number): value is string {
  return typeof value === 'string' && utf8ByteLength(value) <= max;
}

function isSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRole(value: unknown): value is IntercomRole {
  return value === 'driver' || value === 'engineer' || value === 'chief';
}

function isTrackClass(value: unknown): value is IntercomTrackClass {
  return value === 'driver_engineer'
    || value === 'driver_chief'
    || value === 'engineer_bus'
    || value === 'driver_radio'
    || value === 'chief_private';
}

function isSessionDescription(value: unknown): value is IntercomSessionDescription {
  if (!isObject(value)) return false;
  return (value.type === 'offer' || value.type === 'answer')
    && isUTF8String(value.sdp, MAX_INTERCOM_SDP_BYTES);
}

export function isIntercomParticipant(value: unknown): value is IntercomParticipant {
  if (!isObject(value) || !isString(value.id, 128) || !isRole(value.role) || !isUTF8String(value.displayName, 40)) {
    return false;
  }
  return (value.driverKey === undefined || isString(value.driverKey, 256))
    && (value.assignmentDriverKey === undefined || isString(value.assignmentDriverKey, 256))
    && typeof value.online === 'boolean'
    && typeof value.speaking === 'boolean'
    && typeof value.ptt === 'boolean'
    && typeof value.busEnabled === 'boolean'
    && typeof value.forcedMuted === 'boolean'
    && Array.isArray(value.talkingTo)
    && value.talkingTo.length <= 11
    && value.talkingTo.every((item) => isString(item, 128));
}

export function parseIntercomSnapshot(value: unknown): IntercomSnapshot | null {
  if (!isObject(value)
    || !isSafeRevision(value.revision)
    || !isSafeRevision(value.topologyRevision)
    || !isString(value.groupCode, 16)
    || !Array.isArray(value.participants)
    || value.participants.length > 11
    || !value.participants.every(isIntercomParticipant)) {
    return null;
  }
  if (value.privateSession !== undefined) {
    if (!isObject(value.privateSession)
      || (value.privateSession.phase !== 'preparing' && value.privateSession.phase !== 'active')
      || !isString(value.privateSession.driverKey, 256)) {
      return null;
    }
  }
  return value as unknown as IntercomSnapshot;
}

function isPublishedTrack(value: unknown): value is IntercomPublishedTrack {
  return isObject(value)
    && isString(value.mid, 32)
    && isString(value.trackKey, 256)
    && isTrackClass(value.class);
}

function isSubscribedTrack(value: unknown): value is IntercomSubscribedTrack {
  const record = value as Record<string, unknown>;
  return isPublishedTrack(value)
    && isString(record.participantId, 128)
    && (record.targetDriverKey === undefined || isString(record.targetDriverKey, 256));
}

function validatePayload(type: string, payload: unknown): boolean {
  if (!isObject(payload)) return false;
  switch (type) {
    case 'intercom_joined':
      return isSafeRevision(payload.membershipGeneration)
        && isString(payload.participantId, 128)
        && isString(payload.resumeToken, 256)
        && isString(payload.groupCode, 16)
        && (payload.chiefCode === undefined || isString(payload.chiefCode, 32))
        && parseIntercomSnapshot(payload.snapshot) !== null
        && typeof payload.sfuEnabled === 'boolean';
    case 'intercom_left':
    case 'intercom_sfu_renegotiated':
    case 'intercom_sfu_closed':
      return Object.keys(payload).length === 0;
    case 'intercom_state':
      return parseIntercomSnapshot(payload) !== null;
    case 'intercom_error':
      return isString(payload.code, 128) && isString(payload.message, 1_024) && typeof payload.retryable === 'boolean';
    case 'intercom_sfu_session':
      return isString(payload.sessionHandle, 256);
    case 'intercom_sfu_published':
      return (payload.sessionDescription === undefined || isSessionDescription(payload.sessionDescription))
        && typeof payload.requiresImmediateRenegotiation === 'boolean'
        && Array.isArray(payload.tracks)
        && payload.tracks.length <= 4
        && payload.tracks.every(isPublishedTrack);
    case 'intercom_sfu_subscribed':
      return (payload.sessionDescription === undefined || isSessionDescription(payload.sessionDescription))
        && typeof payload.requiresImmediateRenegotiation === 'boolean'
        && Array.isArray(payload.tracks)
        && payload.tracks.length <= 64
        && payload.tracks.every(isSubscribedTrack)
        && Array.isArray(payload.removedTrackKeys)
        && payload.removedTrackKeys.length <= 64
        && payload.removedTrackKeys.every((item) => isString(item, 256));
    default:
      return false;
  }
}

export function parseServerIntercomEnvelope(value: unknown): ServerIntercomEnvelope | null {
  if (!isObject(value) || !isString(value.type, 64) || !SERVER_INTERCOM_TYPES.has(value.type)) return null;
  if (value.requestId !== undefined && (!isUTF8String(value.requestId, 128) || value.requestId.length === 0)) return null;
  if (!validatePayload(value.type, value.payload)) return null;
  return value as unknown as ServerIntercomEnvelope;
}

export function malformedIntercomAuthorityError(): ServerIntercomEnvelope {
  return {
    type: 'intercom_error',
    payload: {
      code: 'malformed_authority',
      message: 'Malformed intercom authority message.',
      retryable: true,
    },
  };
}

export function isClientIntercomEnvelope(value: unknown): value is IntercomEnvelope {
  if (!isObject(value) || !isString(value.type, 64) || !CLIENT_INTERCOM_TYPES.has(value.type) || !isObject(value.payload)) {
    return false;
  }
  const fireAndForget = value.type === 'intercom_activity' || value.type === 'intercom_private_ready';
  const requestValid = fireAndForget
    ? value.requestId === undefined
    : isUTF8String(value.requestId, 128) && value.requestId.length > 0;
  return requestValid && validateClientPayload(value.type, value.payload);
}

export function jsonEnvelopeBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateClientPayload(type: string, payload: Record<string, unknown>): boolean {
  switch (type) {
    case 'intercom_group_create':
      return isUTF8String(payload.displayName, 40) && payload.displayName.length > 0
        && isUTF8String(payload.password, 128) && payload.password.length > 0;
    case 'intercom_join':
      return isString(payload.groupCode, 16) && payload.groupCode.length > 0
        && isUTF8String(payload.password, 128) && payload.password.length > 0
        && (payload.chiefCode === undefined || isString(payload.chiefCode, 32))
        && (payload.resumeToken === undefined || isString(payload.resumeToken, 256))
        && isRole(payload.role)
        && isUTF8String(payload.displayName, 40) && payload.displayName.length > 0;
    case 'intercom_leave':
    case 'intercom_sfu_session_new':
      return Object.keys(payload).length === 0;
    case 'intercom_activity':
      return typeof payload.speaking === 'boolean'
        && typeof payload.ptt === 'boolean'
        && typeof payload.busEnabled === 'boolean';
    case 'intercom_private_set':
      return isString(payload.driverKey, 256) && payload.driverKey.length > 0 && typeof payload.active === 'boolean';
    case 'intercom_private_ready':
      return isSafeRevision(payload.revision);
    case 'intercom_sfu_publish':
      return isString(payload.sessionHandle, 256) && payload.sessionHandle.length > 0
        && isSessionDescription(payload.sessionDescription)
        && Array.isArray(payload.tracks)
        && payload.tracks.length <= 4
        && payload.tracks.every((track) => {
          if (!isObject(track) || !isString(track.mid, 32) || !isTrackClass(track.class)) return false;
          return track.targetDriverKey === undefined || isString(track.targetDriverKey, 256);
        });
    case 'intercom_sfu_subscribe':
    case 'intercom_sfu_close':
      return isString(payload.sessionHandle, 256) && payload.sessionHandle.length > 0;
    case 'intercom_sfu_renegotiate':
      return isString(payload.sessionHandle, 256) && payload.sessionHandle.length > 0
        && isSessionDescription(payload.sessionDescription);
    default:
      return false;
  }
}
