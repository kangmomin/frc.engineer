import { decode } from '@msgpack/msgpack';
import type {
  PitwallState,
  CarPosition,
  RaceControlNotification,
  RaceSummary,
} from '../types/telemetry';
import { useTelemetryStore } from '../store/telemetryStore';

interface WebSocketMessage {
  type: string;
  data?: unknown;
}

/**
 * Shared message routing actions extracted from usePitwallWebSocket.
 * Both WebSocket (local) and WebRTC DataChannel (remote) modes use this.
 */
export interface MessageRouterActions {
  setPitwallState: (state: PitwallState | null) => void;
  updatePositions: (positions: CarPosition[]) => void;
  addRaceControlNotification: (n: RaceControlNotification) => void;
  setRaceResult: (r: RaceSummary) => void;
}

export interface MessageRouterRefs {
  pendingPitwall: { current: PitwallState | null };
  pitwallRaf: { current: number };
  pendingPositions: { current: CarPosition[] | null };
  positionsRaf: { current: number };
  rcSeq: { current: number };
}

/**
 * Routes a raw JSON message string to the appropriate store action.
 * Returns true if the message was handled.
 */
export function routeMessage(
  raw: string | ArrayBuffer,
  actions: MessageRouterActions,
  refs: MessageRouterRefs,
): boolean {
  // Skip if playback is active
  if (useTelemetryStore.getState().playbackActive) return false;

  try {
    let message: WebSocketMessage;
    if (raw instanceof ArrayBuffer) {
      message = decode(new Uint8Array(raw)) as WebSocketMessage;
    } else {
      // Fallback for text messages (e.g. signaling)
      if (raw.startsWith('{"type":"telemetry"')) return false;
      message = JSON.parse(raw) as WebSocketMessage;
    }

    switch (message.type) {
      case 'positionUpdate':
        // Batch 60Hz position updates with rAF — only latest frame rendered
        refs.pendingPositions.current = message.data as CarPosition[];
        if (!refs.positionsRaf.current) {
          refs.positionsRaf.current = requestAnimationFrame(() => {
            refs.positionsRaf.current = 0;
            // rAF 대기 중 재생이 시작됐으면 pending 프레임 폐기 (리플레이 오염 방지)
            if (useTelemetryStore.getState().playbackActive) {
              refs.pendingPositions.current = null;
              return;
            }
            if (refs.pendingPositions.current) {
              actions.updatePositions(refs.pendingPositions.current);
              refs.pendingPositions.current = null;
            }
          });
        }
        return true;

      case 'pitwallState':
        // Batch with rAF so React renders at most once per frame
        refs.pendingPitwall.current = message.data as PitwallState;
        if (!refs.pitwallRaf.current) {
          refs.pitwallRaf.current = requestAnimationFrame(() => {
            refs.pitwallRaf.current = 0;
            // rAF 대기 중 재생이 시작됐으면 pending 프레임 폐기 (리플레이 오염 방지)
            if (useTelemetryStore.getState().playbackActive) {
              refs.pendingPitwall.current = null;
              return;
            }
            if (refs.pendingPitwall.current) {
              actions.setPitwallState(refs.pendingPitwall.current);
              refs.pendingPitwall.current = null;
            }
          });
        }
        return true;

      case 'raceControl':
        actions.addRaceControlNotification(normalizeRaceControl(
          message.data as Partial<RaceControlNotification> | undefined,
          refs.rcSeq.current++,
        ));
        return true;

      case 'raceResult':
        actions.setRaceResult(message.data as RaceSummary);
        return true;
    }
  } catch {
    // Ignore parse errors
  }
  return false;
}

export function normalizeRaceControl(
  raw: Partial<RaceControlNotification> | undefined,
  seq: number,
): RaceControlNotification {
  const timestamp = typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now();
  const id = raw?.id || `rc-${timestamp}-${seq}`;
  return {
    id,
    timestamp,
    category: raw?.category ?? 'info',
    message: raw?.message ?? '',
    severity: raw?.severity ?? 'info',
    driverName: raw?.driverName,
  };
}
