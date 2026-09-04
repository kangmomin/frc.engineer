import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';

const MONO = "'JetBrains Mono',monospace";

export function ViewAsBanner({ t, subject, actorPersona, expiresAt, busy, onExit }: {
  t: HubTheme;
  subject: PlatformAccount;
  actorPersona: string;
  expiresAt: string;
  busy: boolean;
  onExit: () => void;
}) {
  const expiry = formatExpiry(expiresAt);
  return (
    <section
      role="region"
      aria-label="View As 읽기 전용 세션"
      style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        padding: '9px 24px', background: t.warnSoft, borderBottom: `1px solid ${t.warnBorder}`,
        color: t.t1,
      }}
    >
      <strong style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: '.08em' }}>
        View As · {subject.persona || subject.id} · READ ONLY
      </strong>
      <span style={{ fontSize: 12, color: t.t2 }}>Signed in as {actorPersona}</span>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.t3 }}>만료 {expiry}</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onExit}
        disabled={busy}
        style={{
          border: `1px solid ${t.line2}`, borderRadius: 7, background: t.panel,
          color: t.t1, padding: '7px 12px', cursor: busy ? 'default' : 'pointer',
          opacity: busy ? .55 : 1, fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
        }}
      >
        {busy ? '종료 중…' : 'View As 종료'}
      </button>
    </section>
  );
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}
