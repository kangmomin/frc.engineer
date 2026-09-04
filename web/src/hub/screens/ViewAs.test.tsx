import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { ViewAsBanner } from '../components/ViewAsBanner';
import { Sidebar } from '../components/Sidebar';
import { Profile } from './Profile';
import { Feedback } from './Feedback';
import { MarketManage } from './MarketManage';
import { PlatformMarket } from '../data/platform';
import { viewAsEligibility } from './accessState';
import type { PlatformAccount } from '../data/session';

const t = buildTheme('#e0a83d', 'light');
const subject: PlatformAccount = {
  id: 'subject', steamId64: '7', persona: 'Target', avatarUrl: '', kind: 'user',
  verified: true, banned: false, createdAt: '2026-01-01T00:00:00Z', permissions: ['pithub'],
};

describe('View As static affordances', () => {
  it('renders an accessible persistent identity banner and exit control', () => {
    const html = renderToStaticMarkup(<ViewAsBanner t={t} subject={subject} actorPersona="Admin" expiresAt="2026-09-04T12:00:00Z" busy={false} onExit={vi.fn()} />);
    expect(html).toContain('role="region"');
    expect(html).toContain('View As · Target · READ ONLY');
    expect(html).toContain('Signed in as Admin');
    expect(html).toContain('View As 종료');
  });

  it('hides operator navigation and disables local Live', () => {
    const html = renderToStaticMarkup(<Sidebar t={t} active="profile" onNav={vi.fn()} onLaunchLive={vi.fn()} account={subject} viewOnly />);
    expect(html).toContain('aria-label="ANALYSIS"');
    expect(html).not.toContain('aria-label="ACCESS"');
    expect(html).not.toContain('aria-label="FEEDBACK INBOX"');
    expect(html).toContain('disabled="" aria-label="LIVE 피트월"');
  });

  it('removes Profile credentials and Feedback submission controls', () => {
    const profile = renderToStaticMarkup(<Profile t={t} configured account={subject} loading={false} onLogin={vi.fn()} onLogout={vi.fn()} onGeneratePairing={vi.fn()} viewOnly />);
    expect(profile).not.toContain('>로그아웃</button>');
    expect(profile).not.toContain('>페어링 코드 생성</button>');
    const feedback = renderToStaticMarkup(<Feedback t={t} configured account={subject} market={new PlatformMarket()} viewOnly />);
    expect(feedback).not.toContain('새 의견 작성');
    expect(feedback).toContain('처리 내역만 볼 수 있습니다');
  });

  it('removes marketplace write entry points', () => {
    const html = renderToStaticMarkup(<MarketManage t={t} configured account={subject} market={new PlatformMarket()} trackCtx={{ trackId: 1, format: 'F1 26' }} onSetTrackCtx={vi.fn()} viewOnly />);
    expect(html).not.toContain('＋ 내 기록 판매</button>');
    expect(html).toContain('VIEW AS · 리스팅 읽기 전용');
  });
});

describe('Access View As eligibility', () => {
  const row = { id: 'target', persona: 'Target', kind: 'user', banned: false, roles: ['user'] };

  it('allows only another active user when the actor has create permission', () => {
    expect(viewAsEligibility(row, 'actor', true).eligible).toBe(true);
    expect(viewAsEligibility({ ...row, id: 'actor' }, 'actor', true).reason).toBe('본인 계정');
    expect(viewAsEligibility({ ...row, kind: 'system' }, 'actor', true).reason).toBe('시스템 계정');
    expect(viewAsEligibility({ ...row, banned: true }, 'actor', true).reason).toBe('정지된 계정');
    expect(viewAsEligibility(row, 'actor', false).reason).toBe('권한 없음');
  });
});
