import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateLogs } from './UpdateLogs';
import { buildTheme } from '../theme';
import { PlatformMarket, type PlatformUpdateLogPage } from '../data/platform';

const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 4000;
  while (!predicate()) { check(performance.now() < deadline, message); await wait(); }
}
function click(container: HTMLElement, label: string) {
  const element = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
  check(element, `Missing button: ${label}`); element.click();
}

export async function run() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const market = new PlatformMarket();
  const t = buildTheme('#e0a83d', 'light');
  let identity = 'a';
  let epoch = 0;
  let revision = '2';
  let listCalls = 0;
  let failSeen = false;
  let failList = false;
  let created = '';
  const seen = new Map<string, string>();
  const acknowledgments: string[] = [];
  const snapshot = (id = revision): PlatformUpdateLogPage => ({
    latestRevision: id, hasUnseen: seen.get(identity) !== id,
    items: [{ id, title: `업데이트 ${id}`, body: '<script>alert("unsafe")</script>\n기능 개선', publishedAt: '2026-09-08T00:00:00Z' }],
    nextBefore: id,
  });
  const list = async (before?: string): Promise<PlatformUpdateLogPage> => {
    listCalls += 1;
    if (failList) throw new Error('offline');
    if (before) return { latestRevision: '99', hasUnseen: true, items: [{ id: '1', title: '이전 업데이트', body: 'old', publishedAt: '2026-09-01T00:00:00Z' }] };
    return snapshot();
  };
  market.listUpdateLogs = list;
  market.markUpdateLogsSeen = async (id) => {
    acknowledgments.push(`${identity}:${id}`);
    if (failSeen) throw new Error('offline');
    seen.set(identity, id);
  };
  market.createUpdateLog = async (input) => {
    created = `${input.title}/${input.body}`;
    revision = '4';
    return { ...input, id: revision, publishedAt: '2026-09-08T01:00:00Z' };
  };
  const render = (active = false, viewOnly = false, admin = false, anonymous = false) => {
    root.render(<StrictMode><UpdateLogs key={`${identity}:${epoch}`} t={t} active={active} configured ready market={market} viewOnly={viewOnly}
      account={anonymous ? null : { id: identity, steamId64: '0', persona: identity, avatarUrl: '', kind: 'user', verified: true, banned: false, createdAt: '', permissions: admin ? ['pithub'] : [] }} /></StrictMode>);
  };
  try {
    render(false, false, false, true);
    await wait(60);
    check(listCalls === 0 && !container.querySelector('dialog'), 'Anonymous visit fetched/acknowledged logs.');
    epoch++; render();
    await until(() => !!container.querySelector('dialog[open]'), 'Unseen logs did not open in StrictMode.');
    await until(() => seen.get('a') === '2', 'Displayed modal was not acknowledged.');
    check(document.activeElement?.textContent === '닫기', 'Modal did not receive keyboard focus.');
    check(!container.querySelector('script') && container.textContent?.includes('<script>'), 'Content was rendered as executable HTML.');
    click(container, '닫기');
    await until(() => !container.querySelector('dialog'), 'Close did not dismiss modal.');
    epoch++; render();
    await wait(100);
    check(!container.querySelector('dialog'), 'Previously seen logs reopened on next visit.');
    render(true);
    await until(() => !!container.querySelector('[aria-label="업데이트 목록"] article'), 'Manual history did not render.');
    check(!container.querySelector('form'), 'Regular user received publication form.');
    click(container, '이전 업데이트 더 보기');
    await until(() => container.textContent?.includes('이전 업데이트') === true, 'Older history did not load.');
    await wait(40);
    check(!acknowledgments.some((value) => value.endsWith(':99')), 'Older page acknowledged an undisplayed latest revision.');

    revision = '3'; epoch++; render();
    await until(() => !!container.querySelector('dialog[open]') && seen.get('a') === '3', 'New publication did not re-notify.');
    container.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
    await until(() => !container.querySelector('dialog'), 'Escape/cancel did not dismiss modal.');

    // A late response from the old account must neither open nor acknowledge.
    let releaseOld: ((page: PlatformUpdateLogPage) => void) | undefined;
    market.listUpdateLogs = () => new Promise((resolve) => { releaseOld = resolve; });
    identity = 'old'; epoch++; render();
    await until(() => !!releaseOld, 'Old account request did not start.');
    market.listUpdateLogs = async () => ({ latestRevision: '0', hasUnseen: false, items: [] });
    identity = 'new'; epoch++; render();
    await wait(40);
    releaseOld?.(snapshot('7'));
    await wait(80);
    check(!container.querySelector('dialog') && !acknowledgments.some((value) => value.endsWith(':7')), 'Old account response leaked into the new session.');

    market.listUpdateLogs = list;
    identity = 'subject'; epoch++;
    const readsBeforeViewAs = listCalls;
    const writesBeforeViewAs = acknowledgments.length;
    render(false, true, true);
    await wait(60);
    check(listCalls === readsBeforeViewAs && !container.querySelector('dialog'), 'View As auto-opened logs.');
    render(true, true, true);
    await until(() => !!container.querySelector('article'), 'View As manual reading failed.');
    await wait(40);
    check(acknowledgments.length === writesBeforeViewAs && !container.querySelector('form'), 'View As changed seen state or offered publication.');

    identity = 'retry'; epoch++; failSeen = true; render();
    await until(() => container.textContent?.includes('열람 저장 재시도') === true, 'Seen failure was not shown.');
    failSeen = false;
    click(container, '열람 저장 재시도');
    await until(() => seen.get('retry') === '3', 'Seen retry did not persist.');

    identity = 'operator'; epoch++; failList = true; render(true, false, true);
    await until(() => container.textContent?.includes('다시 시도') === true, 'Load error was not visible.');
    failList = false; click(container, '다시 시도');
    await until(() => !!container.querySelector('article'), 'List retry failed.');
    const title = container.querySelector('input');
    const body = container.querySelector('textarea');
    check(title && body, 'Operator publication form missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, '새 기능');
    title.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(body, '등록 내용');
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    click(container, '업데이트 등록');
    await until(() => created === '새 기능/등록 내용' && container.textContent?.includes('업데이트 4') === true, 'Publication did not refresh the list.');
    await until(() => seen.get('operator') === '4', 'Published list was not acknowledged.');
    return 'Update logs: automatic/manual reading, repeat visits, new publication, pagination snapshot, session isolation, View As, retries, operator form, plain text and StrictMode passed.';
  } finally {
    root.unmount();
    container.remove();
  }
}
