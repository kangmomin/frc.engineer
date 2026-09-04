import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { PlatformMarket, type PlatformMySetupDetail, type PlatformMySetupParams, type PlatformMySetupSummary } from '../data/platform';
import { MySetups, SetupDetail, SetupList } from './MySetups';
import { reduceMySetupsSelection, replaceMySetupDraftText, resolveMySetupsRefreshOutcome } from './mySetupsState';

const t = buildTheme('#e0a83d', 'light');
const account = {
  id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user', verified: true,
  banned: false, createdAt: '2026-01-01T00:00:00Z', permissions: ['pithub.race.read'],
};

const params: PlatformMySetupParams = {
  frontWing: 1, rearWing: 2, onThrottle: 3, offThrottle: 4, frontCamber: 5, rearCamber: 6, frontToe: 7, rearToe: 8,
  frontSuspension: 9, rearSuspension: 10, frontAntiRollBar: 11, rearAntiRollBar: 12, frontSuspensionHeight: 13,
  rearSuspensionHeight: 14, brakePressure: 15, brakeBias: 16, engineBraking: 17, rearLeftTyrePressure: 18,
  rearRightTyrePressure: 19, frontLeftTyrePressure: 20, frontRightTyrePressure: 21, ballast: 22, fuelLoad: 23,
};

const summary: PlatformMySetupSummary = {
  id: 'setup-a', name: 'Race trim', rating: 4, memo: 'stable', params, usageCount: 2,
  firstRecordedAt: '2026-09-01T10:00:00Z', lastRecordedAt: '2026-09-02T11:00:00Z',
  lastTrackId: 1, lastTrackName: 'Bahrain', lastGameFormat: 'F1 26',
};

const detail: PlatformMySetupDetail = {
  ...summary,
  races: [{ id: 'race-a', recordedAt: '2026-09-02T11:00:00Z', trackId: 1, trackName: 'Bahrain', gameFormat: 'F1 26', sessionType: 'Race', finishPosition: 2, completedLaps: 20, bestLapMs: 90001 }],
};

function render(overrides: Partial<Parameters<typeof MySetups>[0]> = {}) {
  return renderToStaticMarkup(<MySetups t={t} configured loading={false} account={account} market={new PlatformMarket()} onLogin={vi.fn()} onSessionExpired={vi.fn()} {...overrides} />);
}

describe('MySetups', () => {
  it('renders a polite session-loading state and a legacy fail-closed gate', () => {
    expect(render({ loading: true })).toContain('role="status"');
    expect(render({ account: { ...account, permissions: undefined } })).toContain('서버 업데이트 필요');
  });

  it('renders the read-only page without calling a browser API during static markup', () => {
    const html = render();
    expect(html).toContain('My Setups');
    expect(html).toContain('최근 최대 100개 셋업');
    expect(html).toContain('role="status"');
  });

  it('renders populated group timestamps and keeps each setup card a listitem wrapper around a pressed button', () => {
    const html = renderToStaticMarkup(<SetupList t={t} state={{ kind: 'ready', value: [summary] }} selectedId="setup-a" onSelect={vi.fn()} onRetry={vi.fn()} />);
    expect(html).toContain('role="listitem"');
    expect(html).toContain('<button type="button" aria-pressed="true"');
    expect(html).toContain('첫 기록 시각:');
    expect(html).toContain('마지막 기록 시각:');
  });

  it('hides null summary and race timestamps without rendering placeholders', () => {
    const nullTimes = { ...detail, firstRecordedAt: null, lastRecordedAt: null, races: [{ ...detail.races[0], recordedAt: null }] };
    const html = renderToStaticMarkup(<SetupDetail
      t={t} state={{ kind: 'ready', value: nullTimes }} selectedId="setup-a" draft={null} editing={false} save={{ kind: 'idle' }} canEdit={false}
      onEdit={vi.fn()} onCancel={vi.fn()} onDraft={vi.fn()} onSave={vi.fn()} onRetry={vi.fn()} onRefreshRetry={vi.fn()}
    />);
    expect(html).not.toContain('첫 기록 시각:');
    expect(html).not.toContain('마지막 기록 시각:');
    expect(html).not.toContain('기록 시각:');
  });

  it('keeps an explicit save retry affordance for retained drafts', () => {
    const html = renderToStaticMarkup(<SetupDetail
      t={t} state={{ kind: 'ready', value: detail }} selectedId="setup-a" draft={{ name: 'changed', rating: 5, memo: 'kept' }} editing save={{ kind: 'error', message: '입력이 올바르지 않습니다' }} canEdit
      onEdit={vi.fn()} onCancel={vi.fn()} onDraft={vi.fn()} onSave={vi.fn()} onRetry={vi.fn()} onRefreshRetry={vi.fn()}
    />);
    expect(html).toContain('입력한 내용은 유지되었습니다.');
    expect(html).toContain('다시 저장');
  });
});

