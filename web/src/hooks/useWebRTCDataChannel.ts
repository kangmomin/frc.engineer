import { decode } from '@msgpack/msgpack';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import type { ConnectionState, PitwallState, WSRequest, WSResponse } from '../types/telemetry';
import { useTelemetryStore } from '../store/telemetryStore';
import { routeMessage } from './useMessageRouter';
import { enqueueBoundedCandidate, parseSignalingNegotiationId, takeCandidatesForGeneration, type CandidateGeneration, type QueuedCandidate } from './webrtcCandidates';
import {
  parseReliableDataPing,
  reconnectKindForSignalingClose,
  shouldInvalidateIntercomCleanup,
  shouldInvalidateIntercomTransport,
  shouldRunSignalingCleanup,
  shouldRetrySignalingError,
  type SignalingCleanupOwner,
} from './webrtcConnection';
import {
  getTurnRefreshDelayMs,
  isLegacyTurnUnsupportedError,
  isRuntimeIceCurrent,
  isRuntimeIceLifetimeAllowed,
  parseTurnCredentialsPayload,
  selectIceServers,
  type IceServerSource,
  type RuntimeIceConfiguration,
} from './webrtcTurn';
import {
  INTERCOM_VERSION,
  MAX_INTERCOM_ENVELOPE_BYTES,
  isClientIntercomEnvelope,
  jsonEnvelopeBytes,
  malformedIntercomAuthorityError,
  parseServerIntercomEnvelope,
  SERVER_INTERCOM_TYPES,
  type IntercomEnvelope,
  type IntercomSignalingAdapter,
  type ServerIntercomEnvelope,
} from '../intercom/core';

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
  intercom: IntercomSignalingAdapter;
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
// ICE가 순간 'disconnected'로 깜빡일 때(Wi-Fi 로밍/jitter) 화면을 즉시 reconnecting으로
// 바꾸면 권한 게이팅 패널이 사라졌다 나타난다. grace 안에 복구되면 UI를 건드리지 않는다.
const DISCONNECTED_UI_GRACE_MS = 2_500;
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
const TURN_INITIAL_OFFER_GATE_MS = 3_500;
const TURN_RETRY_COOLDOWN_MS = 30_000;

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
    cancelRemote?: () => void;
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

interface PendingLocalSignalingCandidate {
  candidate: RTCIceCandidateInit;
  negotiationId: number;
}

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

function getConfiguredIceServers(): { iceServers: RTCIceServer[]; source: Extract<IceServerSource, 'static' | 'default'> } {
  const raw = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
  if (!raw) return { iceServers: DEFAULT_ICE_SERVERS, source: 'default' };

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

    return { iceServers: servers, source: 'static' };
  } catch (error) {
    console.warn('Invalid VITE_WEBRTC_ICE_SERVERS config, falling back to default STUN servers.', error);
    return { iceServers: DEFAULT_ICE_SERVERS, source: 'default' };
  }
}

const configuredIceServers = getConfiguredIceServers();
const CONFIGURED_ICE_SERVERS = configuredIceServers.iceServers;
const CONFIGURED_ICE_SOURCE = configuredIceServers.source;

