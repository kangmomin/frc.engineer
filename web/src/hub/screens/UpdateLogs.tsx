import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubTheme } from '../theme';
import { ListingError, PlatformMarket, type PlatformUpdateLogPage } from '../data/platform';
import type { PlatformAccount } from '../data/session';
import { canCreateUpdateLog } from '../data/permissions';

interface Props {
  t: HubTheme;
  active: boolean;
  configured: boolean;
  account: PlatformAccount | null;
  ready: boolean;
  market: PlatformMarket;
  viewOnly?: boolean;
}

// The Hub keys this persistent component by account + session epoch. Navigation
// keeps its modal state; replacing the session discards every pending response.
export function UpdateLogs({ t, active, configured, account, ready, market, viewOnly = false }: Props) {
  const enabled = configured && !!account && !account.banned && ready;
  const [page, setPage] = useState<PlatformUpdateLogPage | null>(null);
  const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seenError, setSeenError] = useState('');
  const [seenRetry, setSeenRetry] = useState(0);
  const [acknowledged, setAcknowledged] = useState('');
  const checked = useRef(false);
  const requestGeneration = useRef(0);
  const alive = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestGeneration.current += 1; };
  }, []);

  const refresh = useCallback(async (autoOpen = false) => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError('');
    try {
      const next = await market.listUpdateLogs();
      if (!alive.current || generation !== requestGeneration.current) return;
      checked.current = true;
      setPage(next);
      if (autoOpen && next.hasUnseen) setModal(true);
    } catch (err) {
      if (alive.current && generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (alive.current && generation === requestGeneration.current) setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    if (!enabled) return;
    if (active || (!checked.current && !viewOnly)) {
      void refresh(!active && !viewOnly);
    }
    return () => { requestGeneration.current += 1; };
  }, [enabled, active, viewOnly, refresh]);

  useEffect(() => {
    const element = dialog.current;
    if (!modal || !enabled || active || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); previousFocus?.focus(); };
  }, [modal, enabled, active]);

  // Fetching in the background is not a view. Wait until the list is rendered
  // in a visible tab, then acknowledge only its original first-page revision.
  useEffect(() => {
    if (!enabled || viewOnly || (!active && !modal) || !page?.items.length || page.latestRevision === acknowledged) return;
    const revision = page.latestRevision;
    const controller = new AbortController();
    let sent = false;
    const acknowledge = () => {
      if (document.visibilityState !== 'visible' || sent) return;
      sent = true;
      setSeenError('');
      void market.markUpdateLogsSeen(revision, controller.signal).then(() => {
        if (!controller.signal.aborted) setAcknowledged(revision);
      }).catch(() => {
        if (!controller.signal.aborted) setSeenError('열람 상태를 저장하지 못했습니다. 다음 접속 시 다시 표시될 수 있습니다.');
      });
    };
    const frame = requestAnimationFrame(acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
      document.removeEventListener('visibilitychange', acknowledge);
    };
  }, [enabled, viewOnly, active, modal, page, acknowledged, market, seenRetry]);

  const loadOlder = async () => {
    if (!page?.nextBefore || loading) return;
    const generation = ++requestGeneration.current;
    setLoading(true); setError('');
    try {
      const older = await market.listUpdateLogs(page.nextBefore);
      if (!alive.current || generation !== requestGeneration.current) return;
      // Keep the original latestRevision: older's snapshot may contain a new
      // publication that this list has never displayed.
      setPage({ ...page, items: [...page.items, ...older.items], nextBefore: older.nextBefore });
    } catch (err) {
      if (alive.current && generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (alive.current && generation === requestGeneration.current) setLoading(false);
    }
  };

  const content = (
    <>
      <h2 id="update-logs-title" style={{ margin: '0 0 6px', fontSize: 20, color: t.t1 }}>업데이트 로그</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: t.t2 }}>새로 추가된 기능과 개선 사항을 확인하세요. UPDATES에서 언제든 다시 볼 수 있습니다.</p>
      {error && <div role="alert" style={{ color: t.negRed, marginBottom: 12 }}>{error} <button onClick={() => void refresh()} style={buttonStyle(t)}>다시 시도</button></div>}
      {seenError && <div role="alert" style={{ color: t.negRed, marginBottom: 12 }}>{seenError} <button onClick={() => setSeenRetry((n) => n + 1)} style={buttonStyle(t)}>열람 저장 재시도</button></div>}
      {loading && <p role="status" style={{ color: t.t2 }}>불러오는 중…</p>}
      {page?.items.length === 0 && <p role="status" style={{ color: t.t2 }}>아직 등록된 업데이트가 없습니다.</p>}
      <div role="list" aria-label="업데이트 목록" style={{ display: 'grid', gap: 12 }}>
        {page?.items.map((entry) => (
          <article key={entry.id} role="listitem" style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, overflowWrap: 'anywhere' }}>
            <time dateTime={entry.publishedAt} style={{ fontSize: 12, color: t.t3 }}>{new Date(entry.publishedAt).toLocaleDateString('ko-KR')}</time>
            <h3 style={{ fontSize: 16, margin: '8px 0 12px', color: t.t1 }}>{entry.title}</h3>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.7, color: t.t2 }}>{entry.body}</div>
          </article>
        ))}
      </div>
      {page?.nextBefore && <button disabled={loading} onClick={() => void loadOlder()} style={{ ...buttonStyle(t), marginTop: 14 }}>이전 업데이트 더 보기</button>}
    </>
  );

  if (!active && (!modal || !enabled)) return null;
  if (active) return (
    <section style={{ maxWidth: 760 }}>
      {!configured ? <p>업데이트 로그 서비스를 사용할 수 없습니다.</p>
        : !account ? <p>PROFILE에서 Steam 로그인하면 업데이트 로그를 볼 수 있습니다.</p>
          : account.banned ? <p>업데이트 로그를 이용할 수 없는 계정입니다.</p>
            : <>
              {content}
              <button disabled={loading || !enabled} onClick={() => void refresh()} style={{ ...buttonStyle(t), marginTop: 14 }}>최신 목록 새로고침</button>
              {!viewOnly && enabled && canCreateUpdateLog(account) && <PublishForm t={t} market={market} onPublished={() => void refresh()} />}
            </>}
    </section>
  );
  return (
    <dialog ref={dialog} className="hubUpdateDialog" aria-labelledby="update-logs-title" onCancel={() => setModal(false)}
      style={{ width: 'min(720px, calc(100vw - 48px))', maxHeight: '80vh', boxSizing: 'border-box', overflowY: 'auto', background: t.bg, color: t.t1, border: `1px solid ${t.line}`, borderRadius: 16, padding: 24, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button autoFocus onClick={() => setModal(false)} style={buttonStyle(t)}>닫기</button></div>
      {content}
    </dialog>
  );
}

function PublishForm({ t, market, onPublished }: { t: HubTheme; market: PlatformMarket; onPublished: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await market.createUpdateLog({ title: title.trim(), body: body.trim() });
      if (!alive.current) return;
      setTitle(''); setBody(''); setMessage('업데이트를 등록했습니다.'); onPublished();
    } catch (err) {
      if (alive.current) setMessage(messageOf(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const input: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', margin: '6px 0 14px', padding: 10, border: `1px solid ${t.line}`, borderRadius: 8, background: t.inset, color: t.t1, font: 'inherit' };
  return (
    <form onSubmit={(event) => void publish(event)} style={{ marginTop: 28, padding: 20, border: `1px solid ${t.line}`, borderRadius: 12, background: t.panel }}>
      <h3 style={{ marginTop: 0 }}>업데이트 등록</h3>
      <p style={{ fontSize: 13, color: t.t2 }}>등록 즉시 공개되며, 아직 확인하지 않은 회원에게 다음 접속 시 표시됩니다.</p>
      <label>제목<input required maxLength={120} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} style={input} /></label>
      <label>내용<textarea required maxLength={10000} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} style={{ ...input, minHeight: 160, resize: 'vertical' }} /></label>
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy || !title.trim() || !body.trim()} style={buttonStyle(t)}>{busy ? '등록 중…' : '업데이트 등록'}</button>
    </form>
  );
}

function buttonStyle(t: HubTheme): React.CSSProperties {
  return { border: `1px solid ${t.line}`, borderRadius: 8, padding: '9px 14px', background: t.panel2, color: t.t1, cursor: 'pointer', font: 'inherit', fontSize: 13 };
}

function messageOf(err: unknown): string {
  return err instanceof ListingError ? err.message : '업데이트 로그를 불러오지 못했습니다.';
}
