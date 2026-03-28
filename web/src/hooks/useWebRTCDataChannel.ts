import { useEffect, useCallback, useRef, useState } from 'react';
import type { PitwallState } from '../types/telemetry';
import { useTelemetryStore } from '../store/telemetryStore';
import { routeMessage } from './useMessageRouter';

interface UseWebRTCOptions {
  signalingUrl: string;
  roomId: string;
  password: string;
}

interface UseWebRTCReturn {
  disconnect: () => void;
  connectionState: RTCPeerConnectionState | 'new';
}

export function useWebRTCDataChannel(options: UseWebRTCOptions | null): UseWebRTCReturn {
  const setConnectionState = useTelemetryStore((s) => s.setConnectionState);
  const setPitwallState = useTelemetryStore((s) => s.setPitwallState);
  const addRaceControlNotification = useTelemetryStore((s) => s.addRaceControlNotification);
  const addBattleAlert = useTelemetryStore((s) => s.addBattleAlert);
  const setRaceResult = useTelemetryStore((s) => s.setRaceResult);

  const [rtcState, setRtcState] = useState<RTCPeerConnectionState | 'new'>('new');

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const isMountedRef = useRef(true);

  // Refs for routeMessage batching
  const pendingPitwallRef = useRef<PitwallState | null>(null);
  const pitwallRafRef = useRef(0);
  const rcSeqRef = useRef(0);
  const battleSeqRef = useRef(0);

  // Store options in a ref to avoid stale closure issues
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Store actions in a ref so callbacks never go stale
  const actionsRef = useRef({ setPitwallState, addRaceControlNotification, addBattleAlert, setRaceResult });
  actionsRef.current = { setPitwallState, addRaceControlNotification, addBattleAlert, setRaceResult };

  const cleanup = useCallback(() => {
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
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setConnectionState('disconnected');
    setRtcState('new');
  }, [cleanup, setConnectionState]);

  // Main connection effect — runs when signalingUrl or roomCode changes.
  useEffect(() => {
    if (!options) return;

    const { signalingUrl, roomId, password } = options;
    if (!signalingUrl || !roomId) return;

    isMountedRef.current = true;

    // Clean previous connections
    cleanup();
    setConnectionState('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(signalingUrl);
    } catch {
      setConnectionState('error');
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

      // Close previous PeerConnection if it exists
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current = null;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        if (!isMountedRef.current) return;
        const state = pc.connectionState;
        setRtcState(state);

        if (state === 'connected') {
          setConnectionState('connected');
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          setConnectionState('disconnected');
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
        dcRef.current = dc;

        dc.onmessage = (e) => {
          if (!isMountedRef.current) return;
          const actions = actionsRef.current;
          routeMessage(
            e.data as string,
            actions,
            {
              pendingPitwall: pendingPitwallRef,
              pitwallRaf: pitwallRafRef,
              rcSeq: rcSeqRef,
              battleSeq: battleSeqRef,
            },
          );
        };

        dc.onclose = () => {
          if (!isMountedRef.current) return;
          setConnectionState('disconnected');
        };
      };

      pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => pc.createAnswer())
        .then((answer) => {
          pc.setLocalDescription(answer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'answer', payload: answer }));
          }
        })
        .catch((err) => {
          console.error('WebRTC offer/answer failed:', err);
          setConnectionState('error');
        });
    };

    ws.onopen = () => {
      if (!isMountedRef.current) { ws.close(); return; }
      ws.send(JSON.stringify({ type: 'room_join', roomId, password }));
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      setConnectionState('disconnected');
    };

    ws.onerror = () => {
      if (!isMountedRef.current) return;
      setConnectionState('error');
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;

      let msg: { type: string; payload?: unknown; error?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room_joined':
          break;
        case 'offer':
          handleOffer(msg.payload);
          break;
        case 'ice_candidate':
          handleICECandidate(msg.payload);
          break;
        case 'room_closed':
          setConnectionState('disconnected');
          cleanup();
          break;
        case 'error':
          console.error('Signaling error:', msg.error);
          setConnectionState('error');
          cleanup();
          break;
      }
    };

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
    // Re-run when connection params change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.signalingUrl, options?.roomId, options?.password]);

  return { disconnect, connectionState: rtcState };
}
