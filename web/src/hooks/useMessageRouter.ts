import { decode } from '@msgpack/msgpack';
import type {
  PitwallState,
  CarPosition,
  RaceControlNotification,
  BattleAlert,
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
  addBattleAlert: (a: BattleAlert) => void;
  setRaceResult: (r: RaceSummary) => void;
}

export interface MessageRouterRefs {
  pendingPitwall: { current: PitwallState | null };
  pitwallRaf: { current: number };
  pendingPositions: { current: CarPosition[] | null };
  positionsRaf: { current: number };
  rcSeq: { current: number };
  battleSeq: { current: number };
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

      case 'battleAlert':
        actions.addBattleAlert(normalizeBattleAlert(
          message.data as Partial<BattleAlert> | undefined,
          refs.battleSeq.current++,
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

export function normalizeBattleAlert(
  raw: Partial<BattleAlert> | undefined,
  seq: number,
): BattleAlert {
  const timestamp = typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now();
  const id = raw?.id || `ba-${timestamp}-${seq}`;
  return {
    id,
    timestamp,
    driverAhead: raw?.driverAhead ?? 'Unknown',
    driverBehind: raw?.driverBehind ?? 'Unknown',
    gapSeconds: raw?.gapSeconds ?? 0,
    closingRatePerLap: raw?.closingRatePerLap ?? 0,
    estOvertakeLap: raw?.estOvertakeLap ?? 0,
    side: raw?.side === 'behind' ? 'behind' : 'ahead',
  };
}