export function useWebRTCDataChannel(options: UseWebRTCOptions | null): UseWebRTCReturn {
  const setConnectionState = useTelemetryStore((s) => s.setConnectionState);
  const setPitwallState = useTelemetryStore((s) => s.setPitwallState);
  const updatePositions = useTelemetryStore((s) => s.updatePositions);
  const addRaceControlNotification = useTelemetryStore((s) => s.addRaceControlNotification);
  const setRaceResult = useTelemetryStore((s) => s.setRaceResult);

  const [rtcState, setRtcState] = useState<RTCPeerConnectionState | 'new'>('new');
  const [lastError, setLastError] = useState('');
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [intercomTransportState, setIntercomTransportState] = useState<{
    generation: number;
    joined: boolean;
    intercomVersion?: number;
  }>({
    generation: 0,
    joined: false,
    intercomVersion: undefined as number | undefined,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const isMountedRef = useRef(true);
  const stageTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const disconnectGraceRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const terminalFailureRef = useRef<ConnectionState | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastTargetRef = useRef('');
  const sessionGenerationRef = useRef(0);
  const intercomGenerationRef = useRef(0);
  const intercomTransportRef = useRef(intercomTransportState);
  const intercomListenersRef = useRef(new Set<(message: ServerIntercomEnvelope) => void>());
  const intercomInvalidationListenersRef = useRef(new Set<() => void>());
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  // 한 번이라도 P2P connected에 도달했는지 — 재연결 정책(무한 vs 5회)을 가른다
  const hadConnectedRef = useRef(false);
  // 서버가 발급한 engineer peerId — 시그널링 재바인딩(room_join + peerId)에 사용
  const lastPeerIdRef = useRef('');
  // 시그널링 WS가 닫혀 있는 동안 모아 두는 ICE candidate (재연결 후 flush)
  const pendingCandidatesRef = useRef<PendingLocalSignalingCandidate[]>([]);
  // TURN credentials live in memory only and are never added to debug output.
  const runtimeIceRef = useRef<RuntimeIceConfiguration | null>(null);
  const runtimeIceReceivedAtRef = useRef(0);
  const turnRefreshTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const turnExpiryTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const offerGateTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const restartGraceTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  // sender keepalive ping 수신 여부 (구버전 sender에서는 워치독 비활성)
  const pingSeenRef = useRef(false);
  const lastReliablePingAtRef = useRef(0);
  const restartGraceRef = useRef(false);
  const restartProbeRef = useRef(false);

  // Refs for routeMessage batching
  const pendingPitwallRef = useRef<PitwallState | null>(null);
  const pitwallRafRef = useRef(0);
  const pendingPositionsRef = useRef<import('../types/telemetry').CarPosition[] | null>(null);
  const positionsRafRef = useRef(0);
  const rcSeqRef = useRef(0);

  // Store actions in a ref so callbacks never go stale
  const actionsRef = useRef({ setPitwallState, updatePositions, addRaceControlNotification, setRaceResult });
  actionsRef.current = { setPitwallState, updatePositions, addRaceControlNotification, setRaceResult };
  intercomTransportRef.current = intercomTransportState;

  const updateIntercomTransport = useCallback((next: {
    generation: number;
    joined: boolean;
    intercomVersion?: number;
  }) => {
    const previous = intercomTransportRef.current;
    intercomTransportRef.current = next;
    if (shouldInvalidateIntercomTransport(previous, next, INTERCOM_VERSION)) {
      for (const listener of intercomInvalidationListenersRef.current) listener();
    }
    setIntercomTransportState(next);
  }, []);

  const sendIntercom = useCallback((message: IntercomEnvelope): boolean => {
    const state = intercomTransportRef.current;
    const socket = wsRef.current;
    if (!state.joined
      || state.intercomVersion !== INTERCOM_VERSION
      || !socket
      || socket.readyState !== WebSocket.OPEN
      || !isClientIntercomEnvelope(message)
      || jsonEnvelopeBytes(message) > MAX_INTERCOM_ENVELOPE_BYTES) {
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      updateIntercomTransport({
        generation: intercomGenerationRef.current,
        joined: false,
      });
      return false;
    }
  }, [updateIntercomTransport]);

  const subscribeIntercom = useCallback((listener: (message: ServerIntercomEnvelope) => void) => {
    intercomListenersRef.current.add(listener);
    return () => intercomListenersRef.current.delete(listener);
  }, []);

  const subscribeIntercomInvalidation = useCallback((listener: () => void) => {
    intercomInvalidationListenersRef.current.add(listener);
    return () => intercomInvalidationListenersRef.current.delete(listener);
  }, []);

  const invalidateIntercomTransport = useCallback((expectedGeneration?: number): boolean => {
    const current = intercomTransportRef.current;
    if (!shouldInvalidateIntercomCleanup(current, expectedGeneration)) return false;
    updateIntercomTransport({
      generation: current.generation,
      joined: false,
    });
    return true;
  }, [updateIntercomTransport]);

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

  const clearWebRTCTimers = useCallback(() => {
    if (turnRefreshTimeoutRef.current) {
      clearTimeout(turnRefreshTimeoutRef.current);
      turnRefreshTimeoutRef.current = null;
    }
    if (turnExpiryTimeoutRef.current) {
      clearTimeout(turnExpiryTimeoutRef.current);
      turnExpiryTimeoutRef.current = null;
    }
    if (offerGateTimeoutRef.current) {
      clearTimeout(offerGateTimeoutRef.current);
      offerGateTimeoutRef.current = null;
    }
    if (restartGraceTimeoutRef.current) {
      clearTimeout(restartGraceTimeoutRef.current);
      restartGraceTimeoutRef.current = null;
    }
    restartGraceRef.current = false;
    restartProbeRef.current = false;
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
      if (pending.kind === 'stream') pending.cancelRemote?.();
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
      if (active.kind === 'stream') active.cancelRemote?.();
      clearPendingRequest(requestId);
      active.reject(toError('Timed out waiting for a P2P response.'));
    }, pending.timeoutMs);
  }, [clearPendingRequest, emitP2PDebug]);

  const cleanup = useCallback((owner?: SignalingCleanupOwner): boolean => {
    if (!shouldRunSignalingCleanup(
      wsRef.current,
      intercomTransportRef.current.generation,
      owner,
    )) return false;
    invalidateIntercomTransport(owner?.intercomGeneration);
    clearStageTimeout();
    clearWebRTCTimers();
    if (disconnectGraceRef.current) {
      clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = null;
    }
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
    pendingPitwallRef.current = null;
    pendingPositionsRef.current = null;
    return true;
  }, [clearStageTimeout, clearReconnectTimer, clearWebRTCTimers, invalidateIntercomTransport, rejectAllPendingRequests]);

  const failConnection = useCallback((
    state: Extract<ConnectionState, 'timeout' | 'ice-failed' | 'error'>,
    message: string,
  ) => {
    if (!isMountedRef.current) return;
    lastPeerIdRef.current = '';
    pendingCandidatesRef.current = [];
    terminalFailureRef.current = state;
    clearStageTimeout();
    setLastError(message);
    setConnectionState(state);
    setRtcState('disconnected');
    cleanup();
  }, [cleanup, clearStageTimeout, setConnectionState]);

  // scheduleReconnect drives bounded auto-reconnect. Each drop bumps the attempt
  // counter and schedules a backoff timer; on fire it increments reconnectNonce,
  // which re-runs the main connection effect (a clean full reconnect: ws + PC).
  // After MAX attempts it delegates to failConnection (the manual fallback screen).
  const scheduleReconnect = useCallback((message: string) => {
    if (!isMountedRef.current) return;
    if (terminalFailureRef.current) return;
    // Already a reconnect pending — don't stack timers.
    if (reconnectTimeoutRef.current) return;

    // A full PC rebuild must obtain a fresh signaling peer/offer. Only the
    // signaling-only reconnect path below is allowed to reuse this peer ID.
    lastPeerIdRef.current = '';
    pendingCandidatesRef.current = [];
    runtimeIceRef.current = null;
    runtimeIceReceivedAtRef.current = 0;
    clearWebRTCTimers();

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

    // Invalidate the current effect immediately, not when the delayed nonce
    // update eventually re-runs it. Late room/TURN messages from the old socket
    // must not repopulate state that was cleared for a full rebuild.
    sessionGenerationRef.current += 1;

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
  }, [emitP2PDebug, failConnection, clearStageTimeout, clearWebRTCTimers, setConnectionState]);

  const armStageTimeout = useCallback((message: string, ms: number) => {
    clearStageTimeout();
    stageTimeoutRef.current = window.setTimeout(() => {
      scheduleReconnect(message);
    }, ms);
  }, [clearStageTimeout, scheduleReconnect]);

  const disconnect = useCallback(() => {
    sessionGenerationRef.current += 1;
    terminalFailureRef.current = null;
    reconnectAttemptsRef.current = 0;
    hadConnectedRef.current = false;
    lastPeerIdRef.current = '';
    pendingCandidatesRef.current = [];
    runtimeIceRef.current = null;
    runtimeIceReceivedAtRef.current = 0;
    pingSeenRef.current = false;
    lastReliablePingAtRef.current = 0;
    clearStageTimeout();
    clearReconnectTimer();
    setLastError('');
    cleanup();
    lastTargetRef.current = '';
    useTelemetryStore.getState().resetRoom();
    setRtcState('new');
  }, [cleanup, clearStageTimeout, clearReconnectTimer]);

  // forceReconnect clears any terminal failure and bumps the nonce so the main
  // effect re-runs even when the connection target is unchanged (e.g. the user
  // hits Connect on the same room after auto-retries were exhausted).
  const forceReconnect = useCallback(() => {
    sessionGenerationRef.current += 1;
    terminalFailureRef.current = null;
    reconnectAttemptsRef.current = 0;
    lastPeerIdRef.current = '';
    pendingCandidatesRef.current = [];
    runtimeIceRef.current = null;
    runtimeIceReceivedAtRef.current = 0;
    clearWebRTCTimers();
    cleanup();
    setReconnectNonce((n) => n + 1);
  }, [cleanup, clearWebRTCTimers]);

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
        cancelRemote: () => {
          // Retain the channel generation that started this request.
          if (nextRequest.type === 'getRaceReplay' && channel.readyState === 'open') {
            try { channel.send(JSON.stringify({ type: 'cancelRaceReplay', requestId })); } catch { /* closed concurrently */ }
          }
        },
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
          pending.cancelRemote?.();
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
    if (!options) {
      invalidateIntercomTransport();
      return;
    }

    const { signalingUrl, roomId, roomCode, password } = options;
    if (!signalingUrl || (!roomId && !roomCode)) return;

    // Reset the reconnect attempt counter only when the connection target itself
    // changes (new room/url) — not on reconnect re-runs, which must keep backing off.
    const connectionTarget = `${signalingUrl}|${roomId ?? ''}|${roomCode ?? ''}`;
    if (lastTargetRef.current !== connectionTarget) {
      lastTargetRef.current = connectionTarget;
      useTelemetryStore.getState().resetRoom();
      reconnectAttemptsRef.current = 0;
      hadConnectedRef.current = false;
      lastPeerIdRef.current = '';
      pendingCandidatesRef.current = [];
      runtimeIceRef.current = null;
      runtimeIceReceivedAtRef.current = 0;
      pingSeenRef.current = false;
      lastReliablePingAtRef.current = 0;
    }

    isMountedRef.current = true;
    terminalFailureRef.current = null;
    const sessionGeneration = ++sessionGenerationRef.current;

    // Clean previous connections
    cleanup();
    setLastError('');
    setRtcState('new');
    setConnectionState('connecting');

    // --- 시그널링 계층 (PC 계층과 분리: ws 단절·재연결이 살아있는 P2P를 건드리지 않는다) ---
    let ws: WebSocket | null = null;
    let wsReconnectTimer: number | null = null;
    let wsReconnectDelay = RECONNECT_BASE_DELAY_MS;
    let heartbeatTimer: number | null = null;
    let disposed = false;
    let ownedIntercomGeneration = intercomTransportRef.current.generation;
    const isCurrentSession = () => !disposed && isMountedRef.current && sessionGenerationRef.current === sessionGeneration;

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const sendViaWs = (payload: Record<string, unknown>): boolean => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    };

    const flushPendingCandidates = () => {
      if (pendingCandidatesRef.current.length === 0) return;
      const queued = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      emitP2PDebug('info', 'signaling', 'Flushing queued ICE candidates.', { count: queued.length }, false);
      for (let index = 0; index < queued.length; index += 1) {
        const candidate = queued[index];
        if (!sendViaWs({
          type: 'ice_candidate',
          negotiationId: candidate.negotiationId,
          payload: candidate.candidate,
        })) {
          // Preserve signaling order if the socket fails partway through a flush.
          pendingCandidatesRef.current = queued.slice(index).concat(pendingCandidatesRef.current);
          return;
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

    type BufferedOffer = { payload: unknown; isRestart: boolean; generation: CandidateGeneration };
    type ActiveTurnRequest = { requestId: string; generation: number; socket: WebSocket };

    let roomJoined = false;
    let initialOfferGateActive = false;
    let pendingOffer: BufferedOffer | null = null;
    let activePcGeneration = 0;
    let activeNegotiationGeneration = 0;
    let activeSignalingNegotiation = 0;
    let remoteDescriptionReady = false;
    let remoteCandidateFlushGeneration: CandidateGeneration | null = null;
    let pendingRemoteCandidates: QueuedCandidate<RTCIceCandidateInit>[] = [];
    let localDescriptionSignaled = false;
    let pendingLocalDescriptionCandidates: QueuedCandidate<RTCIceCandidateInit>[] = [];
    let turnUnsupported = false;
    let turnRequestGeneration = 0;
    let activeTurnRequest: ActiveTurnRequest | null = null;
    let candidateQueueFailed = false;
    let activeIceSource: IceServerSource = selectIceServers(
      runtimeIceRef.current,
      CONFIGURED_ICE_SERVERS,
      CONFIGURED_ICE_SOURCE,
      Date.now(),
    ).source;
    let selectedCandidateDiagnosticGeneration = 0;
    let restartNegotiation: { generation: CandidateGeneration; answerSent: boolean } | null = null;

    const clearTurnRefreshTimers = () => {
      if (turnRefreshTimeoutRef.current) {
        clearTimeout(turnRefreshTimeoutRef.current);
        turnRefreshTimeoutRef.current = null;
      }
      if (turnExpiryTimeoutRef.current) {
        clearTimeout(turnExpiryTimeoutRef.current);
        turnExpiryTimeoutRef.current = null;
      }
    };

    const clearRestartGrace = () => {
      restartGraceRef.current = false;
      restartProbeRef.current = false;
      if (restartGraceTimeoutRef.current) {
        clearTimeout(restartGraceTimeoutRef.current);
        restartGraceTimeoutRef.current = null;
      }
    };

    const enterRestartGrace = (timeoutMs = PEER_CONNECTION_TIMEOUT_MS, probe = false) => {
      clearRestartGrace();
      restartGraceRef.current = true;
      restartProbeRef.current = probe;
      restartGraceTimeoutRef.current = window.setTimeout(() => {
        restartGraceTimeoutRef.current = null;
        if (isCurrentSession()) {
          restartGraceRef.current = false;
          restartProbeRef.current = false;
        }
      }, timeoutMs);
    };

    const completeRecoveryGrace = () => {
      if (restartNegotiation && !restartNegotiation.answerSent) return;
      if (!restartGraceRef.current || restartProbeRef.current) return;
      if (!pingSeenRef.current) {
        clearRestartGrace();
        return;
      }
      // Do not forge the last-ping timestamp. Give the restored path enough
      // time to prove itself with the next real 5s sender ping.
      enterRestartGrace(KEEPALIVE_CHECK_INTERVAL_MS * 2, true);
    };

    const resetReliableHealth = () => {
      pingSeenRef.current = false;
      lastReliablePingAtRef.current = 0;
      clearRestartGrace();
    };

    const isCurrentPeerGeneration = (pc: RTCPeerConnection, generation: CandidateGeneration) => (
      isCurrentSession()
      && pcRef.current === pc
      && activePcGeneration === generation.pc
      && activeNegotiationGeneration === generation.negotiation
      && activeSignalingNegotiation === generation.signaling
    );

    const sameCandidateGeneration = (left: CandidateGeneration | null, right: CandidateGeneration) => (
      left !== null
      && left.pc === right.pc
      && left.negotiation === right.negotiation
      && left.signaling === right.signaling
    );

    const nextOfferGeneration = (isRestart: boolean, signaling: number): CandidateGeneration => {
      const canRestartInPlace = isRestart
        && pcRef.current !== null
        && dcRef.current !== null
        && pcRef.current.signalingState === 'stable';
      return canRestartInPlace
        ? { pc: activePcGeneration, negotiation: activeNegotiationGeneration + 1, signaling }
        : { pc: activePcGeneration + 1, negotiation: activeNegotiationGeneration + 1, signaling };
    };

    const createAndSetAnswer = (pc: RTCPeerConnection, generation: CandidateGeneration): Promise<RTCSessionDescriptionInit> => {
      if (!isCurrentPeerGeneration(pc, generation)) {
        return Promise.reject(new Error('stale peer connection'));
      }
      return pc.createAnswer().then((answer) => {
        if (!isCurrentPeerGeneration(pc, generation)) throw new Error('stale peer connection');
        return pc.setLocalDescription(answer).then(() => answer);
      });
    };

    const closeCurrentPeer = () => {
      restartNegotiation = null;
      const current = pcRef.current;
      if (current) {
        current.onconnectionstatechange = null;
        current.oniceconnectionstatechange = null;
        current.onicecandidate = null;
        current.ondatachannel = null;
        current.close();
        pcRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current.onopen = null;
        dcRef.current.onclose = null;
        dcRef.current.onmessage = null;
        dcRef.current = null;
      }
      activeSignalingNegotiation = 0;
      rejectAllPendingRequests('P2P peer connection was replaced.');
    };

    const addRemoteCandidate = async (pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        if (isCurrentSession() && pcRef.current === pc) {
          emitP2PDebug('warn', 'signaling', 'Failed to apply a remote ICE candidate.', undefined, false);
        }
      }
    };

    const flushRemoteCandidates = async (pc: RTCPeerConnection, generation: CandidateGeneration): Promise<void> => {
      remoteCandidateFlushGeneration = generation;
      try {
        while (isCurrentPeerGeneration(pc, generation) && remoteDescriptionReady) {
          const drained = takeCandidatesForGeneration(pendingRemoteCandidates, generation);
          pendingRemoteCandidates = drained.remaining;
          if (drained.candidates.length === 0) return;
          for (const candidate of drained.candidates) {
            if (!isCurrentPeerGeneration(pc, generation) || !remoteDescriptionReady) return;
            await addRemoteCandidate(pc, candidate);
          }
        }
      } finally {
        if (sameCandidateGeneration(remoteCandidateFlushGeneration, generation)) {
          remoteCandidateFlushGeneration = null;
        }
      }
    };

    const beginLocalCandidateQueue = (generation: CandidateGeneration) => {
      localDescriptionSignaled = false;
      pendingLocalDescriptionCandidates = pendingLocalDescriptionCandidates.filter((entry) => (
        sameCandidateGeneration(entry.generation, generation)
      ));
    };

    const flushLocalDescriptionCandidates = (pc: RTCPeerConnection, generation: CandidateGeneration) => {
      if (!isCurrentPeerGeneration(pc, generation)) return;
      localDescriptionSignaled = true;
      const drained = takeCandidatesForGeneration(pendingLocalDescriptionCandidates, generation);
      pendingLocalDescriptionCandidates = drained.remaining;
      for (const candidate of drained.candidates) {
        if (!isCurrentPeerGeneration(pc, generation)) return;
        if (!sendViaWs({ type: 'ice_candidate', negotiationId: generation.signaling, payload: candidate })) {
          if (pendingCandidatesRef.current.length >= PENDING_CANDIDATE_LIMIT) {
            candidateQueueFailed = true;
            scheduleReconnect('Too many local ICE candidates were queued.');
            return;
          }
          pendingCandidatesRef.current.push({ candidate, negotiationId: generation.signaling });
        }
      }
    };

    const applyStaticIceFallback = (reason: string) => {
      const currentRuntime = runtimeIceRef.current;
      if (isRuntimeIceCurrent(currentRuntime, Date.now())) {
        activeIceSource = 'cloudflare';
        emitP2PDebug('warn', 'turn', 'Keeping the current runtime ICE configuration until it expires.', {
          source: 'cloudflare',
          expiresAt: currentRuntime.expiresAt,
          reason,
        }, false);
        armTurnRetry();
        return;
      }

      runtimeIceRef.current = null;
      runtimeIceReceivedAtRef.current = 0;
      clearTurnRefreshTimers();
      const fallback = selectIceServers(null, CONFIGURED_ICE_SERVERS, CONFIGURED_ICE_SOURCE, Date.now());
      activeIceSource = fallback.source;
      const pc = pcRef.current;
      if (pc && pc.connectionState !== 'closed') {
        try {
          pc.setConfiguration({ iceServers: fallback.iceServers });
        } catch {
          // This is diagnostic-only: ICE URL and credential values must not be logged.
        }
      }
      emitP2PDebug('warn', 'turn', 'Using configured ICE fallback.', { source: fallback.source, reason }, false);
      armTurnRetry();
    };

    const scheduleTurnLifecycle = (configuration: RuntimeIceConfiguration, receivedAtMs: number) => {
      clearTurnRefreshTimers();
      const refreshDelayMs = getTurnRefreshDelayMs(configuration, receivedAtMs, Date.now());
      const expiryDelayMs = Math.max(0, configuration.expiresAtMs - Date.now());

      turnRefreshTimeoutRef.current = window.setTimeout(() => {
        turnRefreshTimeoutRef.current = null;
        if (!isCurrentSession() || runtimeIceRef.current !== configuration) return;
        requestTurnCredentials();
      }, refreshDelayMs);
      turnExpiryTimeoutRef.current = window.setTimeout(() => {
        turnExpiryTimeoutRef.current = null;
        if (!isCurrentSession() || runtimeIceRef.current !== configuration) return;
        if (configuration.expiresAtMs > Date.now()) {
          scheduleTurnLifecycle(configuration, receivedAtMs);
          return;
        }
        runtimeIceRef.current = null;
        runtimeIceReceivedAtRef.current = 0;
        applyStaticIceFallback('expired');
      }, expiryDelayMs);
    };

    const applyRuntimeIceConfiguration = (configuration: RuntimeIceConfiguration) => {
      if (!isCurrentSession()) return;
      const pc = pcRef.current;
      if (pc && pc.connectionState !== 'closed') {
        try {
          pc.setConfiguration({ iceServers: configuration.iceServers });
        } catch {
          emitP2PDebug('warn', 'turn', 'Runtime ICE configuration could not be applied.', {
            source: 'cloudflare',
            expiresAt: configuration.expiresAt,
          }, false);
          applyStaticIceFallback('configuration_failed');
          return;
        }
      }
      const receivedAtMs = Date.now();
      runtimeIceRef.current = configuration;
      runtimeIceReceivedAtRef.current = receivedAtMs;
      activeIceSource = 'cloudflare';
      scheduleTurnLifecycle(configuration, receivedAtMs);
      emitP2PDebug('info', 'turn', 'Applied runtime ICE configuration.', {
        source: 'cloudflare',
        expiresAt: configuration.expiresAt,
      }, false);
    };

    function releaseInitialOfferGate() {
      if (!initialOfferGateActive) return;
      initialOfferGateActive = false;
      if (offerGateTimeoutRef.current) {
        clearTimeout(offerGateTimeoutRef.current);
        offerGateTimeoutRef.current = null;
      }
      const offer = pendingOffer;
      pendingOffer = null;
      if (offer && isCurrentSession()) {
        handleOffer(offer.payload, offer.isRestart, offer.generation.signaling, offer.generation);
      }
    }

    function requestTurnCredentials(): boolean {
      if (!roomJoined || turnUnsupported || !isCurrentSession() || !ws || ws.readyState !== WebSocket.OPEN) return false;
      if (activeTurnRequest?.socket === ws) return true;

      const requestId = makeRequestId();
      const generation = ++turnRequestGeneration;
      activeTurnRequest = { requestId, generation, socket: ws };
      try {
        ws.send(JSON.stringify({ type: 'turn_credentials_request', requestId }));
        armTurnRetry(activeTurnRequest);
        return true;
      } catch {
        activeTurnRequest = null;
        armTurnRetry();
        try {
          ws.close();
        } catch {
          // The cooldown retry remains armed if the broken socket cannot close.
        }
        return false;
      }
    }

    function armTurnRetry(timedRequest: ActiveTurnRequest | null = null) {
      if (turnUnsupported || !isCurrentSession()) return;
      if (turnRefreshTimeoutRef.current) {
        clearTimeout(turnRefreshTimeoutRef.current);
      }
      turnRefreshTimeoutRef.current = window.setTimeout(() => {
        turnRefreshTimeoutRef.current = null;
        if (!isCurrentSession() || turnUnsupported) return;
        if (timedRequest) {
          if (activeTurnRequest !== timedRequest) return;
          activeTurnRequest = null;
        }
        requestTurnCredentials();
      }, TURN_RETRY_COOLDOWN_MS);
    }

    function handleTurnCredentials(payload: unknown, requestId: unknown, socket: WebSocket) {
      const active = activeTurnRequest;
      if (!isCurrentSession()
        || !active
        || active.socket !== socket
        || active.generation !== turnRequestGeneration
        || typeof requestId !== 'string'
        || requestId !== active.requestId) {
        return;
      }
      activeTurnRequest = null;
      if (turnRefreshTimeoutRef.current) {
        clearTimeout(turnRefreshTimeoutRef.current);
        turnRefreshTimeoutRef.current = null;
      }

      const parsed = parseTurnCredentialsPayload(payload);
      if (!parsed) {
        emitP2PDebug('warn', 'turn', 'Ignored malformed runtime ICE response.', undefined, false);
        applyStaticIceFallback('malformed_response');
        releaseInitialOfferGate();
        return;
      }
      if (parsed.source === 'fallback') {
        if (parsed.reason === 'disabled') {
          turnUnsupported = true;
        }
        applyStaticIceFallback(parsed.reason);
        releaseInitialOfferGate();
        return;
      }
      const receivedAtMs = Date.now();
      if (!isRuntimeIceLifetimeAllowed(parsed, receivedAtMs)) {
        emitP2PDebug('warn', 'turn', 'Ignored runtime ICE response with an invalid lifetime.', {
          source: 'cloudflare',
          expiresAt: parsed.expiresAt,
        }, false);
        applyStaticIceFallback('expired_response');
        releaseInitialOfferGate();
        return;
      }

      applyRuntimeIceConfiguration(parsed);
      releaseInitialOfferGate();
    }

    function handleLegacyTurnFallback(error: string, socket: WebSocket): boolean {
      const active = activeTurnRequest;
      if (!isCurrentSession()
        || !active
        || active.socket !== socket
        || active.generation !== turnRequestGeneration
        || !isLegacyTurnUnsupportedError(error)) {
        return false;
      }
      turnUnsupported = true;
      activeTurnRequest = null;
      applyStaticIceFallback('unsupported');
      releaseInitialOfferGate();
      return true;
    }

    const emitSelectedCandidateDiagnostics = (pc: RTCPeerConnection, negotiationGeneration: number) => {
      if (selectedCandidateDiagnosticGeneration === negotiationGeneration) return;
      selectedCandidateDiagnosticGeneration = negotiationGeneration;
      void pc.getStats().then((stats) => {
        if (!isCurrentSession() || pcRef.current !== pc) return;
        let selectedPair: RTCStats | null = null;
        stats.forEach((report) => {
          const pair = report as RTCStats & { selected?: boolean; nominated?: boolean; state?: string };
          if (pair.type === 'candidate-pair' && (pair.selected === true || (pair.nominated === true && pair.state === 'succeeded'))) {
            selectedPair = pair;
          }
        });
        const pair = selectedPair as (RTCStats & { localCandidateId?: string; remoteCandidateId?: string }) | null;
        const candidateDetails = (id: string | undefined) => {
          const candidate = id ? stats.get(id) as (RTCStats & { candidateType?: unknown; protocol?: unknown }) | undefined : undefined;
          return {
            type: typeof candidate?.candidateType === 'string' ? candidate.candidateType : 'unknown',
            protocol: typeof candidate?.protocol === 'string' ? candidate.protocol : 'unknown',
          };
        };
        const runtime = runtimeIceRef.current;
        emitP2PDebug('info', 'ice-path', 'Selected ICE candidate path.', {
          local: candidateDetails(pair?.localCandidateId),
          remote: candidateDetails(pair?.remoteCandidateId),
          source: activeIceSource,
          ...(isRuntimeIceCurrent(runtime, Date.now()) ? { expiresAt: runtime.expiresAt } : {}),
        }, false);
      }).catch(() => { /* stats are optional diagnostics */ });
    };

    const handleICECandidate = (candidatePayload: unknown, rawNegotiationId?: unknown) => {
      if (candidateQueueFailed) return;
      const signaling = parseSignalingNegotiationId(rawNegotiationId);
      if (signaling === null) return;
      if (!candidatePayload || typeof candidatePayload !== 'object' || Array.isArray(candidatePayload)) return;
      const candidate = candidatePayload as RTCIceCandidateInit;
      if (typeof candidate.candidate !== 'string') return;

      const pc = pcRef.current;
      if (pendingOffer && pendingOffer.generation.signaling !== signaling) return;
      if (!pendingOffer && pc && activeSignalingNegotiation !== signaling) return;
      const generation = pendingOffer?.generation ?? (pc
        ? { pc: activePcGeneration, negotiation: activeNegotiationGeneration, signaling }
        : nextOfferGeneration(false, signaling));
      const queued = enqueueBoundedCandidate(pendingRemoteCandidates, { generation, candidate }, PENDING_CANDIDATE_LIMIT);
      if (!queued) {
        candidateQueueFailed = true;
        pendingRemoteCandidates = [];
        emitP2PDebug('error', 'signaling', 'Remote ICE candidate queue overflowed.', {
          limit: PENDING_CANDIDATE_LIMIT,
        }, false);
        scheduleReconnect('Too many remote ICE candidates were queued.');
        return;
      }
      pendingRemoteCandidates = queued;

      // Route even post-description candidates through the same async flush so
      // addIceCandidate promises cannot overtake one another.
      if (roomJoined
        && !initialOfferGateActive
        && pc
        && remoteDescriptionReady
        && remoteCandidateFlushGeneration === null
        && isCurrentPeerGeneration(pc, generation)) {
        void flushRemoteCandidates(pc, generation);
      }
    };

    function handleOffer(
      offerPayload: unknown,
      isRestart: boolean,
      rawNegotiationId?: unknown,
      bufferedGeneration?: CandidateGeneration,
    ) {
      const signaling = parseSignalingNegotiationId(rawNegotiationId);
      if (signaling === null || (bufferedGeneration && bufferedGeneration.signaling !== signaling)) {
        scheduleReconnect('Received an invalid WebRTC negotiation identity.');
        return;
      }
      if (!roomJoined || initialOfferGateActive) {
        pendingOffer = {
          payload: offerPayload,
          isRestart,
          generation: bufferedGeneration ?? nextOfferGeneration(isRestart, signaling),
        };
        return;
      }
      if (!offerPayload || typeof offerPayload !== 'object' || Array.isArray(offerPayload)) {
        scheduleReconnect('Received a malformed WebRTC offer.');
        return;
      }
      const offer = offerPayload as RTCSessionDescriptionInit;
      if (offer.type !== 'offer' || typeof offer.sdp !== 'string' || offer.sdp.length === 0) {
        scheduleReconnect('Received a malformed WebRTC offer.');
        return;
      }

      // sender 주도 ICE restart: 살아있는 PC에 재협상만 적용한다 (DC 유지 —
      // 화면 끊김 없이 네트워크 경로만 복구). 조건이 안 맞으면 full rebuild.
      if (isRestart && pcRef.current && dcRef.current && pcRef.current.signalingState === 'stable') {
        const pc = pcRef.current;
        const generation = bufferedGeneration?.pc === activePcGeneration
          ? bufferedGeneration
          : nextOfferGeneration(true, signaling);
        activeNegotiationGeneration = generation.negotiation;
        activeSignalingNegotiation = generation.signaling;
        pendingRemoteCandidates = pendingRemoteCandidates.filter((entry) => (
          sameCandidateGeneration(entry.generation, generation)
        ));
        remoteDescriptionReady = false;
        beginLocalCandidateQueue(generation);
        restartNegotiation = { generation, answerSent: false };
        enterRestartGrace();
        emitP2PDebug('info', 'signaling', 'Received ICE restart offer, renegotiating in place.', undefined, false);
        clearStageTimeout();
        setConnectionState('reconnecting');
        armStageTimeout('ICE restart did not complete in time.', PEER_CONNECTION_TIMEOUT_MS);
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => {
            if (!isCurrentPeerGeneration(pc, generation)) throw new Error('stale peer connection');
            remoteDescriptionReady = true;
            return flushRemoteCandidates(pc, generation).then(() => createAndSetAnswer(pc, generation));
          })
          .then((answer) => {
            if (isCurrentPeerGeneration(pc, generation)) {
              if (!sendViaWs({ type: 'answer', negotiationId: generation.signaling, payload: answer })) {
                scheduleReconnect('Failed to send the ICE restart answer.');
                return;
              }
              if (restartNegotiation && sameCandidateGeneration(restartNegotiation.generation, generation)) {
                restartNegotiation.answerSent = true;
              }
              flushLocalDescriptionCandidates(pc, generation);
            }
          })
          .catch((err) => {
            if (!isCurrentPeerGeneration(pc, generation)) return;
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

      let generation = bufferedGeneration ?? nextOfferGeneration(false, signaling);
      if (generation.pc <= activePcGeneration) {
        const previousGeneration = generation;
        generation = {
          pc: activePcGeneration + 1,
          negotiation: Math.max(activeNegotiationGeneration + 1, generation.negotiation),
          signaling,
        };
        pendingRemoteCandidates = pendingRemoteCandidates.map((entry) => (
          sameCandidateGeneration(entry.generation, previousGeneration)
            ? { ...entry, generation }
            : entry
        ));
      }
      closeCurrentPeer();
      activePcGeneration = generation.pc;
      activeNegotiationGeneration = generation.negotiation;
      activeSignalingNegotiation = generation.signaling;
      pendingRemoteCandidates = pendingRemoteCandidates.filter((entry) => sameCandidateGeneration(entry.generation, generation));
      remoteDescriptionReady = false;
      beginLocalCandidateQueue(generation);
      resetReliableHealth();

      const selection = selectIceServers(runtimeIceRef.current, CONFIGURED_ICE_SERVERS, CONFIGURED_ICE_SOURCE, Date.now());
      activeIceSource = selection.source;
      const pc = new RTCPeerConnection({ iceServers: selection.iceServers });
      pcRef.current = pc;

      const markConnected = () => {
        if (!isCurrentSession() || terminalFailureRef.current || pcRef.current !== pc) return;
        // ICE/DTLS can connect before SCTP delivers the reliable channel. RPCs
        // and the selected-view effect must see a usable channel before ready.
        if (pc.connectionState !== 'connected' || dcRef.current?.readyState !== 'open') return;
        if (restartNegotiation && (!restartNegotiation.answerSent || !isCurrentPeerGeneration(pc, restartNegotiation.generation))) return;
        hadConnectedRef.current = true;
        completeRecoveryGrace();
        setRtcState('connected');
        clearStageTimeout();
        if (disconnectGraceRef.current) {
          clearTimeout(disconnectGraceRef.current);
          disconnectGraceRef.current = null;
        }
        clearReconnectTimer();
        // A clean connected state resets the backoff counter by design: each fresh
        // drop earns a full retry budget (rapid connect/drop ping-pong is rare).
        reconnectAttemptsRef.current = 0;
        setConnectionState('connected');
        setLastError('');
      };

      pc.onconnectionstatechange = () => {
        if (!isCurrentSession() || terminalFailureRef.current || pcRef.current !== pc) return;
        const state = pc.connectionState;

        if (state === 'connected') {
          markConnected();
        } else if (state === 'failed' || state === 'closed') {
          // Leave rtcState to scheduleReconnect (it sets 'connecting') so Layout's
          // `rtcConnectionState === 'failed'` gate isn't tripped mid-retry.
          scheduleReconnect('Peer connection lost.');
        } else if (state === 'disconnected') {
          // Transient — sender가 ICE restart로 자가 복구할 시간을 준다 (감지 5s +
          // restart 협상 + ICE 재연결 ≈ 11s → 18s 워치독). 복구 실패 시 full reconnect.
          setRtcState('disconnected');
          // 화면 변경(reconnecting + 권한 박탈)은 grace 후에도 미복구일 때만 적용해,
          // 짧은 ICE 깜빡임에 패널이 사라졌다 나타나는 현상을 막는다. 18s 백스톱은 즉시 무장.
          if (disconnectGraceRef.current == null) {
            disconnectGraceRef.current = window.setTimeout(() => {
              disconnectGraceRef.current = null;
              if (!isCurrentSession() || terminalFailureRef.current) return;
              if (pcRef.current?.connectionState === 'connected') return;
              setConnectionState('reconnecting');
            }, DISCONNECTED_UI_GRACE_MS);
          }
          enterRestartGrace(DISCONNECTED_RECOVERY_TIMEOUT_MS);
          armStageTimeout('Peer connection stalled in disconnected state.', DISCONNECTED_RECOVERY_TIMEOUT_MS);
        } else {
          setRtcState(state);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isCurrentSession() || terminalFailureRef.current || pcRef.current !== pc) return;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          completeRecoveryGrace();
          if (pc.connectionState === 'connected') {
            markConnected();
          }
          emitSelectedCandidateDiagnostics(pc, activeNegotiationGeneration);
        }
        if (pc.iceConnectionState === 'failed') {
          // 실패 원인 진단용 candidate-pair 통계 1회 기록 (방화벽/NAT 의심 판별)
          void pc.getStats().then((stats) => {
            if (!isCurrentSession() || pcRef.current !== pc) return;
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
              source: activeIceSource,
              ...(isRuntimeIceCurrent(runtimeIceRef.current, Date.now()) ? { expiresAt: runtimeIceRef.current.expiresAt } : {}),
            }, false);
          }).catch(() => { /* stats 미지원 환경 무시 */ });
          scheduleReconnect('ICE negotiation failed. A TURN relay may be required for this network path.');
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || !isCurrentSession() || pcRef.current !== pc) return;
        const candidate = event.candidate.toJSON();
        const generation = {
          pc: activePcGeneration,
          negotiation: activeNegotiationGeneration,
          signaling: activeSignalingNegotiation,
        };
        if (!localDescriptionSignaled) {
          const queued = enqueueBoundedCandidate(
            pendingLocalDescriptionCandidates,
            { generation, candidate },
            PENDING_CANDIDATE_LIMIT,
          );
          if (!queued) {
            if (!candidateQueueFailed) {
              candidateQueueFailed = true;
              emitP2PDebug('error', 'signaling', 'Local ICE candidate queue overflowed before SDP answer.', {
                limit: PENDING_CANDIDATE_LIMIT,
              }, false);
              scheduleReconnect('Too many local ICE candidates were queued.');
            }
            return;
          }
          pendingLocalDescriptionCandidates = queued;
          return;
        }
        if (roomJoined && sendViaWs({
          type: 'ice_candidate',
          negotiationId: generation.signaling,
          payload: candidate,
        })) return;
        // 시그널링이 잠시 끊겨 있으면 큐에 모아 재연결 후 flush한다.
        if (pendingCandidatesRef.current.length >= PENDING_CANDIDATE_LIMIT) {
          if (!candidateQueueFailed) {
            candidateQueueFailed = true;
            emitP2PDebug('error', 'signaling', 'Local ICE candidate queue overflowed.', {
              limit: PENDING_CANDIDATE_LIMIT,
            }, false);
            scheduleReconnect('Too many local ICE candidates were queued.');
          }
          return;
        }
        pendingCandidatesRef.current.push({ candidate, negotiationId: generation.signaling });
      };

      pc.ondatachannel = (event) => {
        if (!isCurrentSession() || terminalFailureRef.current || pcRef.current !== pc) return;
        const dc = event.channel;

        dc.binaryType = 'arraybuffer';
        dc.onmessage = (e) => {
          if (!isCurrentSession() || pcRef.current !== pc) return;

          // sender keepalive ping → 즉시 pong 응답 (requestId가 없는 제어 메시지).
          // Fast telemetry and ordinary reliable payloads intentionally do not touch health.
          const ping = parseReliableDataPing(dc.label, e.data);
          if (ping) {
            pingSeenRef.current = true;
            lastReliablePingAtRef.current = Date.now();
            // In-place ICE can stay connected throughout renegotiation. A real
            // reliable ping after our current answer proves the usable path even
            // when Chrome emits no connection-state transition.
            if (restartNegotiation?.answerSent && isCurrentPeerGeneration(pc, restartNegotiation.generation) &&
              (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) {
              restartNegotiation = null;
              clearRestartGrace();
              markConnected();
            }
            if (restartProbeRef.current) {
              clearRestartGrace();
            }
            if (dc.readyState === 'open') {
              dc.send(JSON.stringify({ type: 'pong', ts: ping.ts }));
            }
            return;
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

        // Only the reliable "data" channel governs connection state.
        if (dc.label === 'data') {
          dcRef.current = dc;
          dc.onopen = () => {
            if (dcRef.current !== dc) return;
            emitP2PDebug('info', 'connection', 'P2P data channel opened.', { label: dc.label });
            markConnected();
          };
          // Remote-created channels may already be open when delivered.
          if (dc.readyState === 'open') markConnected();
          dc.onclose = () => {
            if (!isCurrentSession() || terminalFailureRef.current || pcRef.current !== pc) return;
            emitP2PDebug('warn', 'connection', 'P2P data channel closed.', {
              label: dc.label,
              pendingRequests: pendingRequestsRef.current.size,
            }, false);
            scheduleReconnect('Data channel closed.');
          };
        }
      };

      pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
          if (!isCurrentPeerGeneration(pc, generation)) throw new Error('stale peer connection');
          remoteDescriptionReady = true;
          return flushRemoteCandidates(pc, generation).then(() => createAndSetAnswer(pc, generation));
        })
        .then((answer) => {
          if (isCurrentPeerGeneration(pc, generation)) {
            if (!sendViaWs({ type: 'answer', negotiationId: generation.signaling, payload: answer })) {
              scheduleReconnect('Failed to send the WebRTC answer.');
              return;
            }
            flushLocalDescriptionCandidates(pc, generation);
          }
        })
        .catch((err) => {
          if (!isCurrentPeerGeneration(pc, generation)) return;
          emitP2PDebug('error', 'connection', 'WebRTC offer/answer negotiation failed.', {
            error: err instanceof Error ? err.message : String(err),
          }, false);
          scheduleReconnect('WebRTC offer/answer negotiation failed.');
        });
    }

    function connectSignaling() {
      if (!isCurrentSession() || terminalFailureRef.current) return;
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
      roomJoined = false;
      activeTurnRequest = null;

      socket.onopen = () => {
        if (!isCurrentSession() || socket !== ws) {
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
        if (!isCurrentSession() || socket !== ws) return;
        stopHeartbeat();
        updateIntercomTransport({
          generation: intercomGenerationRef.current,
          joined: false,
        });
        if (terminalFailureRef.current) return;
        emitP2PDebug('warn', 'signaling', 'Signaling connection closed.', undefined, false);
        if (reconnectKindForSignalingClose(pcRef.current?.connectionState) === 'signaling-rebind') {
          // P2P는 독립적으로 유지 — 시그널링만 백그라운드에서 복구한다.
          scheduleWsReconnect();
          return;
        }
        scheduleReconnect('Signaling connection closed before the peer link was established.');
      };

      socket.onerror = () => {
        if (!isCurrentSession() || socket !== ws) return;
        updateIntercomTransport({
          generation: intercomGenerationRef.current,
          joined: false,
        });
        if (terminalFailureRef.current) return;
        emitP2PDebug('error', 'signaling', 'Signaling server connection failed.', undefined, false);
        // The reconnect decision is made in socket.onclose, which fires right after onerror.
      };

      socket.onmessage = (event) => {
        if (!isCurrentSession() || socket !== ws) return;

        let msg: {
          type: string;
          payload?: unknown;
          error?: string;
          peerId?: string;
          requestId?: unknown;
          restart?: boolean;
          negotiationId?: unknown;
          features?: { intercomVersion?: unknown };
        };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        const intercomMessage = parseServerIntercomEnvelope(msg);
        if (intercomMessage) {
          for (const listener of intercomListenersRef.current) listener(intercomMessage);
          return;
        }
        if (SERVER_INTERCOM_TYPES.has(msg.type)) {
          const malformed = malformedIntercomAuthorityError();
          for (const listener of intercomListenersRef.current) listener(malformed);
          return;
        }

        switch (msg.type) {
          case 'room_joined': {
            wsReconnectDelay = RECONNECT_BASE_DELAY_MS;
            if (typeof msg.peerId !== 'string' || msg.peerId === '') {
              scheduleReconnect('Signaling server returned an invalid peer identity.');
              break;
            }
            const previousPeerId = lastPeerIdRef.current;
            const rebound = previousPeerId !== '' && msg.peerId === previousPeerId;
            const freshMembership = previousPeerId !== '' && msg.peerId !== previousPeerId;
            const liveRebind = rebound
              && pcRef.current?.connectionState === 'connected'
              && dcRef.current?.readyState === 'open';
            if (rebound && !liveRebind) {
              emitP2PDebug('warn', 'signaling', 'Peer identity rebound after the P2P link stopped being live; requesting a fresh membership.', {
                peerId: msg.peerId,
              }, false);
              closeCurrentPeer();
              scheduleReconnect('The previous peer session was no longer live after signaling rebind.');
              socket.close();
              break;
            }
            roomJoined = true;
            lastPeerIdRef.current = msg.peerId;
            const nextIntercomGeneration = ++intercomGenerationRef.current;
            ownedIntercomGeneration = nextIntercomGeneration;
            updateIntercomTransport({
              generation: nextIntercomGeneration,
              joined: true,
              intercomVersion: msg.features?.intercomVersion === INTERCOM_VERSION
                ? INTERCOM_VERSION
                : undefined,
            });
            if (rebound) {
              flushPendingCandidates();
            } else {
              pendingCandidatesRef.current = [];
            }
            if (freshMembership) {
              closeCurrentPeer();
              remoteDescriptionReady = false;
              resetReliableHealth();
              runtimeIceRef.current = null;
              runtimeIceReceivedAtRef.current = 0;
              clearTurnRefreshTimers();
              activeIceSource = CONFIGURED_ICE_SOURCE;
            } else {
              const runtime = runtimeIceRef.current;
              if (isRuntimeIceCurrent(runtime, Date.now())
                && !turnRefreshTimeoutRef.current
                && !turnExpiryTimeoutRef.current) {
                scheduleTurnLifecycle(runtime, runtimeIceReceivedAtRef.current || Date.now());
              }
            }
            if (!liveRebind) {
              initialOfferGateActive = true;
              if (offerGateTimeoutRef.current) clearTimeout(offerGateTimeoutRef.current);
              offerGateTimeoutRef.current = window.setTimeout(() => {
                offerGateTimeoutRef.current = null;
                if (isCurrentSession()) {
                  releaseInitialOfferGate();
                }
              }, TURN_INITIAL_OFFER_GATE_MS);
            }
            requestTurnCredentials();
            if (liveRebind) {
              const bufferedOffer = pendingOffer;
              pendingOffer = null;
              if (bufferedOffer) {
                handleOffer(
                  bufferedOffer.payload,
                  bufferedOffer.isRestart,
                  bufferedOffer.generation.signaling,
                  bufferedOffer.generation,
                );
              } else if (pcRef.current && remoteDescriptionReady && remoteCandidateFlushGeneration === null) {
                const generation = {
                  pc: activePcGeneration,
                  negotiation: activeNegotiationGeneration,
                  signaling: activeSignalingNegotiation,
                };
                void flushRemoteCandidates(pcRef.current, generation);
              }
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
          case 'turn_credentials':
            handleTurnCredentials(msg.payload, msg.requestId, socket);
            break;
          case 'offer':
            handleOffer(msg.payload, msg.restart === true, msg.negotiationId);
            break;
          case 'ice_candidate':
            handleICECandidate(msg.payload, msg.negotiationId);
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
            if (handleLegacyTurnFallback(errMsg, socket)) {
              break;
            }
            emitP2PDebug('error', 'signaling', 'Received signaling error.', { error: errMsg }, false);
            const retryable = shouldRetrySignalingError(
              errMsg,
              hadConnectedRef.current,
              reconnectAttemptsRef.current,
            );
            if (retryable) {
              if (pcRef.current?.connectionState === 'connected') {
                // P2P는 살아있고 join만 거절됨(예: 서버 재시작 직후 방 미생성) —
                // 현재 소켓을 닫아 onclose의 시그널링 전용 백오프 경로로 보낸다.
                // 열린 소켓을 둔 채 타이머만 걸면 connectSignaling()의 OPEN 가드에
                // 막혀 재시도가 영구히 진행되지 않는다.
                socket.close();
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
      if (!isCurrentSession() || !pingSeenRef.current || restartGraceRef.current) return;
      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') return;
      const silentFor = Date.now() - lastReliablePingAtRef.current;
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
      stopHeartbeat();
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
      clearInterval(keepaliveWatchdog);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (cleanup({ socket: ws, intercomGeneration: ownedIntercomGeneration })) {
        isMountedRef.current = false;
      }
    };
    // Re-run when connection params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.signalingUrl, options?.roomId, options?.roomCode, options?.password, reconnectNonce]);

  const intercomAdapterRevision = `${intercomTransportState.generation}:${intercomTransportState.joined}:${intercomTransportState.intercomVersion ?? 0}`;
  const intercomAdapter = useMemo<IntercomSignalingAdapter>(() => {
    void intercomAdapterRevision;
    return {
      get generation() { return intercomTransportRef.current.generation; },
      get joined() { return intercomTransportRef.current.joined; },
      get intercomVersion() { return intercomTransportRef.current.intercomVersion; },
      sendIntercom,
      subscribeIntercom,
      subscribeInvalidation: subscribeIntercomInvalidation,
    };
  }, [intercomAdapterRevision, sendIntercom, subscribeIntercom, subscribeIntercomInvalidation]);

  return {
    disconnect,
    forceReconnect,
    sendView,
    request,
    stream,
    connectionState: rtcState,
    lastError,
    intercom: intercomAdapter,
  };
}
