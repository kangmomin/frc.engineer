import { afterEach, describe, expect, it, vi } from '../../../web/node_modules/vitest/dist/index.js';
import { fetchJsonWithSenderDebug } from '../src/senderDebug';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sender debug fetch', () => {
  it('rejects malformed JSON200 and reports it to the sender client log', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.includes('client-log') ? new Response('{}') : new Response('bad json'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJsonWithSenderDebug('http://test', '/api/status', 'sender-status')).rejects.toThrow('invalid JSON');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/debug/client-log'))).toBe(true);
  });
  it('allows listed statuses and treats an empty body as null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(fetchJsonWithSenderDebug('http://test/', '/api/races/latest', 'latest', { allowStatuses: [404] })).resolves.toEqual({ status: 404, data: null });
  });
  it('forwards AbortSignal without logging expected cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const aborted = new DOMException('Aborted', 'AbortError');
    const mock = vi.fn().mockRejectedValue(aborted); vi.stubGlobal('fetch', mock);
    await expect(fetchJsonWithSenderDebug('http://test', '/trace', 'test', { init: { signal: controller.signal } })).rejects.toBe(aborted);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
