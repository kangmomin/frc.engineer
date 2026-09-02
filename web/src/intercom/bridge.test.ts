import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverIntercomBridge } from '../../../apps/setup-manager/src/intercomBridge';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readonly protocols: string[];
  protocol = 'frc-intercom-v1';
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }
}

function installBridgeGlobals(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal('window', {
    electronAPI: { getIntercomBridgeToken: () => Promise.resolve('a'.repeat(64)) },
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
}

function joinBridge(socket: FakeWebSocket): void {
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'intercom_bridge_state',
      payload: { generation: 1, joined: true, intercomVersion: 1 },
    }),
  } as MessageEvent<string>);
}

const activity = {
  type: 'intercom_activity',
  payload: { speaking: false, ptt: false, busEnabled: true },
};

afterEach(() => vi.unstubAllGlobals());

describe('driver intercom bridge invalidation', () => {
  it('invalidates synchronously when the bridge reports an error', async () => {
    installBridgeGlobals();
    const bridge = new DriverIntercomBridge();
    const adapter = bridge.adapter();
    const invalidated = vi.fn();
    adapter.subscribeInvalidation?.(invalidated);
    await bridge.start();
    const socket = FakeWebSocket.instances[0];
    joinBridge(socket);
    socket.onerror?.();
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(adapter.joined).toBe(false);
    bridge.close();
  });

  it('invalidates synchronously during explicit bridge close', async () => {
    installBridgeGlobals();
    const bridge = new DriverIntercomBridge();
    const adapter = bridge.adapter();
    const invalidated = vi.fn();
    adapter.subscribeInvalidation?.(invalidated);
    await bridge.start();
    joinBridge(FakeWebSocket.instances[0]);
    bridge.close();
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(adapter.joined).toBe(false);
  });

  it('invalidates synchronously when the physical bridge is not open', async () => {
    installBridgeGlobals();
    const bridge = new DriverIntercomBridge();
    const adapter = bridge.adapter();
    const invalidated = vi.fn();
    adapter.subscribeInvalidation?.(invalidated);
    await bridge.start();
    const socket = FakeWebSocket.instances[0];
    joinBridge(socket);
    socket.readyState = 0;
    expect(adapter.sendIntercom(activity)).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(adapter.joined).toBe(false);
    bridge.close();
  });

  it('invalidates synchronously when physical send throws', async () => {
    installBridgeGlobals();
    const bridge = new DriverIntercomBridge();
    const adapter = bridge.adapter();
    const invalidated = vi.fn();
    adapter.subscribeInvalidation?.(invalidated);
    await bridge.start();
    const socket = FakeWebSocket.instances[0];
    joinBridge(socket);
    socket.send.mockImplementation(() => { throw new Error('closed'); });
    expect(adapter.sendIntercom(activity)).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(adapter.joined).toBe(false);
    bridge.close();
  });

  it('rejects an invalid outbound DTO without invalidating live authority', async () => {
    installBridgeGlobals();
    const bridge = new DriverIntercomBridge();
    const adapter = bridge.adapter();
    const invalidated = vi.fn();
    adapter.subscribeInvalidation?.(invalidated);
    await bridge.start();
    joinBridge(FakeWebSocket.instances[0]);
    expect(adapter.sendIntercom({ type: 'not_intercom', payload: {} })).toBe(false);
    expect(invalidated).not.toHaveBeenCalled();
    expect(adapter.joined).toBe(true);
    bridge.close();
  });
});
