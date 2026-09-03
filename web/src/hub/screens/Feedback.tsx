// Feedback screen — send bug reports / suggestions to the platform and track
// their status. Same shell as Profile.tsx (title header + Card) and the same
// form conventions as MarketManage.tsx's ReviewForm (busy/msg + textarea).
import { useCallback, useEffect, useState } from 'react';
import type { HubTheme } from '../theme';
import {
  PlatformMarket, ListingError,
  type FeedbackCategory, type PlatformFeedbackEntry,
} from '../data/platform';
import type { PlatformAccount } from '../data/session';
import { SelectChip } from '../components/SelectChip';
import type { SelectOption } from '../components/SelectChip';
import { FeedbackEntryRow } from '../components/FeedbackEntryRow';

const MONO = "'JetBrains Mono',monospace";

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'bug', label: '버그' },
  { value: 'suggestion', label: '제안' },
  { value: 'other', label: '기타' },
];

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
              <div role="list" aria-label="내 피드백" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entries.map((e) => (
                  <FeedbackEntryRow key={e.id} t={t} entry={e} />
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
