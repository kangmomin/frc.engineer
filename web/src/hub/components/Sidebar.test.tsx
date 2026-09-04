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

  it('never exposes owner Analysis in View As', () => {
    expect(render(['pithub.race.read'], true)).not.toContain('ANALYSIS');
  });
});
