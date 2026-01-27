import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TelemetryData,
  ConnectionState,
  defaultTelemetryData,
  LapDataResponse,
  WSResponse,
  PitwallState,
} from '../types/telemetry';

interface UseTelemetryOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseTelemetryReturn {
  data: TelemetryData;
  connectionState: ConnectionState;
  reconnect: () => void;
  lastUpdate: number;
  lapData: LapDataResponse | null;
  requestLapData: () => void;
  pitwallState: PitwallState | null;
}

function getDefaultWsUrl(): string {
  const isSecure = window.location.protocol === 'https:';
  const wsProtocol = isSecure ? 'wss:' : 'ws:';

  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:8080/ws`;
  }

  return `${wsProtocol}//${window.location.host}/ws`;
}

// Generate a unique request ID
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function useTelemetry(options: UseTelemetryOptions = {}): UseTelemetryReturn {
  const {
    url = getDefaultWsUrl(),
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const [data, setData] = useState<TelemetryData>(defaultTelemetryData);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [lapData, setLapData] = useState<LapDataResponse | null>(null);
  const [pitwallState, setPitwallState] = useState<PitwallState | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const pendingRequestsRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  // Send a request to the server
  const sendRequest = useCallback((type: string): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = generateRequestId();
      const request = { type, requestId };

      // Store the resolver to be called when response arrives
      pendingRequestsRef.current.set(requestId, resolve);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 10000);

      wsRef.current.send(JSON.stringify(request));
    });
  }, []);

  // Request lap data (best lap + current lap)
  const requestLapData = useCallback(() => {
    sendRequest('getBestLap')
      .then((response) => {
        const wsResponse = response as WSResponse;
        if (wsResponse.data) {
          setLapData(wsResponse.data as LapDataResponse);
        }
      })
      .catch((err) => {
        console.error('Failed to get lap data:', err);
      });
  }, [sendRequest]);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clean up existing connection without triggering reconnect
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (!shouldReconnectRef.current) {
          ws.close();
          return;
        }
        setConnectionState('connected');
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Check if this is a response to a request
          if (message.requestId && pendingRequestsRef.current.has(message.requestId)) {
            const resolver = pendingRequestsRef.current.get(message.requestId);
            pendingRequestsRef.current.delete(message.requestId);
            resolver?.(message);
            return;
          }

          // Check if this is a lap data response (direct, not request-based)
          if (message.type === 'lapData' && message.data) {
            setLapData(message.data as LapDataResponse);
            return;
          }

          // Check if this is a pitwall state broadcast
          if (message.type === 'pitwallState' && message.data) {
            setPitwallState(message.data as PitwallState);
            return;
          }

          // Otherwise, it's a regular telemetry update
          const telemetry: TelemetryData = message;
          setData(telemetry);
          setLastUpdate(Date.now());
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      ws.onerror = () => {
        setConnectionState('error');
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        wsRef.current = null;

        // Only attempt to reconnect if not unmounted
        if (
          shouldReconnectRef.current &&
          reconnectAttempts.current < maxReconnectAttempts
        ) {
          reconnectAttempts.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to create WebSocket connection:', err);
      setConnectionState('error');
    }
  }, [url, reconnectInterval, maxReconnectAttempts]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    reconnectAttempts.current = 0;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    connect();
  }, [connect]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    data,
    connectionState,
    reconnect,
    lastUpdate,
    lapData,
    requestLapData,
    pitwallState,
  };
}
