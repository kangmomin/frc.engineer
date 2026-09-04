// Legacy administrator HTML reports remain isolated from owner race analysis.
// The document is intentionally untrusted and may only run in this opaque
// iframe sandbox; never add allow-same-origin.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { relativeTime } from '../format';
import type { HubTheme } from '../theme';
import {
  ListingError,
  type PlatformAnalysisDoc,
  type PlatformAnalysisMeta,
  type PlatformMarket,
} from '../data/platform';
import { isCurrentAdminAnalysisRequest } from './adminAnalysisRequests';

const MONO = "'JetBrains Mono',monospace";

interface AdminAnalysisReportsProps {
  t: HubTheme;
  market: PlatformMarket;
  canDelete: boolean;
}

export function AdminAnalysisReports({ t, market, canDelete }: AdminAnalysisReportsProps) {
  const [metas, setMetas] = useState<PlatformAnalysisMeta[] | null>(null);
  const [listError, setListError] = useState('');
  const [document, setDocument] = useState<PlatformAnalysisDoc | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const mounted = useRef(false);
  const listGeneration = useRef(0);
  const documentGeneration = useRef(0);
  const openIdRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listGeneration.current += 1;
      documentGeneration.current += 1;
    };
  }, []);

  const refresh = useCallback(() => {
    const generation = ++listGeneration.current;
    setListError('');
    void market.listAnalyses()
      .then((rows) => {
        if (isCurrentAdminAnalysisRequest(generation, listGeneration.current, mounted.current)) setMetas(rows);
      })
      .catch((error: unknown) => {
        if (isCurrentAdminAnalysisRequest(generation, listGeneration.current, mounted.current)) setListError(errorMessage(error));
      });
  }, [market]);

  useEffect(() => { refresh(); }, [refresh]);

  const open = (id: string) => {
    const generation = ++documentGeneration.current;
    openIdRef.current = id;
    setOpenId(id);
    setDocument(null);
    setDocumentError('');
    void market.getAnalysis(id)
      .then((value) => {
        if (isCurrentAdminAnalysisRequest(generation, documentGeneration.current, mounted.current)) setDocument(value);
      })
      .catch((error: unknown) => {
        if (isCurrentAdminAnalysisRequest(generation, documentGeneration.current, mounted.current)) setDocumentError(errorMessage(error));
      });
  };

  const remove = (id: string) => {
    if (!canDelete) return;
    void market.deleteAnalysis(id)
      .then(() => {
        if (!mounted.current) return;
        if (openIdRef.current === id) {
          documentGeneration.current += 1;
          openIdRef.current = null;
          setOpenId(null);
          setDocument(null);
        }
        refresh();
      })
      .catch((error: unknown) => {
        if (mounted.current) setListError(errorMessage(error));
      });
  };

  return (
    <section aria-labelledby="admin-analysis-reports-title">
      <div style={{ marginTop: 28, marginBottom: 12 }}>
        <div id="admin-analysis-reports-title" style={{ fontSize: 16, fontWeight: 800, color: t.t1 }}>관리자 HTML 리포트</div>
        <div style={{ marginTop: 4, color: t.t2, fontSize: 12 }}>기존 업로드 리포트 · 구조화된 내 레이스 분석과 별도입니다.</div>
      </div>
      <AdminAnalysisCard t={t}>
        {listError && <div role="alert" style={{ color: t.negRed, fontSize: 12, marginBottom: 8 }}>{listError}</div>}
        {metas === null ? (
          <div role="status" style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>불러오는 중…</div>
        ) : metas.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>업로드된 리포트가 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {metas.map((meta) => (
              <AdminAnalysisReportRow
                key={meta.id} t={t} meta={meta} active={openId === meta.id} canDelete={canDelete}
                onOpen={() => open(meta.id)} onDelete={() => remove(meta.id)}
              />
            ))}
          </div>
        )}
      </AdminAnalysisCard>

      {openId && (
        <AdminAnalysisCard t={t} style={{ marginTop: 14, padding: 12 }}>
          {documentError ? (
            <div role="alert" style={{ color: t.negRed, fontSize: 12 }}>{documentError}</div>
          ) : document === null ? (
            <div role="status" style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>리포트 불러오는 중…</div>
          ) : (
            <AdminAnalysisReportViewer t={t} doc={document} />
          )}
        </AdminAnalysisCard>
      )}
    </section>
  );
}

export function AdminAnalysisReportViewer({ t, doc }: { t: HubTheme; doc: PlatformAnalysisDoc }) {
  return (
    <iframe
      key={doc.id}
      sandbox="allow-scripts"
      srcDoc={doc.html}
      title={doc.title}
      style={{
        width: '100%', height: '74vh', border: `1px solid ${t.line}`,
        borderRadius: 10, background: '#0b0e13',
      }}
    />
  );
}

export function AdminAnalysisReportRow({ t, meta, active, canDelete, onOpen, onDelete }: {
  t: HubTheme;
  meta: PlatformAnalysisMeta;
  active: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      background: active ? t.accSoft : t.inset,
      border: `1px solid ${active ? t.accBorder : t.line}`, borderRadius: 8,
    }}>
      <button type="button" onClick={onOpen} style={{
        flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
        fontSize: 13, fontWeight: 600, color: t.t1, fontFamily: 'inherit',
      }}>
        {meta.title}
        <span style={{ display: 'block', marginTop: 3, fontFamily: MONO, fontSize: 10, fontWeight: 400, color: t.t3 }}>
          {meta.trackName || '트랙 미지정'}
          {meta.sessionUid ? ` · 세션 ${meta.sessionUid}` : ''}
          {` · ${relativeTime(Date.parse(meta.createdAt), Date.now())}`}
        </span>
      </button>
      {canDelete && (
        <button type="button" onClick={onDelete} style={{
          fontFamily: MONO, fontSize: 10, padding: '5px 10px', borderRadius: 6,
          border: `1px solid ${t.line2}`, background: t.panel2, color: t.t3, cursor: 'pointer',
        }}>
          삭제
        </button>
      )}
    </div>
  );
}

function AdminAnalysisCard({ t, children, style }: { t: HubTheme; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, ...style }}>{children}</div>;
}

function errorMessage(error: unknown): string {
  return error instanceof ListingError ? error.message : '오류가 발생했습니다';
}
