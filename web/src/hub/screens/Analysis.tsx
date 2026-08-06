// Analysis screen — 운영자가 올린 레이스별 분석 리포트(HTML 문서) 목록 + 뷰어.
// 셸 관례는 Feedback.tsx (title header + Card + busy/msg). 서버가 admin env
// 허용목록으로 게이트하므로 이 화면은 admin 계정에서만 마운트된다 (HubApp 분기).
//
// 보안 불변식 — 문서는 신뢰 불가 HTML이다:
//  * 반드시 <iframe sandbox="allow-scripts" srcDoc=…>로만 렌더한다. sandbox에
//    allow-same-origin을 절대 추가하지 말 것 — 추가하는 순간 opaque origin이
//    풀려 문서 스크립트가 부모 origin의 localStorage(플랫폼 토큰)에 닿는다.
//  * sandbox 기본값이 top-navigation/popup/form을 차단한다 — 토큰 추가 금지.
//  * srcdoc 문서는 부모 페이지의 CSP를 상속한다. 지금은 SPA에 CSP가 없어 리포트의
//    인라인 <script>(차트)가 동작하지만, SPA에 CSP를 도입하면 이 뷰어를 재검토할 것.
import { useCallback, useEffect, useState } from 'react';
import type { HubTheme } from '../theme';
import { relativeTime } from '../format';
import {
  PlatformMarket, ListingError,
  type PlatformAnalysisMeta, type PlatformAnalysisDoc,
} from '../data/platform';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  market: PlatformMarket;
}

export function Analysis({ t, market }: Props) {
  const [metas, setMetas] = useState<PlatformAnalysisMeta[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [doc, setDoc] = useState<PlatformAnalysisDoc | null>(null);
  const [docErr, setDocErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    market.listAnalyses()
      .then((rows) => setMetas(rows))
      .catch((e: unknown) => setListErr(msgOf(e)));
  }, [market]);

  useEffect(() => { refresh(); }, [refresh]);

  const open = (id: string) => {
    setOpenId(id); setDoc(null); setDocErr('');
    market.getAnalysis(id)
      .then((d) => setDoc(d))
      .catch((e: unknown) => setDocErr(msgOf(e)));
  };

  const remove = (id: string) => {
    market.deleteAnalysis(id)
      .then(() => {
        if (openId === id) { setOpenId(null); setDoc(null); }
        refresh();
      })
      .catch((e: unknown) => setListErr(msgOf(e)));
  };

  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>분석 리포트</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>레이스별 종합 분석 문서 · 운영자 업로드</div>
      </div>

      <Card t={t}>
        {listErr && <div style={{ fontSize: 11.5, color: t.negRed, marginBottom: 8 }}>{listErr}</div>}
        {metas == null ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>불러오는 중…</div>
        ) : metas.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>업로드된 리포트가 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {metas.map((m) => (
              <ReportRow key={m.id} t={t} meta={m} active={openId === m.id}
                onOpen={() => open(m.id)} onDelete={() => remove(m.id)} />
            ))}
          </div>
        )}
      </Card>

      {openId && (
        <Card t={t} style={{ marginTop: 14, padding: 12 }}>
          {docErr ? (
            <div style={{ fontSize: 11.5, color: t.negRed }}>{docErr}</div>
          ) : doc == null ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>리포트 불러오는 중…</div>
          ) : (
            // sandbox 불변식은 파일 헤더 주석 참조 — allow-same-origin 추가 금지.
            // key로 문서 전환 시 iframe을 강제 리마운트한다 (이전 문서 상태 격리).
            <iframe
              key={doc.id}
              sandbox="allow-scripts"
              srcDoc={doc.html}
              title={doc.title}
              style={{
                width: '100%', height: '74vh', border: `1px solid ${t.line}`,
                borderRadius: 10, background: '#0b0e13', // 리포트 다크 테마 로딩 플래시 방지
              }}
            />
          )}
        </Card>
      )}
    </section>
  );
}

function ReportRow({ t, meta, active, onOpen, onDelete }: {
  t: HubTheme; meta: PlatformAnalysisMeta; active: boolean;
  onOpen: () => void; onDelete: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      background: active ? t.accSoft : t.inset,
      border: `1px solid ${active ? t.accBorder : t.line}`, borderRadius: 8,
    }}>
      <button onClick={onOpen} style={{
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
      <button onClick={onDelete} style={{
        fontFamily: MONO, fontSize: 10, padding: '5px 10px', borderRadius: 6,
        border: `1px solid ${t.line2}`, background: t.panel2, color: t.t3, cursor: 'pointer',
      }}>
        삭제
      </button>
    </div>
  );
}

function Card({ t, children, style }: { t: HubTheme; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function msgOf(e: unknown): string {
  return e instanceof ListingError ? e.message : '오류가 발생했습니다';
}
