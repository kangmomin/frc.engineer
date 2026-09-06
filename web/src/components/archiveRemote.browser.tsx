import { createRoot } from 'react-dom/client';
import { RaceArchiveDrawer } from './races/RaceArchiveDrawer';
import type { RaceArchiveDataSource } from './races/replayArchive';
import { RemoteConnect } from './remote/RemoteConnect';
import { useTelemetryStore } from '../store/telemetryStore';
import type { ReplayFrame, ReplayStreamMeta } from '../types/telemetry';

const wait = () => new Promise<void>((resolve) => window.setTimeout(resolve, 10));

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    check(Date.now() < deadline, message);
    await wait();
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  check(found, `Missing button: ${label}`);
  return found;
}

async function replayRetry(): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let replayRequests = 0;
  const source: RaceArchiveDataSource = {
    listRaces: async () => [{
      id: 'retry-race', savedAtLocal: '2026-09-05', trackName: 'Retry Track', sessionType: 'Race',
      playerName: 'Driver', finalPosition: 1, fileSizeBytes: 100, dataStorageMode: 'advanced', hasReplay: true,
    }],
    loadSummary: async () => { throw new Error('Replay must not load a summary.'); },
    loadReplay: async () => {
      if (++replayRequests === 1) throw new Error('Transient replay failure');
      return { meta: { type: 'meta', frameIntervalMs: 100 }, frames: [] };
    },
  };
  try {
    root.render(<RaceArchiveDrawer dataSource={source} onClose={() => {}} />);
    await until(() => container.textContent!.includes('Retry Track'), 'Archive list did not load.');
    button(container, 'Retry Track').click();
    await until(() => container.textContent!.includes('Transient replay failure'), 'Replay failure was not shown.');
    button(container, 'Archive').click();
    await until(() => container.textContent!.includes('Saved Races'), 'Archive did not reopen.');
    button(container, 'Retry Track').click();
    await until(() => replayRequests === 2, 'Selecting the failed replay again did not retry it.');
    await until(() => container.textContent!.includes('Replay stream contained no frames.'), 'Retried replay did not finish loading.');
    check(!container.textContent!.includes('Transient replay failure'), 'Replay retry retained the old error.');
  } finally {
    root.unmount();
    container.remove();
  }
}

async function roomRequests(): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const nativeFetch = window.fetch;
  const requests: {
    url: string;
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }[] = [];
  // Deliberately finish even aborted requests: guards must cover late JSON,
  // errors and finally handlers, not only cooperative network cancellation.
  window.fetch = (input, init) => new Promise<Response>((resolve, reject) => {
    requests.push({ url: String(input), signal: init?.signal, resolve, reject });
  });
  const joined: { current: { signalingUrl: string; roomId: string; password: string } | null } = { current: null };
  const render = (url: string) => root.render(
    <RemoteConnect initialSignalingUrl={url} initialRoomId="second" initialPassword="secret"
      connectionState="disconnected" onConnect={(options) => { joined.current = options; }} />,
  );
  const rooms = (server: string) => [
    { roomId: 'first', roomCode: '111111', roomName: `${server} First`, requiresPassword: true, engineerCount: 0 },
    { roomId: 'second', roomCode: '222222', roomName: `${server} Second`, requiresPassword: true, engineerCount: 0 },
  ];
  const respond = (index: number, server: string) => requests[index].resolve(new Response(JSON.stringify(rooms(server))));
  const noStaleRooms = (label: string) => {
    check(button(container, 'Join Room').disabled, `${label}: a stale room could be joined.`);
    check(!container.querySelector('strong'), `${label}: stale rooms remained available.`);
  };
  try {
    render('wss://a.invalid/ws');
    await until(() => requests.length === 1, 'Server A request did not start.');
    render('wss://b.invalid/ws');
    await until(() => requests.length === 2, 'Server B request did not start.');
    check(requests[1].url === 'https://b.invalid/api/rooms', 'Wrong server B endpoint.');
    respond(1, 'B');
    await until(() => container.textContent!.includes('B Second'), 'Server B rooms did not load.');
    respond(0, 'A');
    await wait();
    check(!container.textContent!.includes('A First'), 'Late server A response replaced server B.');
    check(requests[0].signal?.aborted, 'URL change did not cancel server A.');
    button(container, 'Refresh').click();
    await until(() => requests.length === 3, 'Refresh did not start.');
    noStaleRooms('Refresh');
    respond(2, 'B');
    await until(() => !button(container, 'Join Room').disabled, 'Refreshed room was not ready.');
    button(container, 'Join Room').click();
    check(joined.current !== null && joined.current.roomId === 'second' && joined.current.password === 'secret'
      && joined.current.signalingUrl === 'wss://b.invalid/ws', 'Same-server refresh lost selection/password.');

    button(container, 'Refresh').click();
    await until(() => requests.length === 4, 'Second refresh did not start.');
    render('wss://c.invalid/ws');
    await until(() => requests.length === 5, 'Server C request did not start.');
    check(requests[3].signal?.aborted, 'URL change did not cancel the pending refresh.');
    requests[3].reject(new Error('Late server B failure'));
    await wait();
    noStaleRooms('Server change');
    check(container.textContent!.includes('Loading active rooms...'), 'Old finally cleared the new loading state.');
    check(!container.textContent!.includes('Failed to load room list'), 'Old failure replaced the new request state.');
    respond(4, 'C');
    await until(() => container.textContent!.includes('C Second'), 'Server C rooms did not load.');

    button(container, 'Refresh').click();
    await until(() => requests.length === 6, 'Third refresh did not start.');
    render('invalid');
    await until(() => container.textContent!.includes('Invalid signaling URL.'), 'Invalid URL was not reported.');
    check(requests[5].signal?.aborted, 'Invalid URL did not cancel the pending request.');
    respond(5, 'Stale');
    await wait();
    noStaleRooms('Invalid URL');
    check(container.textContent!.includes('Invalid signaling URL.'), 'Late success cleared the invalid URL error.');
    check(!container.textContent!.includes('Loading active rooms...'), 'Invalid URL left loading active.');

    render('wss://d.invalid/ws');
    await until(() => requests.length === 7, 'Unmount request did not start.');
    root.unmount();
    check(requests[6].signal?.aborted, 'Unmount did not cancel the request.');
    respond(6, 'Unmounted');
    await wait();
    check(container.childElementCount === 0, 'Late unmounted response rendered UI.');
  } finally {
    root.unmount();
    container.remove();
    window.fetch = nativeFetch;
  }
}

