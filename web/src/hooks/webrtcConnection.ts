export interface ReliablePing {
  ts: number;
}

/**
 * Fast telemetry and arbitrary reliable payloads must not masquerade as a
 * keepalive. Only a JSON ping received on the reliable data channel counts.
 */
export function parseReliableDataPing(label: string, data: unknown): ReliablePing | null {
  if (label !== 'data' || typeof data !== 'string') return null;

  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const message = value as { type?: unknown; ts?: unknown };
    const keys = Object.keys(message);
    if (keys.length !== 2 || !keys.includes('type') || !keys.includes('ts')) return null;
    if (message.type !== 'ping' || typeof message.ts !== 'number' || !Number.isFinite(message.ts)) return null;
    return { ts: message.ts };
  } catch {
    return null;
  }
}

export type ReconnectKind = 'signaling-rebind' | 'full-rebuild';

export interface IntercomTransportAuthority {
  generation: number;
  joined: boolean;
  intercomVersion?: number;
}

export interface SignalingCleanupOwner {
  socket: unknown;
  intercomGeneration: number;
}

export function shouldRunSignalingCleanup(
  currentSocket: unknown,
  currentIntercomGeneration: number,
  owner?: SignalingCleanupOwner,
): boolean {
  return !owner
    || (owner.socket === currentSocket && owner.intercomGeneration === currentIntercomGeneration);
}

export function shouldInvalidateIntercomCleanup(
  current: IntercomTransportAuthority,
  expectedGeneration?: number,
): boolean {
  return current.joined
    && (expectedGeneration === undefined || current.generation === expectedGeneration);
}

export function shouldInvalidateIntercomTransport(
  previous: IntercomTransportAuthority,
  next: IntercomTransportAuthority,
  supportedVersion: number,
): boolean {
  return previous.joined && (
    !next.joined
    || next.generation !== previous.generation
    || next.intercomVersion !== supportedVersion
  );
}

const MAX_FULL_ROOM_RECOVERY_ATTEMPTS = 3;

export function reconnectKindForSignalingClose(
  peerConnectionState: RTCPeerConnectionState | undefined,
): ReconnectKind {
  return peerConnectionState === 'connected' ? 'signaling-rebind' : 'full-rebuild';
}

export function shouldRetrySignalingError(
  message: string,
  hadConnected: boolean,
  reconnectAttempts: number,
): boolean {
  if (!hadConnected) return false;
  const normalized = message.toLowerCase();
  if (normalized.includes('password')) return false;
  if (normalized.includes('full')) {
    // A fresh membership can briefly race cleanup of this client's old slot.
    // Bound retries so a genuinely full room still reaches the manual screen.
    return reconnectAttempts < MAX_FULL_ROOM_RECOVERY_ATTEMPTS;
  }
  return true;
}
