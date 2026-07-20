// Feedback screen — send bug reports / suggestions to the platform and track
// their status. Same shell as Profile.tsx (title header + Card) and the same
// form conventions as MarketManage.tsx's ReviewForm (busy/msg + textarea).
import { useCallback, useEffect, useState } from 'react';
import type { HubTheme } from '../theme';
import { relativeTime } from '../format';
import {
  PlatformMarket, ListingError,
  type FeedbackCategory, type PlatformFeedbackEntry,
} from '../data/platform';
import type { PlatformAccount } from '../data/session';
import { SelectChip } from '../components/SelectChip';
import type { SelectOption } from '../components/SelectChip';

const MONO = "'JetBrains Mono',monospace";

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'bug', label: '버그' },
  { value: 'suggestion', label: '제안' },
  { value: 'other', label: '기타' },
];

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '버그',
  suggestion: '제안',
  other: '기타',
};

interface Props {
  t: HubTheme;
  configured: boolean;
  account: PlatformAccount | null;
  market: PlatformMarket;
}

export function Feedback({ t, configured, account, market }: Props) {
  const [entries, setEntries] = useState<PlatformFeedbackEntry[] | null>(null);
  const [listErr, setListErr] = useState('');

  const refresh = useCallback(() => {
    market.listMyFeedback()
      .then((rows) => setEntries(rows))
      .catch((e: unknown) => setListErr(msgOf(e)));
  }, [market]);

  useEffect(() => {
    if (!configured || !account) { setEntries(null); return; }
    refresh();
  }, [configured, account, refresh]);

  return (
    <section style={{ maxWidth: 620 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>의견 보내기</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>버그 제보 · 기능 제안 · 처리 상태 확인</div>
      </div>

      {!configured ? (
        <Card t={t}>
          <div style={{ fontSize: 13.5, color: t.t2, lineHeight: 1.6 }}>
            플랫폼 서비스가 설정되지 않았습니다. <code style={{ fontFamily: MONO, fontSize: 12, color: t.accInk }}>VITE_PLATFORM_URL</code> 이 지정되면
            의견 보내기가 활성화됩니다.
          </div>
        </Card>
      ) : !account ? (
        <Card t={t}>
          <div style={{ fontSize: 13.5, color: t.t2, lineHeight: 1.6 }}>
            PROFILE에서 Steam 로그인하면 의견을 보낼 수 있습니다.
          </div>
        </Card>
      ) : (
        <>
          <FeedbackForm t={t} market={market} onSubmitted={refresh} />
          <Card t={t} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.t1, marginBottom: 10 }}>내 의견</div>
            {listErr && <div style={{ fontSize: 11.5, color: t.negRed, marginBottom: 8 }}>{listErr}</div>}
            {entries == null ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>불러오는 중…</div>
            ) : entries.length === 0 ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>아직 보낸 의견이 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entries.map((e) => (
                  <FeedbackRow key={e.id} t={t} entry={e} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function FeedbackForm({ t, market, onSubmitted }: { t: HubTheme; market: PlatformMarket; onSubmitted: () => void }) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = () => {
    setBusy(true); setMsg(null);
    market.submitFeedback({ category, body: body.trim() })
      .then(() => { setMsg({ text: '의견이 접수되었습니다.', ok: true }); setBody(''); onSubmitted(); })
      .catch((e: unknown) => setMsg({ text: msgOf(e), ok: false }))
      .finally(() => setBusy(false));
  };

  return (
    <Card t={t}>
      <div style={{ fontSize: 14, fontWeight: 700, color: t.t1, marginBottom: 10 }}>새 의견 작성</div>
      <div style={{ marginBottom: 10 }}>
        <SelectChip t={t} label="분류" value={category} options={CATEGORY_OPTIONS}
          onChange={(v) => setCategory(v as FeedbackCategory)} />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        placeholder="겪은 문제나 제안을 적어주세요"
        style={{ ...inputStyle(t), minHeight: 120, resize: 'vertical' }}
      />
      {msg && <div style={{ fontSize: 11.5, color: msg.ok ? t.ok : t.negRed, margin: '6px 0' }}>{msg.text}</div>}
      <button onClick={submit} disabled={busy || body.trim() === ''}
        style={{ ...primaryBtn(t), width: '100%', opacity: busy || body.trim() === '' ? 0.5 : 1, cursor: busy || body.trim() === '' ? 'not-allowed' : 'pointer', marginTop: 4 }}>
        {busy ? '전송 중…' : '의견 보내기'}
      </button>
    </Card>
  );
}

function FeedbackRow({ t, entry }: { t: HubTheme; entry: PlatformFeedbackEntry }) {
  return (
    <div style={{ padding: '10px 12px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.accInk, background: t.accSoft, border: `1px solid ${t.accBorder}`, borderRadius: 4, padding: '2px 6px' }}>
          {CATEGORY_LABEL[entry.category] ?? entry.category}
        </span>
        <StatusBadge t={t} status={entry.status} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>{relativeTime(Date.parse(entry.createdAt), Date.now())}</span>
      </div>
      <div style={{ fontSize: 12.5, color: t.t2, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{entry.body}</div>
    </div>
  );
}

function StatusBadge({ t, status }: { t: HubTheme; status: string }) {
  const style = statusStyle(t, status);
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span style={{
      fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.05em',
      color: style.fg, background: style.bg, border: `1px solid ${style.border}`,
      borderRadius: 4, padding: '2px 6px',
    }}>
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: '접수됨',
  in_progress: '처리 중',
  resolved: '해결됨',
  dismissed: '반려됨',
};

function statusStyle(t: HubTheme, status: string): { fg: string; bg: string; border: string } {
  switch (status) {
    case 'in_progress':
      return { fg: t.accInk, bg: t.accSoft, border: t.accSoft };
    case 'resolved':
      return { fg: t.onAcc, bg: t.ok, border: t.ok };
    case 'dismissed':
      return { fg: t.t3, bg: t.panel2, border: t.line2 };
    case 'open':
    default:
      return { fg: t.t2, bg: t.panel2, border: t.line2 };
  }
}

function Card({ t, children, style }: { t: HubTheme; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function inputStyle(t: HubTheme): React.CSSProperties {
  return { width: '100%', boxSizing: 'border-box', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, padding: '9px 11px', fontSize: 13, color: t.t1, marginBottom: 4, fontFamily: 'inherit' };
}

function primaryBtn(t: HubTheme): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: '9px 16px', border: 0, borderRadius: 8, background: t.acc, color: t.onAcc, cursor: 'pointer' };
}

function msgOf(e: unknown): string {
  return e instanceof ListingError ? e.message : '오류가 발생했습니다';
}
