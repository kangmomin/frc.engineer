// Hub sidebar — logo, nav, user footer (hub.dc.html:29-48).
import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';
import { canManageRBAC, canReadAdminAnalysisReports, canReadRaceAnalysis, canViewFeedbackInbox } from '../data/permissions';

export type HubScreen = 'guide' | 'overview' | 'rankings' | 'market' | 'setups' | 'analysis' | 'profile' | 'feedback' | 'feedback-inbox' | 'access' | 'driver-profile';

const MONO = "'JetBrains Mono',monospace";

// ACCESS는 rbac 권한이 있을 때만 노출되므로 목록 끝에 두어 앞 항목의 번호가
// 노출 여부에 따라 흔들리지 않게 한다. 노출은 편의일 뿐 — 경계는 서버 게이트다.
const NAV: { id: HubScreen; label: string; idx: string; needsRBAC?: boolean; needsFeedbackInbox?: boolean; needsAnalysis?: boolean }[] = [
  { id: 'guide', label: 'GUIDE', idx: '00' },
  { id: 'overview', label: 'OVERVIEW', idx: '01' },
  { id: 'rankings', label: 'RANKINGS', idx: '02' },
  { id: 'market', label: 'MARKET', idx: '03' },
  { id: 'setups', label: 'MY SETUPS', idx: '04' },
  { id: 'analysis', label: 'ANALYSIS', idx: '05', needsAnalysis: true },
  { id: 'profile', label: 'PROFILE', idx: '06' },
  { id: 'feedback', label: 'FEEDBACK', idx: '07' },
  { id: 'feedback-inbox', label: 'FEEDBACK INBOX', idx: '08', needsFeedbackInbox: true },
  { id: 'access', label: 'ACCESS', idx: '09', needsRBAC: true },
];

interface Props {
  t: HubTheme;
  active: HubScreen;
  onNav: (id: HubScreen) => void;
  onLaunchLive: () => void;
  // Logged-in platform account; null when logged out / platform unconfigured.
  account: PlatformAccount | null;
  viewOnly?: boolean;
}

export function Sidebar({ t, active, onNav, onLaunchLive, account, viewOnly = false }: Props) {
  return (
    <aside
      className="hubSidebar"
      style={{
        width: 224, flex: 'none', background: t.rail, borderRight: `1px solid ${t.line}`,
        display: 'flex', flexDirection: 'column', height: '100%',
      }}
    >
      <div style={{ height: 60, display: 'flex', alignItems: 'center', gap: 11, padding: '0 20px', borderBottom: `1px solid ${t.line}`, flex: 'none' }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ width: 4, height: 22, background: t.acc, borderRadius: 1 }} />
          <span style={{ width: 4, height: 22, background: t.line2, borderRadius: 1 }} />
        </div>
        <div className="hubSidebarBrandCopy" style={{ lineHeight: 1 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 15, letterSpacing: '-.02em', color: t.t1 }}>frc</span>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 15, color: t.t3 }}>.engineer</span>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.32em', color: t.accInk, marginTop: 3 }}>PITWALL CLOUD</div>
        </div>
      </div>

      <nav style={{ padding: '14px 0', flex: 1, overflowY: 'auto' }}>
        {NAV.filter((item) =>
          (!viewOnly || (item.id !== 'access' && item.id !== 'feedback-inbox'))
          && (!item.needsRBAC || canManageRBAC(account))
          && (!item.needsFeedbackInbox || canViewFeedbackInbox(account))
          && (!item.needsAnalysis || canReadRaceAnalysis(account) || (!viewOnly && canReadAdminAnalysisReports(account))),
        ).map((item) => {
          const on = active === item.id;
          return (
            <button
              key={item.id}
              className="hubNavButton"
              onClick={() => onNav(item.id)}
              aria-current={on ? 'page' : undefined}
              aria-label={item.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
                background: on ? t.navHoverBg : 'transparent', border: 0,
                borderLeft: `2px solid ${on ? t.acc : 'transparent'}`, padding: '11px 20px 11px 18px',
                cursor: 'pointer', color: on ? t.t1 : t.t2, fontFamily: MONO, fontSize: 11.5, letterSpacing: '.13em', fontWeight: 600,
              }}
            >
              <span className="hubNavIndex" style={{ color: on ? t.accInk : t.navMuted, fontSize: 9.5, letterSpacing: 0 }}>{item.idx}</span>
              <span className="hubMobileNavLabel">{item.label === 'MY SETUPS' ? 'SETUPS' : item.label}</span>
              <span className="hubNavLabel">{item.label}</span>
            </button>
          );
        })}
        <button
          className="hubNavButton"
          onClick={onLaunchLive}
          disabled={viewOnly}
          aria-label="LIVE 피트월"
          style={{
            display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
            background: 'transparent', border: 0, borderLeft: '2px solid transparent',
            padding: '11px 20px 11px 18px', marginTop: 8, cursor: viewOnly ? 'not-allowed' : 'pointer',
            color: viewOnly ? t.t3 : t.t2, opacity: viewOnly ? .55 : 1, fontFamily: MONO, fontSize: 11.5, letterSpacing: '.13em', fontWeight: 600,
          }}
        >
          <span className="hubNavIndex" style={{ color: t.ok, fontSize: 9.5, letterSpacing: 0, animation: 'escpulse 1.6s ease-in-out infinite' }}>◆</span>
          <span className="hubMobileNavLabel">LIVE</span>
          <span className="hubNavLabel">{viewOnly ? 'LIVE · View As 미지원' : 'LIVE · 피트월'}</span>
        </button>
      </nav>

      <button
        className="hubAccountButton"
        onClick={() => onNav('profile')}
        style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 11, flex: 'none', width: '100%', textAlign: 'left', background: 'transparent', border: 0, borderTop: `1px solid ${t.line}`, cursor: 'pointer' }}
      >
        {account?.avatarUrl ? (
          <img src={account.avatarUrl} alt={account.persona} width={36} height={36} style={{ borderRadius: 9, flex: 'none', border: `1px solid ${t.line2}` }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 9, background: account ? 'linear-gradient(135deg,#00cfb8,#0c7a6e)' : t.panel2, border: account ? 0 : `1px solid ${t.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 13, color: account ? '#04110f' : t.t3 }}>
            {account ? initials(account.persona) : '?'}
          </div>
        )}
        <div className="hubAccountCopy" style={{ minWidth: 0, lineHeight: 1.3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{account ? account.persona : '로그인'}</div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: account?.verified ? t.ok : t.t3, display: 'flex', alignItems: 'center', gap: 4 }}>
            {account ? (account.verified ? '◆ STEAM · 참여 기록' : 'STEAM · 참여 미확인') : 'PROFILE에서 로그인'}
          </div>
        </div>
      </button>
    </aside>
  );
}

// initials returns up to two uppercase leading characters of a persona for the
// avatar fallback (e.g. "kangmomin" → "KA").
function initials(persona: string): string {
  const s = persona.trim();
  return s ? s.slice(0, 2).toUpperCase() : '?';
}
