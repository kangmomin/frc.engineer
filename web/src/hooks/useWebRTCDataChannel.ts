import { decode } from '@msgpack/msgpack';
import { useEffect, useCallback, useRef, useState } from 'react';
import type { ConnectionState, FeaturePermissions, PitwallState, WSRequest, WSResponse } from '../types/telemetry';
import { NO_FEATURE_PERMISSIONS, useTelemetryStore } from '../store/telemetryStore';
import { routeMessage } from './useMessageRouter';

interface UseWebRTCOptions {
  signalingUrl: string;
  roomId?: string;
  roomCode?: string;
  password: string;
}

interface UseWebRTCReturn {
  disconnect: () => void;
  forceReconnect: () => void;
  sendView: (view: string) => void;
  request: <T = unknown>(request: WSRequest, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>;
  stream: (request: WSRequest, options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    doneType: string;
    onMessage: (response: WSResponse) => void;
  }) => Promise<void>;
  connectionState: RTCPeerConnectionState | 'new';
  lastError: string;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const SIGNALING_RESPONSE_TIMEOUT_MS = 6_000;
const OFFER_TIMEOUT_MS = 8_000;
const PEER_CONNECTION_TIMEOUT_MS = 12_000;
// 'disconnected' watchdog: sender의 ICE restart 1사이클(감지 5s + offer 왕복 +
// ICE 재연결 ≈ 11s)을 온전히 기다린 뒤에야 full reconnect로 넘어간다.
const DISCONNECTED_RECOVERY_TIMEOUT_MS = 18_000;
const DATA_REQUEST_TIMEOUT_MS = 30_000;

// Auto-reconnect: 한 번이라도 연결에 성공한 세션은 무한 재시도(백오프 cap 30s
// + ±30% jitter). 초기 연결(성공 이력 없음)만 5회로 제한해 오타/죽은 방에서
// 빠르게 수동 화면으로 보낸다.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
// 시그널링 상시 유지: ~110s 프록시 idle cap 대비 3배 마진 (sender와 동일 값)
const HEARTBEAT_INTERVAL_MS = 30_000;
// sender keepalive ping(5s) 3회 손실 시 죽은 P2P로 판정
const KEEPALIVE_TIMEOUT_MS = 15_000;
const KEEPALIVE_CHECK_INTERVAL_MS = 5_000;
const PENDING_CANDIDATE_LIMIT = 32;

type PendingRequest =
  | {
    kind: 'single';
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof window.setTimeout> | null;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    abortHandler?: () => void;
    debugCount: number;
  }
  | {
    kind: 'stream';
    doneType: string;
    onMessage: (response: WSResponse) => void;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof window.setTimeout> | null;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    abortHandler?: () => void;
    debugCount: number;
  };

type P2PDebugLevel = 'info' | 'warn' | 'error';

interface P2PDebugEntry {
  ts: string;
  level: P2PDebugLevel;
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

const P2P_DEBUG_RING_LIMIT = 200;

function describeDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length };
  }
  if (typeof value === 'string') {
    return { kind: 'string', length: value.length, preview: value.slice(0, 120) };
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.frames)) {
    return { kind: 'frames', count: candidate.frames.length };
  }
  if (typeof candidate.count === 'number') {
    return { kind: 'count', count: candidate.count };
  }
  if (typeof candidate.frameCount === 'number') {
    return { kind: 'frameCount', frameCount: candidate.frameCount };
  }

  return { kind: 'object', keys: Object.keys(candidate).slice(0, 8) };
}

function appendP2PDebug(entry: P2PDebugEntry): void {
  const method = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.info;
  method(`[p2p][${entry.scope}] ${entry.message}`, entry.details ?? {});

  const target = window as Window & { __frcP2PDebugLog?: P2PDebugEntry[] };
  const next = target.__frcP2PDebugLog ? [...target.__frcP2PDebugLog, entry] : [entry];
  target.__frcP2PDebugLog = next.slice(-P2P_DEBUG_RING_LIMIT);
}

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toError(message: string): Error {
  return new Error(message);
}

function decodeResponseEnvelope(raw: string | ArrayBuffer): WSResponse | null {
  try {
    if (raw instanceof ArrayBuffer) {
      try {
        return decode(new Uint8Array(raw)) as WSResponse;
      } catch {
        const text = new TextDecoder().decode(new Uint8Array(raw));
        return JSON.parse(text) as WSResponse;
      }
    }
    return JSON.parse(raw) as WSResponse;
  } catch {
    return null;
  }
}

