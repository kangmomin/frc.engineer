import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { Rankings } from './Rankings';
import { Overview } from './Overview';
import { ProfileContent } from './DriverProfile';
import { EMPTY_OVERVIEW } from '../data/types';
import type { LeaderboardPage, LeaderboardRecord } from '../data/types';
import type { ComponentProps } from 'react';

const t = buildTheme('#e0a83d', 'light');
const row: LeaderboardRecord = { rank: 201, accountId: 'driver', persona: 'Driver 201', scoreMs: 82000, you: true, sectorsMs: [0, 27000, 28000], laps: null, tyre: null, consistency: null, stddevMs: null, withinOneSecond: null };
const page: LeaderboardPage = { board: 'pb', rows: [row], total: 302, leaderMs: 80000, viewer: row, viewerGapToTop10Ms: 0, nextCursor: 'next', previousCursor: 'prev', anchorFound: false, asOf: '2026-09-08T00:00:00.123456Z' };
function render(overrides: Partial<ComponentProps<typeof Rankings>> = {}) {
  return renderToStaticMarkup(<Rankings t={t} load={{ status: 'ready', data: page, error: null }} configured signedIn trackId={7} format="F1 26" onSetTrack={vi.fn()} onSetFormat={vi.fn()} tab="pb" onSetTab={vi.fn()} rowPad="12px" highlightAccountId={null} position={{}} onNavigate={vi.fn()} onRetry={vi.fn()} {...overrides} />);
}

describe('rankings rendering', () => {
  it('shows global rank 201, participant count and leader gap with accessible source buttons and table', () => {
    const html = render();
    expect(html).toContain('전체 302명');
    expect(html).toContain('P201–P201');
    expect(html).toContain('+2.000');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
    expect(html).toContain('>—</td>');
    expect(html).not.toContain('SESSION BEST');
  });
  it('does not claim a missing target on cursor navigation', () => {
    expect(render({ highlightAccountId: 'driver', position: { cursor: 'next' } })).not.toContain('선택한 드라이버의 기록 없음');
    const html = render({ highlightAccountId: 'missing', position: { around: 'missing' }, load: { status: 'ready', data: { ...page, rows: [] }, error: null } });
    expect(html).toContain('선택한 드라이버의 기록 없음');
    expect(html).toContain('전체 302명');
  });
  it('separates anonymous, own unranked, empty TT, loading and retry states', () => {
    expect(render({ signedIn: false })).toContain('로그인하면 내 순위');
    expect(render({ position: { around: 'me' }, load: { status: 'ready', data: { ...page, viewer: null, rows: [] }, error: null } })).toContain('내 기록 없음');
    expect(render({ tab: 'tt', load: { status: 'ready', data: { ...page, board: 'tt', rows: [], total: 0, viewer: null }, error: null } })).toContain('Time Trial 세션 기록이 없습니다');
    expect(render({ load: { status: 'loading', data: null, error: null } })).toContain('불러오는 중');
    const failed = render({ load: { status: 'error', data: null, error: 'offline' } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('다시 시도');
    expect(failed).not.toContain('>기록 없음<');
  });
  it('displays measured standard deviation and within-one-second fraction without clean-lap claims', () => {
    const html = render({ tab: 'pace', load: { status: 'ready', error: null, data: { ...page, board: 'pace', rows: [{ ...row, sectorsMs: null, laps: 5, tyre: 'Medium', consistency: 0.985, stddevMs: 1234.5, withinOneSecond: 0.6 }] } } });
    expect(html).toContain('>1.234</td>');
    expect(html).toContain('>60.0%</td>');
    expect(html).toContain('성공 확률이 아닙니다');
    expect(html).toContain('별도로 제외하지 않습니다');
    expect(html).not.toContain('AVG CLEAN');
  });
});

describe('Overview PB and profile labels', () => {
  it('identifies local sessions without asserting upload or platform checks', () => {
    const html = renderToStaticMarkup(<Overview t={t} data={{ ...EMPTY_OVERVIEW, verifiedSessions: 1, recentSessions: [{ track: 'Britain', type: 'Race', pos: 1, lapMs: 82000, state: 'valid', crDelta: 0, atMs: 0 }] }} onGoMarket={vi.fn()} onGoAnalysis={vi.fn()} />);
    expect(html).toContain('LOCAL SESSIONS');
    expect(html).toContain('로컬 저장 세션');
    expect(html).toContain('로컬 기록');
    expect(html).not.toContain('ACCEPTED SESSIONS');
    expect(html).not.toContain('기본 검사 통과');
  });

  it('does not mark tied rank 11 as top 10, and handles missing tenth-place data', () => {
    const props = { t, data: EMPTY_OVERVIEW, onGoMarket: vi.fn(), onGoAnalysis: vi.fn() };
    const html = renderToStaticMarkup(<Overview {...props} rankStatus="ready" rankInfo={{ rank: 11, gapMs: 0, trackName: 'Britain' }} />);
    expect(html).toContain('동률, 순위는 P11');
    expect(html).not.toContain('톱10 진입');
    expect(html).toContain('전체 세션 PB 순위 보기');
    const fewer = renderToStaticMarkup(<Overview {...props} rankStatus="ready" rankInfo={{ rank: 5, gapMs: null, trackName: 'Britain' }} />);
    expect(fewer).toContain('톱10 진입');
    expect(fewer).not.toContain('0.000s');
    const error = renderToStaticMarkup(<Overview {...props} rankStatus="error" rankError="PB offline" />);
    expect(error).toContain('PB offline');
    expect(error).toContain('PB 다시 시도');
  });
  it('labels the legacy timeTrial profile field as PB and exposes source-specific jump buttons', () => {
    const html = renderToStaticMarkup(<ProfileContent t={t} onGoRankings={vi.fn()} profile={{ accountId: 'driver', persona: 'Driver', avatarUrl: '', verified: true, summary: { verifiedRaces: 1, validLaps: 5, trackFormats: 1 }, tracks: [{ trackId: 7, trackName: 'Britain', gameFormat: 'F1 26', timeTrial: { rank: 201, participants: 302, lapMs: 82000, s1Ms: 0, s2Ms: 27000, s3Ms: 28000 }, racePace: { rank: 31, participants: 50, avgMs: 83000, laps: 5, consistency: 0.99, stddevMs: 830, tyre: 'Medium' } }] }} />);
    expect(html).toContain('PB RANK');
    expect(html).not.toContain('TT RANK');
    expect(html).toContain('Britain 전체 세션 PB 순위 보기');
    expect(html).toContain('Britain 유효 랩 페이스 순위 보기');
    expect(html).toContain('>0.830</td>');
    expect(html).toContain('참여 기록 있음');
    expect(html).not.toContain('VERIFIED DRIVER');
  });
});
