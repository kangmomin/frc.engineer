import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildTheme } from '../theme';
import { AdminAnalysisReportRow, AdminAnalysisReportViewer } from './AdminAnalysisReports';
import { isCurrentAdminAnalysisRequest } from './adminAnalysisRequests';

const t = buildTheme('#e0a83d', 'light');
const doc = { id: 'A-1', title: 'Report', createdAt: '2026-09-01T00:00:00Z', html: '<h1>report</h1>' };

describe('AdminAnalysisReports', () => {
  it('preserves the legacy HTML isolation sandbox exactly', () => {
    const html = renderToStaticMarkup(<AdminAnalysisReportViewer t={t} doc={doc} />);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('&lt;h1&gt;report&lt;/h1&gt;');
  });

  it('omits the delete affordance entirely for a read-only administrator', () => {
    const meta = { id: 'A-1', title: 'Report', createdAt: '2026-09-01T00:00:00Z' };
    expect(renderToStaticMarkup(<AdminAnalysisReportRow t={t} meta={meta} active={false} canDelete={false} onOpen={vi.fn()} onDelete={vi.fn()} />)).not.toContain('삭제');
    expect(renderToStaticMarkup(<AdminAnalysisReportRow t={t} meta={meta} active={false} canDelete onOpen={vi.fn()} onDelete={vi.fn()} />)).toContain('삭제');
  });

  it('accepts only the latest mounted administrator request response', () => {
    expect(isCurrentAdminAnalysisRequest(2, 2, true)).toBe(true);
    expect(isCurrentAdminAnalysisRequest(1, 2, true)).toBe(false);
    expect(isCurrentAdminAnalysisRequest(2, 2, false)).toBe(false);
  });
});