function normalizeIceServer(server: RTCIceServer): RTCIceServer | null {
  const urls = Array.isArray(server.urls)
    ? server.urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : typeof server.urls === 'string' && server.urls.trim().length > 0
      ? server.urls
      : null;

  if (!urls || (Array.isArray(urls) && urls.length === 0)) {
    return null;
  }

  const normalized: RTCIceServer = { urls };
  if (typeof server.username === 'string' && server.username.trim().length > 0) {
    normalized.username = server.username;
  }
  if (typeof server.credential === 'string' && server.credential.length > 0) {
    normalized.credential = server.credential;
  }
  return normalized;
}

function getConfiguredIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('ice server config must be an array');
    }

    const servers = parsed
      .map((entry) => normalizeIceServer(entry as RTCIceServer))
      .filter((entry): entry is RTCIceServer => entry !== null);

    if (servers.length === 0) {
      throw new Error('no valid ice servers');
    }

    return servers;
  } catch (error) {
    console.warn('Invalid VITE_WEBRTC_ICE_SERVERS config, falling back to default STUN servers.', error);
    return DEFAULT_ICE_SERVERS;
  }
}

const CONFIGURED_ICE_SERVERS = getConfiguredIceServers();

export function useWebRTCDataChannel(options: UseWebRTCOptions | null): UseWebRTCReturn {
  const setConnectionState = useTelemetryStore((s) => s.setConnectionState);
  const setFeaturePermissions = useTelemetryStore((s) => s.setFeaturePermissions);
  const setPitwallState = useTelemetryStore((s) => s.setPitwallState);
  const updatePositions = useTelemetryStore((s) => s.updatePositions);
  const addRaceControlNotification = useTelemetryStore((s) => s.addRaceControlNotification);
  const setRaceResult = useTelemetryStore((s) => s.setRaceResult);

  const [rtcState, setRtcState] = useState<RTCPeerConnectionState | 'new'>('new');
  const [lastError, setLastError] = useState('');
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const isMountedRef = useRef(true);
  const stageTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const terminalFailureRef = useRef<ConnectionState | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastTargetRef = useRef('');
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  // 한 번이라도 P2P connected에 도달했는지 — 재연결 정책(무한 vs 5회)을 가른다
  const hadConnectedRef = useRef(false);
  // 서버가 발급한 engineer peerId — 시그널링 재바인딩(room_join + peerId)에 사용
  const lastPeerIdRef = useRef('');
  // 시그널링 WS가 닫혀 있는 동안 모아 두는 ICE candidate (재연결 후 flush)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  // sender keepalive ping 수신 여부 (구버전 sender에서는 워치독 비활성)
  const pingSeenRef = useRef(false);
  const lastTrafficAtRef = useRef(0);

  // Refs for routeMessage batching
  const pendingPitwallRef = useRef<PitwallState | null>(null);
  const pitwallRafRef = useRef(0);
  const pendingPositionsRef = useRef<import('../types/telemetry').CarPosition[] | null>(null);
  const positionsRafRef = useRef(0);
  const rcSeqRef = useRef(0);

  // Store actions in a ref so callbacks never go stale
  const actionsRef = useRef({ setPitwallState, updatePositions, addRaceControlNotification, setRaceResult });
  actionsRef.current = { setPitwallState, updatePositions, addRaceControlNotification, setRaceResult };

  const emitP2PDebug = useCallback((
    level: P2PDebugLevel,
    scope: string,
    message: string,
    details?: Record<string, unknown>,
    forward = true,
  ) => {
    const entry: P2PDebugEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      details,
    };
    appendP2PDebug(entry);

    if (!forward) {
      return;
    }

    const channel = dcRef.current;
    if (!channel || channel.readyState !== 'open') {
      return;
    }

    try {
      channel.send(JSON.stringify({
        type: 'clientDebugLog',
        data: {
          source: 'remote-web',
          scope,
          level,
          message,
          details,
        },
      }));
    } catch (error) {
      appendP2PDebug({
        ts: new Date().toISOString(),
        level: 'warn',
        scope: 'client-log',
        message: 'Failed to forward debug log to sender.',
        details: {
          scope,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, []);

  const clearStageTimeout = useCallback(() => {
    if (stageTimeoutRef.current) {
      clearTimeout(stageTimeoutRef.current);
      stageTimeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearPendingRequest = useCallback((requestId: string) => {
    const pending = pendingRequestsRef.current.get(requestId);
    if (!pending) {
      return;
    }
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    if (pending.abortSignal && pending.abortHandler) {
      pending.abortSignal.removeEventListener('abort', pending.abortHandler);
    }
    pendingRequestsRef.current.delete(requestId);
  }, []);

  const rejectAllPendingRequests = useCallback((message: string) => {
    if (pendingRequestsRef.current.size > 0) {
      emitP2PDebug('warn', 'pending-requests', 'Rejecting pending P2P requests.', {
        count: pendingRequestsRef.current.size,
        message,
      });
    }
    for (const [requestId, pending] of pendingRequestsRef.current.entries()) {
      clearPendingRequest(requestId);
      pending.reject(toError(message));
    }
  }, [clearPendingRequest, emitP2PDebug]);

  const refreshPendingTimeout = useCallback((requestId: string) => {
    const pending = pendingRequestsRef.current.get(requestId);
    if (!pending) {
      return;
    }
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    pending.timeoutId = window.setTimeout(() => {
      const active = pendingRequestsRef.current.get(requestId);
      if (!active) {
        return;
      }
      emitP2PDebug('error', 'request-timeout', 'Timed out waiting for a P2P response.', {
        requestId,
        kind: active.kind,
        timeoutMs: active.timeoutMs,
      });
      clearPendingRequest(requestId);
      active.reject(toError('Timed out waiting for a P2P response.'));
    }, pending.timeoutMs);
  }, [clearPendingRequest, emitP2PDebug]);

  const cleanup = useCallback(() => {
    clearStageTimeout();
    clearReconnectTimer();
    rejectAllPendingRequests('P2P connection closed.');
    // Detach handlers before close() so the resulting onclose/onstatechange
    // events do not re-trigger scheduleReconnect during an intentional teardown.
    if (dcRef.current) {
      dcRef.current.onopen = null;
      dcRef.current.onclose = null;
      dcRef.current.onmessage = null;
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.ondatachannel = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pitwallRafRef.current) {
      cancelAnimationFrame(pitwallRafRef.current);
      pitwallRafRef.current = 0;
    }
    if (positionsRafRef.current) {
      cancelAnimationFrame(positionsRafRef.current);
      positionsRafRef.current = 0;
    }
  }, [clearStageTimeout, clearReconnectTimer, rejectAllPendingRequests]);

  const failConnection = useCallback((
    state: Extract<ConnectionState, 'timeout' | 'ice-failed' | 'error'>,
    message: string,
  ) => {
    if (!isMountedRef.current) return;
    terminalFailureRef.current = state;
    clearStageTimeout();
    setLastError(message);
    setConnectionState(state);
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    setRtcState('disconnected');
    cleanup();
  }, [cleanup, clearStageTimeout, setConnectionState, setFeaturePermissions]);

  // scheduleReconnect drives bounded auto-reconnect. Each drop bumps the attempt
  // counter and schedules a backoff timer; on fire it increments reconnectNonce,
  // which re-runs the main connection effect (a clean full reconnect: ws + PC).
  // After MAX attempts it delegates to failConnection (the manual fallback screen).
  const scheduleReconnect = useCallback((message: string) => {
    if (!isMountedRef.current) return;
    if (terminalFailureRef.current) return;
    // Already a reconnect pending — don't stack timers.
    if (reconnectTimeoutRef.current) return;

    const attempt = reconnectAttemptsRef.current;
    // 초기 연결(성공 이력 없음)만 횟수 제한 — 라이브 세션 끊김은 무한 재시도.
    if (!hadConnectedRef.current && attempt >= MAX_RECONNECT_ATTEMPTS) {
      emitP2PDebug('error', 'reconnect', 'Giving up after reaching the max reconnect attempts.', {
        attempts: attempt,
        message,
      }, false);
      failConnection('error', `${message} Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`);
      return;
    }

    // 백오프 cap 30s + ±30% jitter (방당 최대 8명의 동시 복구 분산)
    const base = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 5)), RECONNECT_MAX_DELAY_MS);
    const delay = Math.round(base * (0.85 + Math.random() * 0.3));
    reconnectAttemptsRef.current = attempt + 1;

    emitP2PDebug('warn', 'reconnect', 'Scheduling automatic reconnect.', {
      attempt: attempt + 1,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      delayMs: delay,
      message,
    }, false);

    clearStageTimeout();
    setLastError('');
    setConnectionState('reconnecting');
    setRtcState('connecting');

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      if (!isMountedRef.current || terminalFailureRef.current) return;
      setReconnectNonce((n) => n + 1);
    }, delay);
  }, [emitP2PDebug, failConnection, clearStageTimeout, setConnectionState]);

  const armStageTimeout = useCallback((message: string, ms: number) => {
    clearStageTimeout();
    stageTimeoutRef.current = window.setTimeout(() => {
      scheduleReconnect(message);
    }, ms);
  }, [clearStageTimeout, scheduleReconnect]);

  const disconnect = useCallback(() => {
    terminalFailureRef.current = null;
    reconnectAttemptsRef.current = 0;
    hadConnectedRef.current = false;
    lastPeerIdRef.current = '';
    pendingCandidatesRef.current = [];
    pingSeenRef.current = false;
    clearStageTimeout();
    clearReconnectTimer();
    setLastError('');
    cleanup();
    setConnectionState('disconnected');
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    setRtcState('new');
  }, [cleanup, clearStageTimeout, clearReconnectTimer, setConnectionState, setFeaturePermissions]);

  // forceReconnect clears any terminal failure and bumps the nonce so the main
  // effect re-runs even when the connection target is unchanged (e.g. the user
  // hits Connect on the same room after auto-retries were exhausted).
  const forceReconnect = useCallback(() => {
    terminalFailureRef.current = null;
    reconnectAttemptsRef.current = 0;
    setReconnectNonce((n) => n + 1);
  }, []);

  const sendView = useCallback((view: string) => {
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'setView', view }));
    }
  }, []);

  const request = useCallback(<T = unknown>(
    nextRequest: WSRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> => {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== 'open') {
      return Promise.reject(toError('P2P data channel is not connected.'));
    }
    if (options?.signal?.aborted) {
      return Promise.reject(toError('P2P request aborted.'));
    }

    const requestId = nextRequest.requestId || makeRequestId();
    const payload = JSON.stringify({ ...nextRequest, requestId });
    const timeoutMs = options?.timeoutMs ?? DATA_REQUEST_TIMEOUT_MS;

    emitP2PDebug('info', 'request', 'Sending P2P request.', {
      requestId,
      type: nextRequest.type,
      timeoutMs,
      data: describeDebugValue(nextRequest.data),
    });

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        kind: 'single',
        resolve: (data) => resolve(data as T),
        reject,
        timeoutId: null,
        timeoutMs,
        abortSignal: options?.signal,
        debugCount: 0,
      };
      if (options?.signal) {
        pending.abortHandler = () => {
          emitP2PDebug('warn', 'request', 'P2P request aborted.', {
            requestId,
            type: nextRequest.type,
          });
          clearPendingRequest(requestId);
          reject(toError('P2P request aborted.'));
        };
        options.signal.addEventListener('abort', pending.abortHandler, { once: true });
      }

      pendingRequestsRef.current.set(requestId, pending);
      refreshPendingTimeout(requestId);

      try {
        channel.send(payload);
      } catch (error) {
        emitP2PDebug('error', 'request', 'Failed to send P2P request.', {
          requestId,
          type: nextRequest.type,
          error: error instanceof Error ? error.message : String(error),
        });
        clearPendingRequest(requestId);
        reject(error instanceof Error ? error : toError('Failed to send P2P request.'));
      }
    });
  }, [clearPendingRequest, emitP2PDebug, refreshPendingTimeout]);

  const stream = useCallback((
    nextRequest: WSRequest,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      doneType: string;
      onMessage: (response: WSResponse) => void;
    },
  ): Promise<void> => {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== 'open') {
      return Promise.reject(toError('P2P data channel is not connected.'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(toError('P2P stream aborted.'));
    }

    const requestId = nextRequest.requestId || makeRequestId();
    const payload = JSON.stringify({ ...nextRequest, requestId });
    const timeoutMs = options.timeoutMs ?? DATA_REQUEST_TIMEOUT_MS;

    emitP2PDebug('info', 'stream', 'Sending P2P stream request.', {
      requestId,
      type: nextRequest.type,
      doneType: options.doneType,
      timeoutMs,
      data: describeDebugValue(nextRequest.data),
    });

    return new Promise<void>((resolve, reject) => {
      const pending: PendingRequest = {
        kind: 'stream',
        doneType: options.doneType,
        onMessage: options.onMessage,
        resolve,
        reject,
        timeoutId: null,
        timeoutMs,
        abortSignal: options.signal,
        debugCount: 0,
      };
      if (options.signal) {
        pending.abortHandler = () => {
          emitP2PDebug('warn', 'stream', 'P2P stream aborted.', {
            requestId,
            type: nextRequest.type,
            doneType: options.doneType,
          });
          clearPendingRequest(requestId);
          reject(toError('P2P stream aborted.'));
        };
        options.signal.addEventListener('abort', pending.abortHandler, { once: true });
      }

      pendingRequestsRef.current.set(requestId, pending);
      refreshPendingTimeout(requestId);

      try {
        channel.send(payload);
      } catch (error) {
        emitP2PDebug('error', 'stream', 'Failed to send P2P stream request.', {
          requestId,
          type: nextRequest.type,
          doneType: options.doneType,
          error: error instanceof Error ? error.message : String(error),
        });
        clearPendingRequest(requestId);
        reject(error instanceof Error ? error : toError('Failed to send P2P request.'));
      }
    });
  }, [clearPendingRequest, emitP2PDebug, refreshPendingTimeout]);

  // Main connection effect — runs when signalingUrl or room selection changes.
  useEffect(() => {
    if (!options) return;

    const { signalingUrl, roomId, roomCode, password } = options;
    if (!signalingUrl || (!roomId && !roomCode)) return;

    // Reset the reconnect attempt counter only when the connection target itself
    // changes (new room/url) — not on reconnect re-runs, which must keep backing off.
    const connectionTarget = `${signalingUrl}|${roomId ?? ''}|${roomCode ?? ''}`;
    if (lastTargetRef.current !== connectionTarget) {
      lastTargetRef.current = connectionTarget;
      reconnectAttemptsRef.current = 0;
      hadConnectedRef.current = false;
      lastPeerIdRef.current = '';
      pendingCandidatesRef.current = [];
      pingSeenRef.current = false;
    }

    isMountedRef.current = true;
    terminalFailureRef.current = null;

    // Clean previous connections
    cleanup();
    setLastError('');
    setRtcState('new');
    setConnectionState('connecting');
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);

    // --- 시그널링 계층 (PC 계층과 분리: ws 단절·재연결이 살아있는 P2P를 건드리지 않는다) ---
    let ws: WebSocket | null = null;
    let wsReconnectTimer: number | null = null;
    let wsReconnectDelay = RECONNECT_BASE_DELAY_MS;
    let heartbeatTimer: number | null = null;
    let disposed = false;

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const sendViaWs = (payload: Record<string, unknown>): boolean => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return true;
      }
      return false;
    };

    const flushPendingCandidates = () => {
      if (pendingCandidatesRef.current.length === 0) return;
      const queued = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      emitP2PDebug('info', 'signaling', 'Flushing queued ICE candidates.', { count: queued.length }, false);
      for (const candidate of queued) {
        if (!sendViaWs({ type: 'ice_candidate', payload: candidate })) {
          pendingCandidatesRef.current.push(candidate);
        }
      }
    };

    const scheduleWsReconnect = () => {
      if (disposed || terminalFailureRef.current) return;
      if (wsReconnectTimer) return;
      const delay = Math.round(Math.min(wsReconnectDelay, RECONNECT_MAX_DELAY_MS) * (0.85 + Math.random() * 0.3));
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
      emitP2PDebug('warn', 'signaling', 'Scheduling signaling-only reconnect.', { delayMs: delay }, false);
      wsReconnectTimer = window.setTimeout(() => {
        wsReconnectTimer = null;
        connectSignaling();
      }, delay);
    };

    const handleICECandidate = (candidatePayload: unknown) => {
      const pc = pcRef.current;
      if (!pc) return;
      const candidate = candidatePayload as RTCIceCandidateInit;
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        console.error('Failed to add ICE candidate:', err);
      });
    };

    const handleOffer = (offerPayload: unknown, isRestart: boolean) => {
      const offer = offerPayload as RTCSessionDescriptionInit;

      // sender 주도 ICE restart: 살아있는 PC에 재협상만 적용한다 (DC 유지 —
      // 화면 끊김 없이 네트워크 경로만 복구). 조건이 안 맞으면 full rebuild.
      if (isRestart && pcRef.current && dcRef.current && pcRef.current.signalingState === 'stable') {
        const pc = pcRef.current;
        emitP2PDebug('info', 'signaling', 'Received ICE restart offer, renegotiating in place.', undefined, false);
        // restart 중에는 DC 트래픽이 멈춘다 — keepalive 워치독이 진행 중인
        // in-place 복구를 full reconnect로 선점하지 않도록 타이머를 리셋한다.
        lastTrafficAtRef.current = Date.now();
        clearStageTimeout();
        setConnectionState('reconnecting');
        armStageTimeout('ICE restart did not complete in time.', PEER_CONNECTION_TIMEOUT_MS);
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer).then(() => answer))
          .then((answer) => {
            sendViaWs({ type: 'answer', payload: answer });
          })
          .catch((err) => {
            emitP2PDebug('error', 'connection', 'ICE restart renegotiation failed.', {
              error: err instanceof Error ? err.message : String(err),
            }, false);
            scheduleReconnect('ICE restart renegotiation failed.');
          });
        return;
      }

      emitP2PDebug('info', 'signaling', 'Received WebRTC offer from sender.', undefined, false);
      clearStageTimeout();
      setConnectionState('negotiating');
      armStageTimeout('Timed out while establishing the peer connection.', PEER_CONNECTION_TIMEOUT_MS);

      // Close previous PeerConnection if it exists
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current = null;
      }

      const pc = new RTCPeerConnection({
        iceServers: CONFIGURED_ICE_SERVERS,
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        if (terminalFailureRef.current) return;
        const state = pc.connectionState;

        if (state === 'connected') {
          hadConnectedRef.current = true;
          lastTrafficAtRef.current = Date.now();
          setRtcState('connected');
          clearStageTimeout();
          clearReconnectTimer();
          // A clean connected state resets the backoff counter by design: each fresh
          // drop earns a full retry budget (rapid connect/drop ping-pong is rare).
          reconnectAttemptsRef.current = 0;
          setConnectionState('connected');
          setLastError('');
        } else if (state === 'failed' || state === 'closed') {
          // Leave rtcState to scheduleReconnect (it sets 'connecting') so Layout's
          // `rtcConnectionState === 'failed'` gate isn't tripped mid-retry.
          setFeaturePermissions(NO_FEATURE_PERMISSIONS);
          scheduleReconnect('Peer connection lost.');
        } else if (state === 'disconnected') {
          // Transient — sender가 ICE restart로 자가 복구할 시간을 준다 (감지 5s +
          // restart 협상 + ICE 재연결 ≈ 11s → 18s 워치독). 복구 실패 시 full reconnect.
          setRtcState('disconnected');
          setConnectionState('reconnecting');
          setFeaturePermissions(NO_FEATURE_PERMISSIONS);
          armStageTimeout('Peer connection stalled in disconnected state.', DISCONNECTED_RECOVERY_TIMEOUT_MS);
        } else {
          setRtcState(state);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        if (terminalFailureRef.current) return;
        if (pc.iceConnectionState === 'failed') {
          // 실패 원인 진단용 candidate-pair 통계 1회 기록 (방화벽/NAT 의심 판별)
          pc.getStats().then((stats) => {
            let pairCount = 0;
            let succeededPairs = 0;
            const candidateTypes: string[] = [];
            stats.forEach((report) => {
              if (report.type === 'candidate-pair') {
                pairCount += 1;
                if ((report as { state?: string }).state === 'succeeded') succeededPairs += 1;
              }
              if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                const t = (report as { candidateType?: string }).candidateType;
                if (t && !candidateTypes.includes(`${report.type}:${t}`)) {
                  candidateTypes.push(`${report.type}:${t}`);
                }
              }
            });
            emitP2PDebug('error', 'ice-stats', 'ICE failure candidate statistics.', {
              pairCount,
              succeededPairs,
              candidateTypes,
            }, false);
          }).catch(() => { /* stats 미지원 환경 무시 */ });
          scheduleReconnect('ICE negotiation failed. A TURN relay may be required for this network path.');
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidate = event.candidate.toJSON();
        if (sendViaWs({ type: 'ice_candidate', payload: candidate })) return;
        // 시그널링이 잠시 끊겨 있으면 큐에 모아 재연결 후 flush한다.
        if (pendingCandidatesRef.current.length >= PENDING_CANDIDATE_LIMIT) {
          pendingCandidatesRef.current.shift();
        }
        pendingCandidatesRef.current.push(candidate);
      };

      pc.ondatachannel = (event) => {
        const dc = event.channel;

        dc.binaryType = 'arraybuffer';
        dc.onmessage = (e) => {
          if (!isMountedRef.current) return;
          lastTrafficAtRef.current = Date.now();

          // sender keepalive ping → 즉시 pong 응답 (requestId가 없는 제어 메시지)
          if (typeof e.data === 'string' && e.data.length < 100 && e.data.includes('"ping"')) {
            try {
              const ctrl = JSON.parse(e.data) as { type?: string; ts?: number };
              if (ctrl?.type === 'ping') {
                pingSeenRef.current = true;
                if (dc.readyState === 'open') {
                  dc.send(JSON.stringify({ type: 'pong', ts: ctrl.ts ?? 0 }));
                }
                return;
              }
            } catch {
              // JSON이 아니면 일반 메시지로 계속 처리
            }
          }

          const response = pendingRequestsRef.current.size > 0
            ? decodeResponseEnvelope(e.data as ArrayBuffer | string)
            : null;
          if (response?.requestId) {
            const pending = pendingRequestsRef.current.get(response.requestId);
            if (pending) {
              pending.debugCount += 1;
              if (response.error) {
                emitP2PDebug('error', 'response', 'Received P2P error response.', {
                  requestId: response.requestId,
                  type: response.type,
                  kind: pending.kind,
                  error: response.error,
                });
                clearPendingRequest(response.requestId);
                pending.reject(toError(response.error));
                return;
              }
              if (pending.kind === 'single') {
                emitP2PDebug('info', 'response', 'Received P2P response.', {
                  requestId: response.requestId,
                  type: response.type,
                  data: describeDebugValue(response.data),
                });
                clearPendingRequest(response.requestId);
                pending.resolve(response.data);
                return;
              }
              if (pending.debugCount <= 3 || response.type === pending.doneType || pending.debugCount % 25 === 0) {
                emitP2PDebug('info', 'stream', 'Received P2P stream message.', {
                  requestId: response.requestId,
                  type: response.type,
                  doneType: pending.doneType,
                  index: pending.debugCount,
                  data: describeDebugValue(response.data),
                }, response.type === pending.doneType);
              }
              try {
                pending.onMessage(response);
              } catch (error) {
                emitP2PDebug('error', 'stream', 'Failed to process P2P stream message.', {
                  requestId: response.requestId,
                  type: response.type,
                  error: error instanceof Error ? error.message : String(error),
                });
                clearPendingRequest(response.requestId);
                pending.reject(error instanceof Error ? error : toError('Failed to process P2P stream message.'));
                return;
              }
              if (response.type === pending.doneType) {
                clearPendingRequest(response.requestId);
                pending.resolve();
              } else {
                refreshPendingTimeout(response.requestId);
              }
              return;
            }
          }
          const actions = actionsRef.current;
          routeMessage(
            e.data as ArrayBuffer | string,
            actions,
            {
              pendingPitwall: pendingPitwallRef,
              pitwallRaf: pitwallRafRef,
              pendingPositions: pendingPositionsRef,
              positionsRaf: positionsRafRef,
              rcSeq: rcSeqRef,
            },
          );
        };

        // Only the reliable "data" channel governs connection state
        if (dc.label === 'data') {
          dcRef.current = dc;
          emitP2PDebug('info', 'connection', 'P2P data channel opened.', { label: dc.label });
          dc.onclose = () => {
            if (!isMountedRef.current) return;
            if (terminalFailureRef.current) return;
            emitP2PDebug('warn', 'connection', 'P2P data channel closed.', {
              label: dc.label,
              pendingRequests: pendingRequestsRef.current.size,
            }, false);
            setFeaturePermissions(NO_FEATURE_PERMISSIONS);
            scheduleReconnect('Data channel closed.');
          };
        }
      };

      pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => pc.createAnswer())
        .then((answer) => {
          return pc.setLocalDescription(answer).then(() => answer);
        })
        .then((answer) => {
          sendViaWs({ type: 'answer', payload: answer });
        })
        .catch((err) => {
          console.error('WebRTC offer/answer failed:', err);
          emitP2PDebug('error', 'connection', 'WebRTC offer/answer negotiation failed.', {
            error: err instanceof Error ? err.message : String(err),
          }, false);
          scheduleReconnect('WebRTC offer/answer negotiation failed.');
        });
    };

    function connectSignaling() {
      if (disposed || terminalFailureRef.current || !isMountedRef.current) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

      // PC가 살아있거나(connected) 자가 복구 대기 중(disconnected 워치독,
      // restart 협상)이면 조용한 시그널링 재바인딩 — 6s ack 타임아웃이 단일
      // stage-timeout 슬롯을 통해 18s 워치독을 덮어쓰지 않도록 PC가 아예
      // 없거나 종단 상태일 때만 무장한다.
      const pcState = pcRef.current?.connectionState;
      const initialHandshake = !pcRef.current || pcState === 'new' || pcState === 'failed' || pcState === 'closed';
      if (initialHandshake) {
        armStageTimeout('Timed out waiting for the signaling server to acknowledge the room join.', SIGNALING_RESPONSE_TIMEOUT_MS);
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(signalingUrl);
      } catch {
        if (initialHandshake) {
          failConnection('error', 'Failed to open the signaling connection.');
        } else {
          scheduleWsReconnect();
        }
        return;
      }
      ws = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isMountedRef.current || disposed) {
          socket.close();
          return;
        }
        emitP2PDebug('info', 'signaling', 'Joining sender room.', {
          roomId: roomId ?? null,
          roomCode: roomCode ?? null,
          peerId: lastPeerIdRef.current || null,
        }, false);
        socket.send(JSON.stringify({
          type: 'room_join',
          roomId,
          roomCode,
          password,
          // 재바인딩: 기존 peerId를 보내면 서버가 살아있는 P2P 세션에 WS만 다시 묶는다.
          ...(lastPeerIdRef.current ? { peerId: lastPeerIdRef.current } : {}),
        }));
        // 프록시 idle cap(~110s) 회피용 상시 heartbeat — 시그널링을 세션 내내 유지해
        // sender 주도 ICE restart 경로를 항상 열어 둔다.
        stopHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          sendViaWs({ type: 'heartbeat' });
        }, HEARTBEAT_INTERVAL_MS);
      };

      socket.onclose = () => {
        if (!isMountedRef.current || disposed) return;
        stopHeartbeat();
        if (terminalFailureRef.current) return;
        emitP2PDebug('warn', 'signaling', 'Signaling connection closed.', undefined, false);
        if (pcRef.current?.connectionState === 'connected') {
          // P2P는 독립적으로 유지 — 시그널링만 백그라운드에서 복구한다.
          scheduleWsReconnect();
          return;
        }
        scheduleReconnect('Signaling connection closed before the peer link was established.');
      };

      socket.onerror = () => {
        if (!isMountedRef.current || disposed) return;
        if (terminalFailureRef.current) return;
        emitP2PDebug('error', 'signaling', 'Signaling server connection failed.', undefined, false);
        // The reconnect decision is made in socket.onclose, which fires right after onerror.
      };

      socket.onmessage = (event) => {
        if (!isMountedRef.current || disposed) return;

        let msg: { type: string; payload?: unknown; error?: string; permissions?: FeaturePermissions; peerId?: string; restart?: boolean };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room_joined': {
            wsReconnectDelay = RECONNECT_BASE_DELAY_MS;
            const rebound = lastPeerIdRef.current !== '' && msg.peerId === lastPeerIdRef.current;
            if (typeof msg.peerId === 'string' && msg.peerId) {
              lastPeerIdRef.current = msg.peerId;
            }
            setFeaturePermissions(msg.permissions ?? NO_FEATURE_PERMISSIONS);
            flushPendingCandidates();
            if (rebound && pcRef.current?.connectionState === 'connected') {
              emitP2PDebug('info', 'signaling', 'Signaling rebound to live peer session.', {
                peerId: msg.peerId,
              }, false);
              break;
            }
            emitP2PDebug('info', 'signaling', 'Joined sender room.', {
              roomId: roomId ?? null,
              roomCode: roomCode ?? null,
            }, false);
            clearStageTimeout();
            setConnectionState('waiting-offer');
            armStageTimeout('Timed out waiting for the sender to publish a WebRTC offer.', OFFER_TIMEOUT_MS);
            break;
          }
          case 'offer':
            handleOffer(msg.payload, msg.restart === true);
            break;
          case 'ice_candidate':
            handleICECandidate(msg.payload);
            break;
          case 'heartbeat':
            // 서버의 heartbeat echo — 무시
            break;
          case 'room_closed':
            emitP2PDebug('error', 'signaling', 'Sender room was closed.', undefined, false);
            if (hadConnectedRef.current) {
              // sender가 잠시 이탈해 방이 만료된 경우 — sender 재접속 시 같은
              // roomID로 방을 재생성하므로(room_create 폴백) 재시도 가치가 있다.
              lastPeerIdRef.current = '';
              scheduleReconnect('The sender room was closed.');
            } else {
              failConnection('error', 'The sender room was closed.');
            }
            break;
          case 'error': {
            const errMsg = msg.error ?? 'Unknown signaling error.';
            emitP2PDebug('error', 'signaling', 'Received signaling error.', { error: errMsg }, false);
            const lowered = errMsg.toLowerCase();
            const retryable = hadConnectedRef.current
              && !lowered.includes('password')
              && !lowered.includes('full');
            if (retryable) {
              lastPeerIdRef.current = '';
              if (pcRef.current?.connectionState === 'connected') {
                // P2P는 살아있고 join만 거절됨(예: 서버 재시작 직후 방 미생성) —
                // 시그널링만 백오프 재시도하고 화면은 유지한다.
                scheduleWsReconnect();
              } else {
                scheduleReconnect(errMsg);
              }
            } else {
              console.error('Signaling error:', errMsg);
              failConnection('error', errMsg);
            }
            break;
          }
        }
      };
    }

    // 죽은 P2P 조기 감지: sender ping(5s)이 15초간 끊기면 재연결.
    // 구버전 sender(ping 미전송)에서는 pingSeen이 false라 비활성.
    const keepaliveWatchdog = window.setInterval(() => {
      if (!pingSeenRef.current) return;
      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') return;
      const silentFor = Date.now() - lastTrafficAtRef.current;
      if (silentFor > KEEPALIVE_TIMEOUT_MS) {
        pingSeenRef.current = false;
        emitP2PDebug('warn', 'connection', 'No keepalive traffic from sender, reconnecting.', {
          silentForMs: silentFor,
        }, false);
        scheduleReconnect('No keepalive traffic from the sender.');
      }
    }, KEEPALIVE_CHECK_INTERVAL_MS);

    // 백그라운드 탭/절전 복귀 시 대기 중인 재연결을 즉시 발화
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        if (!terminalFailureRef.current) {
          setReconnectNonce((n) => n + 1);
        }
      } else if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
        connectSignaling();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    connectSignaling();

    return () => {
      disposed = true;
      isMountedRef.current = false;
      stopHeartbeat();
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
      clearInterval(keepaliveWatchdog);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cleanup();
    };
    // Re-run when connection params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.signalingUrl, options?.roomId, options?.roomCode, options?.password, reconnectNonce]);

  return { disconnect, forceReconnect, sendView, request, stream, connectionState: rtcState, lastError };
}
