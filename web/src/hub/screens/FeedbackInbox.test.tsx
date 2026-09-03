import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { FeedbackInboxPresentation, type InboxState } from './FeedbackInbox';

const t = buildTheme('#e0a83d', 'light');
const onRetry = vi.fn();

function render(state: InboxState): string {
  return renderToStaticMarkup(<FeedbackInboxPresentation t={t} state={state} onRetry={onRetry} />);
}

describe('FeedbackInboxPresentation', () => {
  it('renders a polite loading status', () => {
    expect(render({ kind: 'loading' })).toContain('role="status"');
  });

  it('renders an empty status', () => {
    expect(render({ kind: 'ready', entries: [] })).toContain('등록된 의견이 없습니다.');
  });

  it('renders rows as plain text with their category and status', () => {
    const html = render({
      kind: 'ready',
      entries: [{ id: 'F-1', category: 'bug', body: '<strong>긴 본문</strong>', status: 'resolved', createdAt: '2026-07-20T00:00:00Z' }],
    });
    expect(html).toContain('피드백 인박스');
    expect(html).toContain('버그');
    expect(html).toContain('해결됨');
    expect(html).toContain('role="listitem"');
    expect(html).toContain('&lt;strong&gt;긴 본문&lt;/strong&gt;');
  });

  it('renders an alert and retry action on error', () => {
    const html = render({ kind: 'error', message: '피드백 인박스를 볼 권한이 없습니다' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('다시 시도');
  });
});
