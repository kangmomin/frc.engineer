import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  PitwallState,
  ConnectionState,
  RaceControlNotification,
  BattleAlert,
} from '../types/telemetry';

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
  pitwallState: PitwallState | null;
  connectionState: ConnectionState;
  raceControlNotifications: RaceControlNotification[];
  battleAlerts: BattleAlert[];
  reconnect: () => void;
  clearNotifications: () => void;
}

function getDefaultUrl(): string {
  if (import.meta.env.DEV) {
    return 'ws://localhost:8080/ws';
  }
  // Use wss:// for HTTPS to avoid mixed-content issues
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

const DEFAULT_OPTIONS: Required<UsePitwallWebSocketOptions> = {
  url: getDefaultUrl(),
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
};

const MAX_NOTIFICATIONS = 50;
const MAX_BATTLE_ALERTS = 10;

export function usePitwallWebSocket(
  options: UsePitwallWebSocketOptions = {}
): UsePitwallWebSocketReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [pitwallState, setPitwallState] = useState<PitwallState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [raceControlNotifications, setRaceControlNotifications] = useState<RaceControlNotification[]>([]);
  const [battleAlerts, setBattleAlerts] = useState<BattleAlert[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isManualReconnectRef = useRef(false);

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

        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          switch (message.type) {
            case 'pitwallState':
              setPitwallState(message.data as PitwallState);
              break;

            case 'raceControl':
              setRaceControlNotifications((prev) => {
                const notification = message.data as RaceControlNotification;
                const updated = [notification, ...prev];
                return updated.slice(0, MAX_NOTIFICATIONS);
              });
              break;

            case 'battleAlert':
              setBattleAlerts((prev) => {
                const alert = message.data as BattleAlert;
                const updated = [alert, ...prev];
                return updated.slice(0, MAX_BATTLE_ALERTS);
              });
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
  }, [opts.url, opts.reconnectInterval, opts.maxReconnectAttempts, clearReconnectTimeout]);

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

  const clearNotifications = useCallback(() => {
    setRaceControlNotifications([]);
    setBattleAlerts([]);
  }, []);

  // Connect on mount
  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimeout]);

  return {
    pitwallState,
    connectionState,
    raceControlNotifications,
    battleAlerts,
    reconnect,
    clearNotifications,
  };
}
