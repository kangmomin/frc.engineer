// Read-only operator inbox. Authorization is rechecked by HubApp before this
// component mounts; the API remains the security boundary.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';
import { ListingError, PlatformMarket, type PlatformFeedbackEntry } from '../data/platform';
import { FeedbackEntryRow } from '../components/FeedbackEntryRow';

export type InboxState =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: PlatformFeedbackEntry[] }
  | { kind: 'error'; message: string };

interface Props {
  t: HubTheme;
  market: PlatformMarket;
  account: PlatformAccount;
}

export function FeedbackInbox({ t, market, account }: Props) {
  const requestGeneration = useRef(0);
  const [state, setState] = useState<InboxState>({ kind: 'loading' });

  const refresh = useCallback(() => {
    const generation = ++requestGeneration.current;
    setState({ kind: 'loading' });
    void market.listFeedbackInbox()
      .then((entries) => {
        if (generation === requestGeneration.current) setState({ kind: 'ready', entries });
      })
      .catch((error: unknown) => {
        if (generation === requestGeneration.current) setState({ kind: 'error', message: messageOf(error) });
      });
  }, [market]);

  // Account or grant snapshots discard both prior state and any late response.
  // HubApp unmounts this screen outright when access is revoked.
  useEffect(() => {
    refresh();
    return () => { requestGeneration.current += 1; };
  }, [account.id, account.permissions, refresh]);

  return <FeedbackInboxPresentation t={t} state={state} onRetry={refresh} />;
}

export function FeedbackInboxPresentation({ t, state, onRetry }: {
  t: HubTheme;
  state: InboxState;
  onRetry: () => void;
}) {
  return (
    <section style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>피드백 인박스</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>최신 등록 의견 100건 · 읽기 전용</div>
      </div>
      <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20 }}>
        {state.kind === 'loading' && <div role="status" aria-live="polite" style={muted(t)}>불러오는 중…</div>}
        {state.kind === 'error' && (
          <div role="alert" style={{ color: t.negRed, fontSize: 12.5, lineHeight: 1.6 }}>
            <div>{state.message}</div>
            <button onClick={onRetry} style={retryButton(t)}>다시 시도</button>
          </div>
        )}
        {state.kind === 'ready' && state.entries.length === 0 && (
          <div role="status" style={muted(t)}>등록된 의견이 없습니다.</div>
        )}
        {state.kind === 'ready' && state.entries.length > 0 && (
          <div role="list" aria-label="피드백 인박스" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.entries.map((entry) => <FeedbackEntryRow key={entry.id} t={t} entry={entry} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function muted(t: HubTheme): React.CSSProperties {
  return { fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: t.t3 };
}

function retryButton(t: HubTheme): React.CSSProperties {
  return { marginTop: 10, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, padding: '7px 10px', border: `1px solid ${t.line2}`, borderRadius: 6, background: t.inset, color: t.t1, cursor: 'pointer' };
}

function messageOf(error: unknown): string {
  return error instanceof ListingError ? error.message : '피드백 인박스를 불러오지 못했습니다';
}
