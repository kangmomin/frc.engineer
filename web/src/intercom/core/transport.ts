import {
  INTERCOM_VERSION,
  MAX_INTERCOM_ENVELOPE_BYTES,
  isClientIntercomEnvelope,
  jsonEnvelopeBytes,
  parseServerIntercomEnvelope,
  type IntercomEnvelope,
  type ServerIntercomEnvelope,
} from './protocol';

export interface IntercomSignalingAdapter {
  generation: number;
  joined: boolean;
  intercomVersion?: number;
  sendIntercom: (message: IntercomEnvelope) => boolean;
  subscribeIntercom: (listener: (message: ServerIntercomEnvelope) => void) => () => void;
  /** Local-only synchronous authority-loss hook; it does not extend the wire protocol. */
  subscribeInvalidation?: (listener: () => void) => () => void;
}

export function isIntercomTransportReady(adapter: IntercomSignalingAdapter | null): boolean {
  return adapter?.joined === true && adapter.intercomVersion === INTERCOM_VERSION;
}

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ic-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function safeSendIntercom(adapter: IntercomSignalingAdapter, message: IntercomEnvelope): boolean {
  return isIntercomTransportReady(adapter)
    && isClientIntercomEnvelope(message)
    && jsonEnvelopeBytes(message) <= MAX_INTERCOM_ENVELOPE_BYTES
    && adapter.sendIntercom(message);
}

interface PendingRPC {
  generation: number;
  expectedType: string;
  resolve: (message: ServerIntercomEnvelope) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class IntercomRPCError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'IntercomRPCError';
  }
}

export class IntercomRPCClient {
  private adapter: IntercomSignalingAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending = new Map<string, PendingRPC>();
  private adapterGeneration = -1;

  setAdapter(adapter: IntercomSignalingAdapter | null): void {
    if (this.adapter === adapter) return;
    const previousGeneration = this.adapterGeneration;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.adapter = adapter;
    this.adapterGeneration = adapter?.generation ?? -1;
    if (!adapter || (previousGeneration >= 0 && previousGeneration !== adapter.generation) || !adapter.joined) {
      this.rejectAll('Intercom signaling generation changed.');
    }
    if (adapter) this.unsubscribe = adapter.subscribeIntercom((message) => this.onMessage(message));
  }

  notify(type: 'intercom_activity' | 'intercom_private_ready', payload: Record<string, unknown>): boolean {
    const adapter = this.adapter;
    return Boolean(adapter && safeSendIntercom(adapter, { type, payload }));
  }

  request<T extends ServerIntercomEnvelope>(
    type: string,
    payload: Record<string, unknown>,
    expectedType: string,
    timeoutMs = 8_000,
  ): Promise<T> {
    const adapter = this.adapter;
    if (!adapter || !isIntercomTransportReady(adapter)) {
      return Promise.reject(new Error('Intercom signaling is unavailable.'));
    }
    const requestId = createRequestId();
    const message: IntercomEnvelope = { type, requestId, payload };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Intercom ${type} timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, {
        generation: adapter.generation,
        expectedType,
        resolve: (response) => resolve(response as T),
        reject,
        timeout,
      });
      if (!safeSendIntercom(adapter, message)) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(new Error('Intercom message was rejected by the local transport.'));
      }
    });
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.adapter = null;
    this.rejectAll('Intercom client closed.');
  }

  private onMessage(raw: ServerIntercomEnvelope): void {
    const message = parseServerIntercomEnvelope(raw);
    if (!message?.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (pending.generation !== this.adapter?.generation) {
      pending.reject(new Error('Stale intercom response.'));
      return;
    }
    if (message.type === 'intercom_error') {
      const payload = message.payload as { code: string; message: string; retryable: boolean };
      pending.reject(new IntercomRPCError(payload.code, payload.message, payload.retryable));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(new Error(`Unexpected intercom response: ${message.type}.`));
      return;
    }
    pending.resolve(message);
  }

  private rejectAll(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
