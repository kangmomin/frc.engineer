import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { Sidebar } from './Sidebar';

const t = buildTheme('#e0a83d', 'light');
const account = {
  id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user', verified: false,
  banned: false, createdAt: '2026-01-01T00:00:00Z',
};

function render(permissions?: string[], viewOnly = false): string {
  return renderToStaticMarkup(
    <Sidebar t={t} active="guide" onNav={vi.fn()} onLaunchLive={vi.fn()}
      account={{ ...account, permissions }} viewOnly={viewOnly} />,
  );
}

describe('Sidebar Analysis navigation', () => {
  it('shows owner Analysis only for the race.read grant', () => {
    expect(render(['pithub.race.read'])).toContain('ANALYSIS');
    // The legacy administrator reports remain reachable through the same
    // navigation surface, but do not unlock the owner replay/list API.
    expect(render(['pithub.race-analyze.read'])).toContain('ANALYSIS');
    expect(render()).not.toContain('ANALYSIS');
  });

  it('shows View As Analysis for race.read, including the hierarchical pithub grant', () => {
    expect(render(['pithub.race.read'], true)).toContain('ANALYSIS');
    expect(render(['pithub'], true)).toContain('ANALYSIS');
  });

  it('keeps View As Analysis hidden for report-only and missing race grants', () => {
    expect(render(['pithub.race-analyze.read'], true)).not.toContain('ANALYSIS');
    expect(render(undefined, true)).not.toContain('ANALYSIS');
  });

  it('keeps legacy report-only Analysis navigation in normal mode', () => {
    expect(render(['pithub.race-analyze.read'])).toContain('ANALYSIS');
  });
});

describe('permission-controlled Strategy navigation', () => {
  it('shows the menu for read or ancestor grants without an opt-in', () => {
    for (const grant of ['pithub.strategy.read', 'pithub.strategy', 'pithub']) expect(render([grant])).toContain('STRATEGY');
  });
  it('hides it for ordinary users, View As and a rejected server access check', () => {
    expect(render(['pithub.race.create', 'pithub.race.read'])).not.toContain('STRATEGY');
    expect(render()).not.toContain('STRATEGY');
    expect(render(['pithub'], true)).not.toContain('STRATEGY');
    const html = renderToStaticMarkup(<Sidebar t={t} active="strategy" onNav={vi.fn()} onLaunchLive={vi.fn()} account={{ ...account, permissions: ['pithub'] }} strategyDenied />);
    expect(html).not.toContain('STRATEGY');
  });
});

describe('community link', () => {
  it('always offers the Discord invite, including View As and logged-out', () => {
    // 권한 게이팅 대상이 아니다 — 커뮤니티 링크는 계정 상태와 무관하다.
    for (const html of [render(), render(['pithub'], true)]) {
      expect(html).toContain('https://discord.gg/Vcxr49w4TX');
      expect(html).toContain('DISCORD');
    }
    const loggedOut = renderToStaticMarkup(
      <Sidebar t={t} active="guide" onNav={vi.fn()} onLaunchLive={vi.fn()} account={null} />,
    );
    expect(loggedOut).toContain('https://discord.gg/Vcxr49w4TX');
  });

  it('opens in a new tab without leaking the opener', () => {
    expect(render()).toContain('rel="noopener noreferrer"');
    expect(render()).toContain('target="_blank"');
  });
});
