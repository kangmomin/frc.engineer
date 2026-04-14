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
  };

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
    for (const [requestId, pending] of pendingRequestsRef.current.entries()) {
      clearPendingRequest(requestId);
      pending.reject(toError(message));
    }
  }, [clearPendingRequest]);

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
      clearPendingRequest(requestId);
      active.reject(toError('Timed out waiting for a P2P response.'));
    }, pending.timeoutMs);
  }, [clearPendingRequest]);

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

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        kind: 'single',
        resolve: (data) => resolve(data as T),
        reject,
        timeoutId: null,
        timeoutMs: options?.timeoutMs ?? DATA_REQUEST_TIMEOUT_MS,
        abortSignal: options?.signal,
      };
      if (options?.signal) {
        pending.abortHandler = () => {
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
        clearPendingRequest(requestId);
        reject(error instanceof Error ? error : toError('Failed to send P2P request.'));
      }
    });
  }, [clearPendingRequest, refreshPendingTimeout]);

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

    return new Promise<void>((resolve, reject) => {
      const pending: PendingRequest = {
        kind: 'stream',
        doneType: options.doneType,
        onMessage: options.onMessage,
        resolve,
        reject,
        timeoutId: null,
        timeoutMs: options.timeoutMs ?? DATA_REQUEST_TIMEOUT_MS,
        abortSignal: options.signal,
      };
      if (options.signal) {
        pending.abortHandler = () => {
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
        clearPendingRequest(requestId);
        reject(error instanceof Error ? error : toError('Failed to send P2P request.'));
      }
    });
  }, [clearPendingRequest, refreshPendingTimeout]);

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
              if (response.error) {
                clearPendingRequest(response.requestId);
                pending.reject(toError(response.error));
                return;
              }
              if (pending.kind === 'single') {
                clearPendingRequest(response.requestId);
                pending.resolve(response.data);
                return;
              }
              try {
                pending.onMessage(response);
              } catch (error) {
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
          dc.onclose = () => {
            if (!isMountedRef.current) return;
            if (terminalFailureRef.current) return;
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
          failConnection('error', 'WebRTC offer/answer negotiation failed.');
        });
    };

    ws.onopen = () => {
      if (!isMountedRef.current) { ws.close(); return; }
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
      setConnectionState('disconnected');
      setFeaturePermissions(NO_FEATURE_PERMISSIONS);
      setRtcState('disconnected');
    };

    ws.onerror = () => {
      if (!isMountedRef.current) return;
      if (terminalFailureRef.current) return;
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
          failConnection('error', 'The sender room was closed.');
          break;
        case 'error':
          console.error('Signaling error:', msg.error);
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
