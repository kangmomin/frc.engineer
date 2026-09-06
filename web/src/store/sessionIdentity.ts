import type { SessionInfo } from '../types/telemetry';

export function sessionIdentity(session: SessionInfo | null | undefined, uid = session?.sessionUid): string {
  if (uid) return `${uid}|${session?.sessionType ?? ''}`;
  // Older senders and archives did not transmit the authoritative UID.
  return `${session?.trackId ?? ''}|${session?.sessionType ?? ''}|${session?.totalLaps ?? ''}`;
}
