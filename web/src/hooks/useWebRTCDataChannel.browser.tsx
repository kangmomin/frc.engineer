import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useTelemetryStore } from '../store/telemetryStore';
import { useWebRTCDataChannel } from './useWebRTCDataChannel';

const NativePeer = window.RTCPeerConnection;
const NativeSocket = window.WebSocket;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message: string, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    check(Date.now() < deadline, message);
    await wait(10);
  }
}

async function scenario(mode: 'already-open' | 'connecting' | 'never-opens'): Promise<void> {
  const sender = new NativePeer({ iceServers: [] });
  const data = sender.createDataChannel('data');
  sender.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
  const receiver: { current: RTCPeerConnection | null } = { current: null };
  let reliableEvent: RTCDataChannelEvent | null = null;
  let deliverReliable: (() => void) | null = null;
  let observedView = '';
  let rpcResult = false;
  let rpcError = '';
  let client: ReturnType<typeof useWebRTCDataChannel> | null = null;
  const options = { signalingUrl: 'ws://test.invalid', roomId: mode, password: '' };
  const received: RTCIceCandidateInit[] = [];
  const signaling: { current: TestSocket | null } = { current: null };

  class TestPeer extends NativePeer {
    constructor() {
      super({ iceServers: [] });
      receiver.current = this;
      let handler: ((event: RTCDataChannelEvent) => void) | null = null;
      Object.defineProperty(this, 'ondatachannel', {
        get: () => handler,
        set: (next: typeof handler) => { handler = next; },
      });
      this.addEventListener('datachannel', (event) => {
        if (event.channel.label !== 'data') {
          handler?.(event);
          return;
        }
        reliableEvent = event;
        deliverReliable = () => handler?.(event);
      });
    }
  }

  class TestSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      signaling.current = this;
      window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    emit(message: unknown): void {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
    }
    send(raw: string): void {
      const message = JSON.parse(raw);
      if (message.type === 'room_join') {
        queueMicrotask(() => {
          this.emit({ type: 'room_joined', peerId: 'test-peer' });
          void sender.createOffer().then(async (offer) => {
            await sender.setLocalDescription(offer);
            this.emit({ type: 'offer', payload: sender.localDescription });
          });
        });
      } else if (message.type === 'turn_credentials_request') {
        queueMicrotask(() => this.emit({ type: 'error', error: 'unknown message type: turn_credentials_request' }));
      } else if (message.type === 'answer') {
        void sender.setRemoteDescription(message.payload).then(async () => {
          for (const candidate of received.splice(0)) await sender.addIceCandidate(candidate);
        });
      } else if (message.type === 'ice_candidate') {
        if (sender.remoteDescription) void sender.addIceCandidate(message.payload);
        else received.push(message.payload);
      }
    }
    close(): void { this.readyState = 3; }
  }

  sender.onicecandidate = ({ candidate }) => {
    if (candidate) signaling.current!.emit({ type: 'ice_candidate', payload: candidate.toJSON() });
  };
  data.onmessage = ({ data: raw }) => {
    const message = JSON.parse(raw);
    if (message.type === 'setView') observedView = message.view;
    if (message.requestId) data.send(JSON.stringify({ type: 'strategyGuide', requestId: message.requestId, data: { ok: true } }));
  };
  window.RTCPeerConnection = TestPeer;
  window.WebSocket = TestSocket as unknown as typeof WebSocket;

  function Consumer() {
    const transport = useWebRTCDataChannel(options);
    client = transport;
    const { sendView, request } = transport;
    const state = useTelemetryStore((s) => s.connectionState);
    useEffect(() => {
      if (state !== 'connected') return;
      sendView('qualifying');
      void request<{ ok: boolean }>({ type: 'getStrategyGuide' }).then((result) => {
        rpcResult = result.ok;
      }).catch((error: Error) => { rpcError = error.message; });
    }, [state, sendView, request]);
    return null;
  }

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    root.render(<Consumer />);
    await until(() => receiver.current?.connectionState === 'connected' && reliableEvent !== null, 'RTC negotiation did not complete.');
    // Hold back the real incoming channel to deterministically expose the
    // Chrome PC-connected-before-datachannel ordering from the reported bug.
    await wait(50);
    check(useTelemetryStore.getState().connectionState !== 'connected', 'Published connected before the reliable channel was delivered.');
    check(!observedView && !rpcResult && !rpcError, 'Consumer ran before its RPC transport was ready.');
    const initial = client!;
    const channel = reliableEvent!.channel;
    if (mode !== 'already-open') Object.defineProperty(channel, 'readyState', { configurable: true, value: 'connecting' });
    deliverReliable!();
    if (mode === 'never-opens') {
      await until(() => useTelemetryStore.getState().connectionState === 'reconnecting', 'Missing channel disabled the connection watchdog.', 14_000);
      return;
    }
    if (mode === 'connecting') {
      await wait(50);
      check(useTelemetryStore.getState().connectionState !== 'connected', 'Published connected while the reliable channel was still connecting.');
      Reflect.deleteProperty(channel, 'readyState');
      channel.dispatchEvent(new Event('open'));
    }
    await until(() => observedView === 'qualifying' && rpcResult, `Selected view/RPC failed after channel readiness: ${rpcError}`);
    check(initial.request === client!.request && initial.stream === client!.stream && initial.sendView === client!.sendView,
      'RPC function identities changed during connection publication.');
    check(!rpcError, rpcError);
    const generation = useTelemetryStore.getState().roomGeneration;
    client!.disconnect();
    check(useTelemetryStore.getState().roomGeneration > generation, 'Explicit disconnect did not reset the room.');
    check(useTelemetryStore.getState().connectionState === 'disconnected', 'Explicit disconnect did not clear connection state.');
  } finally {
    root.unmount();
    sender.close();
    container.remove();
    window.RTCPeerConnection = NativePeer;
    window.WebSocket = NativeSocket;
  }
}

export async function run(): Promise<string> {
  for (const mode of ['already-open', 'connecting', 'never-opens'] as const) await scenario(mode);
  return 'PASS: real Chrome/React/RTC readiness, selected view, RPCs, stable callbacks, disconnect and channel watchdog (3 scenarios).';
}
