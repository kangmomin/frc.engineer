import {
  INTERCOM_VERSION,
  MAX_INTERCOM_ENVELOPE_BYTES,
  isClientIntercomEnvelope,
  jsonEnvelopeBytes,
  malformedIntercomAuthorityError,
  parseServerIntercomEnvelope,
  SERVER_INTERCOM_TYPES,
  utf8ByteLength,
  type IntercomEnvelope,
  type IntercomSignalingAdapter,
  type ServerIntercomEnvelope,
} from '../../../shared/intercom';

const BRIDGE_URL = 'ws://127.0.0.1:8099/api/intercom/ws';
const BRIDGE_PROTOCOL = 'frc-intercom-v1';

interface BridgeState {
  generation: number;
  joined: boolean;
  intercomVersion?: number;
}

export class DriverIntercomBridge {
  private socket: WebSocket | null = null;
  private token = '';
  private disposed = false;
  private starting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 500;
  private state: BridgeState = { generation: 0, joined: false };
  private messageListeners = new Set<(message: ServerIntercomEnvelope) => void>();
  private stateListeners = new Set<(state: BridgeState) => void>();
  private invalidationListeners = new Set<() => void>();

  async start(): Promise<void> {
    if (this.disposed || this.socket || this.starting) return;
    const getter = (window as typeof window & {
      electronAPI?: { getIntercomBridgeToken?: () => Promise<string> };
    }).electronAPI?.getIntercomBridgeToken;
    if (!getter) return;
    this.starting = true;
    try {
      const token = await getter();
      if (!/^[a-f0-9]{64}$/.test(token) || this.disposed) return;
      this.token = token;
      this.connect();
    } catch {
      this.publishState({ generation: this.state.generation, joined: false });
    } finally {
      this.starting = false;
    }
  }

  adapter(): IntercomSignalingAdapter {
    const bridge = this;
    return {
      get generation() { return bridge.state.generation; },
      get joined() { return bridge.state.joined; },
      get intercomVersion() { return bridge.state.intercomVersion; },
      sendIntercom: (message) => this.send(message),
      subscribeIntercom: (listener) => {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
      },
      subscribeInvalidation: (listener) => {
        this.invalidationListeners.add(listener);
        return () => this.invalidationListeners.delete(listener);
      },
    };
  }

  subscribeState(listener: (state: BridgeState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  close(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.token = '';
    this.publishState({ generation: this.state.generation, joined: false });
    this.messageListeners.clear();
    this.stateListeners.clear();
    this.invalidationListeners.clear();
  }

  private connect(): void {
    if (this.disposed || !this.token) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(BRIDGE_URL, [BRIDGE_PROTOCOL, `frc-auth.${this.token}`]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      if (socket.protocol !== BRIDGE_PROTOCOL) {
        socket.close(1002, 'invalid bridge protocol');
        return;
      }
      this.reconnectDelay = 500;
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string' || utf8ByteLength(event.data) > MAX_INTERCOM_ENVELOPE_BYTES) return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isBridgeState(raw)) {
        this.publishState({
          generation: raw.payload.generation,
          joined: raw.payload.joined,
          intercomVersion: raw.payload.intercomVersion === INTERCOM_VERSION ? INTERCOM_VERSION : undefined,
        });
        return;
      }
      const message = parseServerIntercomEnvelope(raw);
      if (message) for (const listener of this.messageListeners) listener(message);
      else if (raw && typeof raw === 'object' && SERVER_INTERCOM_TYPES.has((raw as { type?: unknown }).type as string)) {
        const malformed = malformedIntercomAuthorityError();
        for (const listener of this.messageListeners) listener(malformed);
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.publishState({ generation: this.state.generation, joined: false });
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.publishState({ generation: this.state.generation, joined: false });
      // onclose owns reconnect and no capability details are logged.
    };
  }

  private send(message: IntercomEnvelope): boolean {
    if (!isClientIntercomEnvelope(message)
      || jsonEnvelopeBytes(message) > MAX_INTERCOM_ENVELOPE_BYTES) return false;
    const socket = this.socket;
    if (!socket
      || socket.readyState !== WebSocket.OPEN
      || socket.protocol !== BRIDGE_PROTOCOL) {
      this.publishState({ generation: this.state.generation, joined: false });
      return false;
    }
    if (!this.state.joined || this.state.intercomVersion !== INTERCOM_VERSION) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.publishState({ generation: this.state.generation, joined: false });
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private publishState(state: BridgeState): void {
    const previous = this.state;
    this.state = state;
    if (previous.joined && (
      !state.joined
      || state.generation !== previous.generation
      || state.intercomVersion !== INTERCOM_VERSION
    )) {
      for (const listener of this.invalidationListeners) listener();
    }
    for (const listener of this.stateListeners) listener(state);
  }
}

function isBridgeState(value: unknown): value is {
  type: 'intercom_bridge_state';
  payload: { generation: number; joined: boolean; intercomVersion?: number };
} {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== 'intercom_bridge_state' || !envelope.payload || typeof envelope.payload !== 'object') return false;
  const payload = envelope.payload as Record<string, unknown>;
  return Number.isSafeInteger(payload.generation)
    && (payload.generation as number) >= 0
    && typeof payload.joined === 'boolean'
    && (payload.intercomVersion === undefined || Number.isSafeInteger(payload.intercomVersion));
}
