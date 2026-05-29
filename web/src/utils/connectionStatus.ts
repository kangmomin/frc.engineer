import type { ConnectionState } from '../types/telemetry';

export function isConnectionPending(state: ConnectionState): boolean {
  return state === 'connecting' || state === 'waiting-offer' || state === 'negotiating' || state === 'reconnecting';
}

export function isConnectionFailure(state: ConnectionState): boolean {
  return state === 'timeout' || state === 'ice-failed' || state === 'error';
}

export function getConnectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting signaling';
    case 'waiting-offer':
      return 'Waiting for sender offer';
    case 'negotiating':
      return 'Negotiating telemetry link';
    case 'reconnecting':
      return 'Reconnecting';
    case 'connected':
      return 'Live feed connected';
    case 'timeout':
      return 'Connection timed out';
    case 'ice-failed':
      return 'ICE negotiation failed';
    case 'error':
      return 'Telemetry error';
    default:
      return 'Feed offline';
  }
}

export function getConnectionDetail(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'Joining the signaling room.';
    case 'waiting-offer':
      return 'Room joined. Waiting for the sender to publish a WebRTC offer.';
    case 'negotiating':
      return 'Offer received. Exchanging ICE candidates and opening the telemetry data channel.';
    case 'reconnecting':
      return 'Connection dropped. Attempting to reconnect automatically...';
    case 'connected':
      return 'Telemetry is streaming normally.';
    case 'timeout':
      return 'The sender or peer link did not respond in time. Retry the room, then verify sender connectivity.';
    case 'ice-failed':
      return 'Peer candidate checks failed. TURN relay support is usually required for this network path.';
    case 'error':
      return 'The signaling or peer connection returned an error.';
    default:
      return 'Telemetry feed will populate this view automatically.';
  }
}

export function getConnectionBadgeLabel(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'SIGNAL';
    case 'waiting-offer':
      return 'WAIT OFFER';
    case 'negotiating':
      return 'NEGOTIATING';
    case 'reconnecting':
      return 'RECONNECTING';
    case 'connected':
      return 'LIVE';
    case 'timeout':
      return 'TIMEOUT';
    case 'ice-failed':
      return 'ICE FAIL';
    case 'error':
      return 'ERROR';
    default:
      return 'OFFLINE';
  }
}
