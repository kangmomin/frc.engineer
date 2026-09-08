import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'vite';

// Uses Chrome's real React/RTC lifecycle. Set CHROME_BIN when Chrome is not on PATH.
const profile = await mkdtemp(join(tmpdir(), 'frc-webrtc-test-'));
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'webrtc-browser-harness',
    configureServer(devServer) {
      devServer.middlewares.use('/__webrtc-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await devServer.transformIndexHtml('/__webrtc-test', '<!doctype html><html><body></body></html>'));
      });
    },
  }],
});
let chrome;
let socket;
async function runBrowser() {
  await server.listen();
  const chromeReady = new Promise((resolve, reject) => {
    chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.once('error', reject);
    chrome.once('exit', (code) => reject(new Error(`Chrome exited before startup: ${code}`)));
    let output = '';
    chrome.stderr.on('data', (chunk) => {
      output += chunk;
      const endpoint = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (endpoint) resolve(endpoint);
    });
  });
  const endpoint = new URL(await chromeReady);
  const target = await fetch(`http://${endpoint.host}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Chrome disconnected.'));
    pending.clear();
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable');
  const loaded = new Promise((resolve) => {
    socket.addEventListener('message', function listener({ data }) {
      if (JSON.parse(data).method !== 'Page.loadEventFired') return;
      socket.removeEventListener('message', listener);
      resolve();
    });
  });
  await call('Page.navigate', { url: `${server.resolvedUrls.local[0]}__webrtc-test` });
  await loaded;
  const suites = process.argv.slice(2);
  for (const suite of suites.length ? suites : ['/src/hooks/useWebRTCDataChannel.browser.tsx', '/src/components/archiveRemote.browser.tsx', '/src/intercom/runtime.browser.ts', '/src/views/qualifying/qualifying.browser.tsx']) {
    const result = await call('Runtime.evaluate', {
      expression: `import(${JSON.stringify(suite)}).then(m => m.run())`,
      awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    console.log(result.result.value);
  }
}

let deadline;
try {
  await Promise.race([
    runBrowser(),
    new Promise((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Chrome WebRTC regression timed out.')), 90_000);
    }),
  ]);
} finally {
  clearTimeout(deadline);
  socket?.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = once(chrome, 'exit');
    const forceStop = setTimeout(() => chrome.kill('SIGKILL'), 3_000);
    chrome.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(forceStop); }
  }
  await server.close();
  // Chrome helpers can finish their final profile writes just after browser exit.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
