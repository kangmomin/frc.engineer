// Shared read-only feedback presentation. Both a submitter's history and the
// operator inbox use the same deliberately identity-free row.
import type { HubTheme } from '../theme';
import { relativeTime } from '../format';
import type { FeedbackCategory, FeedbackStatus, PlatformFeedbackEntry } from '../data/platform';

const MONO = "'JetBrains Mono',monospace";

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '버그',
  suggestion: '제안',
  other: '기타',
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '접수됨',
  in_progress: '처리 중',
  resolved: '해결됨',
  dismissed: '반려됨',
};

export function FeedbackEntryRow({ t, entry }: { t: HubTheme; entry: PlatformFeedbackEntry }) {
  return (
    <article role="listitem" style={{ padding: '10px 12px', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.05em', color: t.accInk, background: t.accSoft, border: `1px solid ${t.accBorder}`, borderRadius: 4, padding: '2px 6px' }}>
          {CATEGORY_LABEL[entry.category]}
        </span>
        <StatusBadge t={t} status={entry.status} />
        <time dateTime={entry.createdAt} style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: t.t3 }}>
          {relativeTime(Date.parse(entry.createdAt), Date.now())}
        </time>
      </div>
      <div style={{ fontSize: 12.5, color: t.t2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>
        {entry.body}
      </div>
    </article>
  );
}

function StatusBadge({ t, status }: { t: HubTheme; status: FeedbackStatus }) {
  const style = statusStyle(t, status);
  return (
    <span style={{
      fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.05em',
      color: style.fg, background: style.bg, border: `1px solid ${style.border}`,
      borderRadius: 4, padding: '2px 6px',
    }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function statusStyle(t: HubTheme, status: FeedbackStatus): { fg: string; bg: string; border: string } {
  switch (status) {
    case 'in_progress': return { fg: t.accInk, bg: t.accSoft, border: t.accSoft };
    case 'resolved': return { fg: t.onAcc, bg: t.ok, border: t.ok };
    case 'dismissed': return { fg: t.t3, bg: t.panel2, border: t.line2 };
    case 'open': return { fg: t.t2, bg: t.panel2, border: t.line2 };
  }
}
