import { useEffect, useCallback, useRef } from 'react';
import type {
  PitwallState,
  RaceControlNotification,
  BattleAlert,
} from '../types/telemetry';
import { useTelemetryStore } from '../store/telemetryStore';

interface WebSocketMessage {
  type: string;
  data?: unknown;
}

interface UsePitwallWebSocketOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UsePitwallWebSocketReturn {
  reconnect: () => void;
  clearNotifications: () => void;
}

function getDefaultUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

const DEFAULT_OPTIONS: Required<UsePitwallWebSocketOptions> = {
  url: getDefaultUrl(),
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
};

export function usePitwallWebSocket(
  options: UsePitwallWebSocketOptions = {}
): UsePitwallWebSocketReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Pull setters from Zustand store
  const {
    setConnectionState,
    setPitwallState,
    addRaceControlNotification,
    addBattleAlert,
    clearNotifications,
  } = useTelemetryStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isManualReconnectRef = useRef(false);
  const pendingPitwallRef = useRef<PitwallState | null>(null);
  const pitwallRafRef = useRef(0);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Don't connect if unmounted or already connecting/open
    if (!isMountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    clearReconnectTimeout();
    setConnectionState('connecting');

    try {
      const ws = new WebSocket(opts.url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close();
          return;
        }
        setConnectionState('connected');
        reconnectAttempts.current = 0;
        isManualReconnectRef.current = false;
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;

        setConnectionState('disconnected');
        wsRef.current = null;

        // Don't auto-reconnect if this was triggered by manual reconnect
        if (isManualReconnectRef.current) {
          isManualReconnectRef.current = false;
          return;
        }

        // Auto reconnect with exponential backoff
        if (reconnectAttempts.current < opts.maxReconnectAttempts && isMountedRef.current) {
          const delay = opts.reconnectInterval * Math.pow(2, reconnectAttempts.current);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        if (!isMountedRef.current) return;
        setConnectionState('error');
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        // Skip messages we don't handle (e.g. telemetry at 30Hz) to avoid costly JSON.parse
        const raw = event.data as string;
        if (raw.startsWith('{"type":"telemetry"')) return;

        try {
          const message = JSON.parse(raw) as WebSocketMessage;

          switch (message.type) {
            case 'pitwallState':
              // Batch with rAF so React renders at most once per frame
              pendingPitwallRef.current = message.data as PitwallState;
              if (!pitwallRafRef.current) {
                pitwallRafRef.current = requestAnimationFrame(() => {
                  pitwallRafRef.current = 0;
                  if (pendingPitwallRef.current) {
                    setPitwallState(pendingPitwallRef.current);
                    pendingPitwallRef.current = null;
                  }
                });
              }
              break;

            case 'raceControl':
              addRaceControlNotification(message.data as RaceControlNotification);
              break;

            case 'battleAlert':
              addBattleAlert(message.data as BattleAlert);
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };
    } catch {
      if (isMountedRef.current) {
        setConnectionState('error');
      }
    }
  }, [opts.url, opts.reconnectInterval, opts.maxReconnectAttempts, clearReconnectTimeout, setConnectionState, setPitwallState, addRaceControlNotification, addBattleAlert]);

  const reconnect = useCallback(() => {
    clearReconnectTimeout();
    isManualReconnectRef.current = true;
    reconnectAttempts.current = 0;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Schedule connect after a brief delay to allow close to complete
    setTimeout(() => {
      if (isMountedRef.current) {
        connect();
      }
    }, 100);
  }, [connect, clearReconnectTimeout]);

  // Connect on mount
  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      clearReconnectTimeout();
      if (pitwallRafRef.current) cancelAnimationFrame(pitwallRafRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimeout]);

  return {
    reconnect,
    clearNotifications,
  };
}

