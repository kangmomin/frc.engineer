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
const DATA_REQUEST_TIMEOUT_MS = 30_000;

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

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const isMountedRef = useRef(true);
  const stageTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const terminalFailureRef = useRef<ConnectionState | null>(null);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());

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
    rejectAllPendingRequests('P2P connection closed.');
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
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
  }, [clearStageTimeout, rejectAllPendingRequests]);

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

  const armStageTimeout = useCallback((message: string, ms: number) => {
    clearStageTimeout();
    stageTimeoutRef.current = window.setTimeout(() => {
      failConnection('timeout', message);
    }, ms);
  }, [clearStageTimeout, failConnection]);

  const disconnect = useCallback(() => {
    terminalFailureRef.current = null;
    clearStageTimeout();
    setLastError('');
    cleanup();
    setConnectionState('disconnected');
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    setRtcState('new');
  }, [cleanup, clearStageTimeout, setConnectionState, setFeaturePermissions]);

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

    isMountedRef.current = true;
    terminalFailureRef.current = null;

    // Clean previous connections
    cleanup();
    setLastError('');
    setRtcState('new');
    setConnectionState('connecting');
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    armStageTimeout('Timed out waiting for the signaling server to acknowledge the room join.', SIGNALING_RESPONSE_TIMEOUT_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(signalingUrl);
    } catch {
      failConnection('error', 'Failed to open the signaling connection.');
      return;
    }
    wsRef.current = ws;

    const handleICECandidate = (candidatePayload: unknown) => {
      const pc = pcRef.current;
      if (!pc) return;
      const candidate = candidatePayload as RTCIceCandidateInit;
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        console.error('Failed to add ICE candidate:', err);
      });
    };

    const handleOffer = (offerPayload: unknown) => {
      const offer = offerPayload as RTCSessionDescriptionInit;
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
        setRtcState(state);

        if (state === 'connected') {
          clearStageTimeout();
          setConnectionState('connected');
          setLastError('');
        } else if (state === 'disconnected' || state === 'closed') {
          setConnectionState('disconnected');
          setFeaturePermissions(NO_FEATURE_PERMISSIONS);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        if (terminalFailureRef.current) return;
        if (pc.iceConnectionState === 'failed') {
          failConnection('ice-failed', 'ICE negotiation failed. A TURN relay is likely required on one side of this connection.');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice_candidate',
            payload: event.candidate.toJSON(),
          }));
        }
      };

      pc.ondatachannel = (event) => {
        const dc = event.channel;

        dc.binaryType = 'arraybuffer';
        dc.onmessage = (e) => {
          if (!isMountedRef.current) return;
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
            setConnectionState('disconnected');
            setFeaturePermissions(NO_FEATURE_PERMISSIONS);
            setRtcState('disconnected');
          };
        }
      };

      pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => pc.createAnswer())
        .then((answer) => {
          return pc.setLocalDescription(answer).then(() => answer);
        })
        .then((answer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'answer', payload: answer }));
          }
        })
        .catch((err) => {
          console.error('WebRTC offer/answer failed:', err);
          emitP2PDebug('error', 'connection', 'WebRTC offer/answer negotiation failed.', {
            error: err instanceof Error ? err.message : String(err),
          }, false);
          failConnection('error', 'WebRTC offer/answer negotiation failed.');
        });
    };

    ws.onopen = () => {
      if (!isMountedRef.current) { ws.close(); return; }
      emitP2PDebug('info', 'signaling', 'Joining sender room.', {
        roomId: roomId ?? null,
        roomCode: roomCode ?? null,
      }, false);
      ws.send(JSON.stringify({
        type: 'room_join',
        roomId,
        roomCode,
        password,
      }));
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      if (terminalFailureRef.current) return;
      emitP2PDebug('warn', 'signaling', 'Signaling connection closed.', undefined, false);
      setConnectionState('disconnected');
      setFeaturePermissions(NO_FEATURE_PERMISSIONS);
      setRtcState('disconnected');
    };

    ws.onerror = () => {
      if (!isMountedRef.current) return;
      if (terminalFailureRef.current) return;
      emitP2PDebug('error', 'signaling', 'Signaling server connection failed.', undefined, false);
      failConnection('error', 'Signaling server connection failed.');
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;

      let msg: { type: string; payload?: unknown; error?: string; permissions?: FeaturePermissions };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room_joined':
          emitP2PDebug('info', 'signaling', 'Joined sender room.', {
            roomId: roomId ?? null,
            roomCode: roomCode ?? null,
          }, false);
          clearStageTimeout();
          setFeaturePermissions(msg.permissions ?? NO_FEATURE_PERMISSIONS);
          setConnectionState('waiting-offer');
          armStageTimeout('Timed out waiting for the sender to publish a WebRTC offer.', OFFER_TIMEOUT_MS);
          break;
        case 'offer':
          handleOffer(msg.payload);
          break;
        case 'ice_candidate':
          handleICECandidate(msg.payload);
          break;
        case 'room_closed':
          emitP2PDebug('error', 'signaling', 'Sender room was closed.', undefined, false);
          failConnection('error', 'The sender room was closed.');
          break;
        case 'error':
          console.error('Signaling error:', msg.error);
          emitP2PDebug('error', 'signaling', 'Received signaling error.', {
            error: msg.error ?? 'Unknown signaling error.',
          }, false);
          failConnection('error', msg.error ?? 'Unknown signaling error.');
          break;
      }
    };

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
    // Re-run when connection params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.signalingUrl, options?.roomId, options?.roomCode, options?.password]);

  return { disconnect, sendView, request, stream, connectionState: rtcState, lastError };
}