describe('reduceMySetupsSelection', () => {
  it('discards draft on selection and ignores a stale detail/save response', () => {
    const selected = reduceMySetupsSelection({ selectedId: null, generation: 4, draft: { name: 'old', rating: 4, memo: '' } }, { type: 'select', id: 'setup-a' });
    expect(selected).toEqual({ selectedId: 'setup-a', generation: 5, draft: null });
    const stale = reduceMySetupsSelection(selected, { type: 'metadata', id: 'setup-a', generation: 4, draft: { name: 'late', rating: null, memo: '' } });
    expect(stale).toEqual(selected);
  });

  it('only accepts metadata for the current setup generation', () => {
    const state = { selectedId: 'setup-a', generation: 5, draft: null };
    expect(reduceMySetupsSelection(state, { type: 'metadata', id: 'setup-b', generation: 5, draft: { name: 'wrong', rating: 2, memo: '' } })).toEqual(state);
    expect(reduceMySetupsSelection(state, { type: 'metadata', id: 'setup-a', generation: 5, draft: { name: 'fresh', rating: 2, memo: '' } }).draft?.name).toBe('fresh');
  });

  it('uses the reducer for current draft updates but ignores them after deselection', () => {
    const selected = { selectedId: 'setup-a', generation: 5, draft: null };
    const edited = reduceMySetupsSelection(selected, { type: 'draft', draft: { name: 'kept', rating: 3, memo: 'draft' } });
    expect(edited.draft?.name).toBe('kept');
    const cleared = reduceMySetupsSelection(edited, { type: 'clear' });
    expect(reduceMySetupsSelection(cleared, { type: 'draft', draft: { name: 'late', rating: null, memo: '' } })).toEqual(cleared);
  });

  it('advances retries without discarding the current selection or draft, so older responses stay stale', () => {
    const selected = { selectedId: 'setup-a', generation: 5, draft: { name: 'keep', rating: 3, memo: 'draft' } };
    const retried = reduceMySetupsSelection(selected, { type: 'retry' });
    expect(retried).toEqual({ ...selected, generation: 6 });
    expect(reduceMySetupsSelection(retried, { type: 'metadata', id: 'setup-a', generation: 5, draft: { name: 'old', rating: null, memo: '' } })).toEqual(retried);
    expect(reduceMySetupsSelection(retried, { type: 'metadata', id: 'setup-a', generation: 6, draft: { name: 'fresh', rating: 4, memo: '' } }).draft?.name).toBe('fresh');
  });

  it('does not advance a retry after the selection has been cleared', () => {
    const cleared = { selectedId: null, generation: 6, draft: null };
    expect(reduceMySetupsSelection(cleared, { type: 'retry' })).toEqual(cleared);
  });
});

describe('post-save refresh priority', () => {
  it('prioritizes auth, then permission clearing, then deselection before network retry', () => {
    expect(resolveMySetupsRefreshOutcome(['network', 'not-found'])).toBe('not-found');
    expect(resolveMySetupsRefreshOutcome(['forbidden', 'not-found'])).toBe('forbidden');
    expect(resolveMySetupsRefreshOutcome(['unauthorized', 'forbidden'])).toBe('unauthorized');
    expect(resolveMySetupsRefreshOutcome([null, null])).toBe('ready');
    expect(resolveMySetupsRefreshOutcome(['network', null])).toBe('network');
  });
});

describe('My Setups Unicode text limits', () => {
  const draft = { name: 'before', rating: 4, memo: 'before' };

  it('accepts the exact 80-code-point name limit for ASCII and astral emoji', () => {
    expect(replaceMySetupDraftText(draft, 'name', 'a'.repeat(80)).name).toHaveLength(80);
    expect(replaceMySetupDraftText(draft, 'name', '😀'.repeat(80)).name).toBe('😀'.repeat(80));
  });

  it('keeps the existing name draft when an attempted value exceeds 80 code points', () => {
    expect(replaceMySetupDraftText(draft, 'name', '😀'.repeat(81))).toBe(draft);
  });

  it('accepts the exact 500-code-point memo limit and preserves the draft above it', () => {
    expect(replaceMySetupDraftText(draft, 'memo', '😀'.repeat(500)).memo).toBe('😀'.repeat(500));
    expect(replaceMySetupDraftText(draft, 'memo', 'a'.repeat(501))).toBe(draft);
  });
});