async function replaySourceOrdering(): Promise<void> {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const pending = new Map<string, { signal?: AbortSignal; resolve: (bundle: { meta: ReplayStreamMeta | null; frames: ReplayFrame[] }) => void }>();
  const source: RaceArchiveDataSource = {
    listRaces: async () => ['A', 'B', 'C'].map((id) => ({
      id, savedAtLocal: '2026-09-06', trackName: `Track ${id}`, sessionType: 'Race', playerName: id,
      finalPosition: 1, fileSizeBytes: 100, dataStorageMode: 'advanced', hasReplay: true,
    })),
    loadSummary: async () => { throw new Error('Replay must not load a summary.'); },
    loadReplay: (id, signal) => new Promise((resolve) => { pending.set(id, { signal, resolve }); }),
  };
  const frame = (id: string): ReplayFrame => ({
    timestamp: 1,
    pitwall: { sessionUid: id, session: null, drivers: [], positions: [], playerIndex: -1, ersEstimateEnabled: false, ersComparisonEnabled: false },
  });
  const store = useTelemetryStore.getState(); store.resetRoom();
  const seen: { source: string; uid?: string }[] = [];
  const unsubscribe = useTelemetryStore.subscribe((s) => {
    if (s.replayContext) seen.push({ source: s.replayContext.sourceId, uid: s.pitwallState?.sessionUid });
  });
  const select = async (id: string, reopen = true) => {
    if (reopen) button(container, 'Archive').click();
    await until(() => container.textContent!.includes(`Track ${id}`), 'Archive did not open.');
    button(container, `Track ${id}`).click();
    await until(() => pending.has(id), `Replay ${id} request did not start.`);
  };
  try {
    root.render(<RaceArchiveDrawer dataSource={source} onClose={() => {}} />);
    await select('A', false);
    pending.get('A')!.resolve({ meta: null, frames: [frame('A')] });
    await until(() => useTelemetryStore.getState().replayContext?.sourceId === 'A', 'Archive A was not displayed.');
    await select('B');
    await wait();
    check(seen.every((item) => item.source === item.uid), 'Pending B relabeled loaded A frames as B.');
    await select('C');
    check(pending.get('B')!.signal?.aborted, 'Archive switch did not cancel B.');
    pending.get('C')!.resolve({ meta: null, frames: [frame('C')] });
    await until(() => useTelemetryStore.getState().replayContext?.sourceId === 'C', 'Archive C was not displayed.');
    pending.get('B')!.resolve({ meta: null, frames: [frame('B')] });
    await wait();
    check(useTelemetryStore.getState().replayContext?.sourceId === 'C', 'Late B replaced C.');
    check(seen.every((item) => item.source === item.uid), 'Replay frame provenance mismatched its archive.');
  } finally { unsubscribe(); root.unmount(); container.remove(); store.resetRoom(); }
}

export async function run(): Promise<string> {
  await replayRetry();
  await replaySourceOrdering();
  await roomRequests();
  return 'PASS: real Chrome/React replay retry/provenance, room response ordering, refresh, stale errors/loading, invalid URL and unmount.';
}
