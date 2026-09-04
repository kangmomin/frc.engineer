import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { PlatformMarket } from '../data/platform';
import { AdminAnalysisReportViewer } from './AdminAnalysisReports';
import { Analysis, RaceList } from './Analysis';

const t = buildTheme('#e0a83d', 'light');
const account = {
  id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user', verified: true,
  banned: false, createdAt: '2026-09-01T00:00:00Z', permissions: ['pithub.race.read'],
};

function render(overrides: Partial<Parameters<typeof Analysis>[0]> = {}): string {
  return renderToStaticMarkup(<Analysis t={t} market={new PlatformMarket()} configured loading={false} account={account} viewOnly={false} canReadOwnerAnalysis {...overrides} />);
}

describe('Analysis owner screen gates', () => {
  it('renders configuration, session, login, View As and permission gates distinctly', () => {
    expect(render({ configured: false })).toContain('플랫폼 연결이 필요합니다');
    expect(render({ loading: true })).toContain('role="status"');
    expect(render({ account: null })).toContain('로그인이 필요합니다');
    expect(render({ viewOnly: true })).toContain('View As에서는 분석을 열 수 없습니다');
    expect(render({ account: { ...account, permissions: undefined }, canReadOwnerAnalysis: false })).toContain('권한 정보를 확인할 수 없습니다');
    expect(render({ canReadOwnerAnalysis: false })).toContain('pithub.race.read');
  });

  it('uses the structured owner page and an idle-list status, never an owner HTML iframe', () => {
    const html = render();
    expect(html).toContain('My race analysis');
    expect(html).toContain('목록을 준비 중입니다.');
    expect(html).not.toContain('분석 가능한 내 레이스가 없습니다.');
    expect(html).not.toContain('<iframe');
  });

  it('keeps the owner API blocked but exposes separately-authorized administrator reports', () => {
    const html = render({
      account: { ...account, permissions: ['pithub.race-analyze.read'] },
      canReadOwnerAnalysis: false,
      canAdminReports: true,
    });
    expect(html).toContain('pithub.race.read');
    expect(html).toContain('관리자 HTML 리포트');
    expect(html).not.toContain('My races');
  });

  it('distinguishes idle, loading, ready-empty, and initial-error list states without a false empty result', () => {
    const renderList = (state: Parameters<typeof RaceList>[0]['state']) => renderToStaticMarkup(<RaceList
      state={state} selectedId={null} onSelect={vi.fn()} onRetry={vi.fn()} onLoadMore={vi.fn()}
    />);
    const idle = renderList({ kind: 'idle', items: [], nextOffset: null, loadingMore: false, error: null });
    expect(idle).toContain('목록을 준비 중입니다.');
    expect(idle).not.toContain('분석 가능한 내 레이스가 없습니다.');

    const loading = renderList({ kind: 'loading', items: [], nextOffset: null, loadingMore: false, error: null });
    expect(loading).toContain('레이스 목록을 불러오는 중…');
    expect(loading).not.toContain('분석 가능한 내 레이스가 없습니다.');

    const readyEmpty = renderList({ kind: 'ready', items: [], nextOffset: null, loadingMore: false, error: null });
    expect(readyEmpty).toContain('분석 가능한 내 레이스가 없습니다.');
    expect(readyEmpty).not.toContain('role="alert"');

    const initialError = renderList({ kind: 'error', items: [], nextOffset: null, loadingMore: false, error: 'network' });
    expect(initialError).toContain('role="alert"');
    expect(initialError).toContain('다시 시도');
    expect(initialError).not.toContain('분석 가능한 내 레이스가 없습니다.');
  });

  it('wraps race buttons in native list items instead of assigning listitem to buttons', () => {
    const html = renderToStaticMarkup(<RaceList
      state={{
        kind: 'ready', nextOffset: null, loadingMore: false, error: null,
        items: [{
          id: 'race-a', track: { id: 1, name: 'Bahrain' }, sessionType: 'Race', gameFormat: 'F1 26',
          recordedAt: null, uploadedAt: '2026-09-01T00:00:00Z', finishPosition: 1, completedLaps: 2,
          bestLapMs: 90_000, schemaVersion: 2, incidentCount: 0,
          completeness: {
            analysis: { status: 'complete', reasons: [], capturedCount: 1, storedCount: 1 },
            incidents: { status: 'complete', reasons: [], capturedCount: 0, storedCount: 0 },
          },
        }],
      }}
      selectedId={null} onSelect={vi.fn()} onRetry={vi.fn()} onLoadMore={vi.fn()}
    />);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>');
    expect(html).not.toMatch(/<button[^>]*role="listitem"/);
  });

  it('places legacy HTML only in the administrator component with its exact sandbox', () => {
    const html = renderToStaticMarkup(<AdminAnalysisReportViewer t={t} doc={{ id: 'legacy', title: 'Legacy', createdAt: '2026-09-01T00:00:00Z', html: '<p>legacy</p>' }} />);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
  });
});
