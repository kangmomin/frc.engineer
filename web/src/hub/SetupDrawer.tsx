// Setup detail drawer (hub.dc.html:388-556).
// Persistent state (owned / reviews / races / seller-perf edits) lives in HubApp
// and arrives resolved via props; the review draft + edit toggle are local and
// reset per open (HubApp keys this component by item id). ESC/scroll-lock/aria
// added over the design (Fable Nit).
import { useEffect, useState } from 'react';
import type { HubTheme } from './theme';
import { teamColor } from './theme';
import { msToTimeShort, relativeTime, condColor } from './format';
import { mkGeo, mkPoly, avgPerf, RKEYS, RLABELS } from './components/radar';
import type { HubMarketItem, HubReview, HubPerf } from './data/types';

const MONO = "'JetBrains Mono',monospace";
const EMPTY_PERF: HubPerf = { downforce: 50, topSpeed: 50, cornering: 50, tyre: 50, response: 50 };

interface Props {
  t: HubTheme;
  item: HubMarketItem;
  owned: boolean;
  racesShown: boolean;
  sellerPerf: HubPerf;
  reviews: HubReview[];
  onClose: () => void;
  onBuyUnlock: () => void;
  onToggleRaces: () => void;
  onSetPerf: (key: keyof HubPerf, value: number) => void;
  onSubmitReview: (r: { stars: number; text: string; perf: HubPerf }) => void;
}

export function SetupDrawer(props: Props) {
  const { t, item, owned, racesShown, sellerPerf, reviews, onClose } = props;
  const listed = item.priceCredits != null;

  const [perfEdit, setPerfEdit] = useState(false);
  const [draftStars, setDraftStars] = useState(0);
  const [draftText, setDraftText] = useState('');
  const [draftPerf, setDraftPerf] = useState<HubPerf>(EMPTY_PERF);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const commAvg = avgPerf(reviews) ?? sellerPerf;
  const commCount = reviews.filter((r) => r.perf).length;
  const geo = mkGeo(150, 104, 74, 99);
  const commPoly = mkPoly(commAvg, 150, 104, 74);
  const sellerPoly = mkPoly(sellerPerf, 150, 104, 74);
  const ratingNum = Math.round(item.rating);

  const submit = () => {
    const text = draftText.trim();
    if (!text || !draftStars) return;
    props.onSubmitReview({ stars: draftStars, text, perf: draftPerf });
    setDraftStars(0);
    setDraftText('');
    setDraftPerf(EMPTY_PERF);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,18,.5)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-label={item.title} onClick={(e) => e.stopPropagation()} style={{ width: 544, maxWidth: '94vw', height: '100vh', background: t.bg, borderLeft: `1px solid ${t.line}`, overflowY: 'auto', boxShadow: '-14px 0 44px rgba(0,0,0,.22)' }}>
        {/* header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: t.rail, borderBottom: `1px solid ${t.line}`, padding: '18px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: t.t1, lineHeight: 1.2 }}>{item.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: teamColor(item.team) }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: t.t2 }}>{item.creator}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} style={{ fontSize: 12, color: n <= ratingNum ? t.accInk : t.line2 }}>★</span>
                ))}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.t1 }}>{item.rating}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>· {item.reviewCount} 리뷰</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ flex: 'none', width: 32, height: 32, borderRadius: 8, border: `1px solid ${t.line2}`, background: 'transparent', color: t.t2, fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag t={t}>{item.track}</Tag>
            <Tag t={t} color={condColor(item.cond, t)}>{item.cond}</Tag>
            <Tag t={t}>{item.fmt}</Tag>
          </div>

          {/* performance pentagon */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600 }}>성능 지표 · 커뮤니티 평균</div>
              <Toggle t={t} on={perfEdit} label="판매자값 편집" onClick={() => setPerfEdit((v) => !v)} />
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: '14px 16px', flexWrap: 'wrap' }}>
              <svg viewBox="0 0 300 210" style={{ width: 236, height: 165, flex: 'none' }}>
                {geo.rings.map((r, i) => (<polygon key={`r${i}`} points={r.pts} style={{ fill: 'none', stroke: t.line, strokeWidth: 1 }} />))}
                {geo.axes.map((ax, i) => (<line key={`a${i}`} x1="150" y1="104" x2={ax.x2} y2={ax.y2} style={{ stroke: t.line, strokeWidth: 1 }} />))}
                <polygon points={sellerPoly.data} style={{ fill: 'none', stroke: t.t3, strokeWidth: 1.5, strokeDasharray: '4 3', opacity: 0.75, strokeLinejoin: 'round' }} />
                <polygon points={commPoly.data} style={{ fill: t.accSoft, stroke: t.acc, strokeWidth: 2, strokeLinejoin: 'round' }} />
                {commPoly.dots.map((dt, i) => (<circle key={`d${i}`} cx={dt.x} cy={dt.y} r={3} style={{ fill: t.acc }} />))}
                {geo.axes.map((ax, i) => (
                  <text key={`t${i}`} x={ax.labelX} y={ax.labelY} textAnchor={ax.anchor} dy={ax.dy} style={{ fill: t.t2, fontFamily: "'IBM Plex Sans KR',sans-serif", fontSize: 10, fontWeight: 600 }}>{ax.label}</text>
                ))}
              </svg>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', gap: 14, marginBottom: 11, fontFamily: MONO, fontSize: 9, color: t.t3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: t.acc }} />커뮤니티 평균 · {commCount}명</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 0, borderTop: `2px dashed ${t.t3}` }} />판매자값</span>
                </div>
                {perfEdit ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {RKEYS.map((k, i) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 58, flex: 'none', fontSize: 10.5, color: t.t2 }}>{RLABELS[i]}</span>
                        <input type="range" min={0} max={100} value={sellerPerf[k]} onChange={(e) => props.onSetPerf(k, +e.target.value)} style={{ flex: 1, minWidth: 0, accentColor: t.acc, cursor: 'pointer' }} />
                        <span style={{ width: 26, textAlign: 'right', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.t1 }}>{sellerPerf[k]}</span>
                      </div>
                    ))}
                    <div style={{ fontFamily: MONO, fontSize: 9, color: t.t3, marginTop: 2 }}>판매자 주장값(점선) 편집 · 커뮤니티 평균과 비교됩니다</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {RKEYS.map((k, i) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 58, flex: 'none', fontSize: 10.5, color: t.t2 }}>{RLABELS[i]}</span>
                        <div style={{ flex: 1, height: 6, background: t.panel2, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${commAvg[k]}%`, background: t.acc, borderRadius: 3 }} />
                        </div>
                        <span style={{ width: 26, textAlign: 'right', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: t.t1 }}>{commAvg[k]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* setup data */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600 }}>셋업 데이터 · {item.params.length} PARAM</div>
              {owned && <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: t.ok }}>✓ 보유 · 공개됨</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, background: t.line, border: `1px solid ${t.line}`, borderRadius: 8, overflow: 'hidden' }}>
              {item.params.map((prm) => (
                <div key={prm.k} style={{ background: t.panel, padding: '11px 4px', textAlign: 'center' }}>
                  <div style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: '.04em', color: t.t3 }}>{prm.k}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: owned ? t.t1 : t.t3, marginTop: 4, letterSpacing: '.06em' }}>{owned ? prm.v : '•••'}</div>
                </div>
              ))}
            </div>
            {!owned && (
              <div style={{ marginTop: 12, padding: '14px 16px', background: t.accSoft, border: `1px dashed ${t.accBorder}`, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: t.t2, lineHeight: 1.5, flex: 1, minWidth: 180 }}>실제 값은 <span style={{ color: t.t1, fontWeight: 700 }}>구매 후 공개</span>됩니다. 지금은 파라미터 항목만 표시돼요.</div>
                {listed ? (
                  <button onClick={props.onBuyUnlock} style={{ flex: 'none', background: t.acc, color: t.onAcc, border: 0, borderRadius: 8, padding: '10px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>⬢ {item.priceCredits} 구매하고 공개</button>
                ) : (
                  <span style={{ flex: 'none', fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: t.t2, border: `1px dashed ${t.line2}`, borderRadius: 7, padding: '8px 12px' }}>미판매 · 구매 불가</span>
                )}
              </div>
            )}
          </div>

          {/* race summary */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600 }}>레이스 기록 요약</div>
              <Toggle t={t} on={racesShown} label="판매자 설정" onClick={props.onToggleRaces} />
            </div>
            {racesShown ? (
              <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <SumCell t={t} label="표본" value={String(item.raceSummary.n)} border />
                  <SumCell t={t} label="평균 완주" value={`P${item.raceSummary.avgFinish}`} border />
                  <SumCell t={t} label="우승" value={String(item.raceSummary.wins)} valueColor={t.accInk} border />
                  <SumCell t={t} label="베스트랩" value={msToTimeShort(item.raceSummary.bestMs)} valueColor={t.sbest} />
                </div>
                {item.raceSummary.races.map((rc, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 56px 92px', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${t.linesoft}` }}>
                    <span style={{ fontSize: 12, color: t.t1 }}>{rc.track}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.t2 }}>P{rc.pos}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: t.t1, textAlign: 'right' }}>{msToTimeShort(rc.lapMs)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '18px 16px', background: t.inset, border: `1px dashed ${t.line2}`, borderRadius: 10, fontSize: 12, color: t.t3, textAlign: 'center', lineHeight: 1.5 }}>판매자가 레이스 기록 요약을 <span style={{ color: t.t2, fontWeight: 600 }}>비공개</span>로 설정했습니다.<br /><span style={{ fontFamily: MONO, fontSize: 9.5 }}>우측 토글로 공개 전환</span></div>
            )}
          </div>

          {/* reviews */}
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600, marginBottom: 12 }}>리뷰 · {item.reviewCount}</div>
            <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} onClick={() => setDraftStars(n)} style={{ fontSize: 20, lineHeight: 1, cursor: 'pointer', color: n <= draftStars ? t.accInk : t.line2 }}>★</span>
                  ))}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: t.t3 }}>구매자만 작성 가능</span>
              </div>
              <div style={{ marginBottom: 12, paddingTop: 12, borderTop: `1px solid ${t.linesoft}` }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: t.t3, marginBottom: 8 }}>성능 평가 · 0–100 (평균에 반영)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {RKEYS.map((k, i) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 58, flex: 'none', fontSize: 10, color: t.t2 }}>{RLABELS[i]}</span>
                      <input type="range" min={0} max={100} value={draftPerf[k]} onChange={(e) => setDraftPerf((s) => ({ ...s, [k]: +e.target.value }))} style={{ flex: 1, minWidth: 0, accentColor: t.acc, cursor: 'pointer' }} />
                      <span style={{ width: 24, textAlign: 'right', fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: t.t1 }}>{draftPerf[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} placeholder="이 셋업 어땠나요? (밸런스, 안정성, 페이스…)" style={{ width: '100%', minHeight: 64, resize: 'vertical', background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, padding: '10px 12px', fontFamily: 'inherit', fontSize: 12.5, color: t.t1, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={submit} style={{ background: t.acc, color: t.onAcc, border: 0, borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>리뷰 등록</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reviews.map((rv, i) => (
                <div key={i} style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: t.t1 }}>{rv.reviewer}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {[1, 2, 3, 4, 5].map((n) => (<span key={n} style={{ fontSize: 11, color: n <= rv.stars ? t.accInk : t.line2 }}>★</span>))}
                    </span>
                    {rv.verifiedBuyer && <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '.04em', color: t.ok, background: t.okSoft, borderRadius: 4, padding: '2px 6px' }}>✓ 구매 인증</span>}
                    <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 9.5, color: t.t3 }}>{relativeTime(rv.atMs)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: t.t2, lineHeight: 1.55 }}>{rv.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tag({ t, color, children }: { t: HubTheme; color?: string; children: string }) {
  return <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.06em', color: color ?? t.t2, background: t.inset, borderRadius: 4, padding: '4px 8px' }}>{children}</span>;
}

function Toggle({ t, on, label, onClick }: { t: HubTheme; on: boolean; label: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.08em', color: t.t3 }}>{label}</span>
      <div style={{ width: 38, height: 20, borderRadius: 20, background: on ? t.acc : t.line2, display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start', padding: 2 }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.35)' }} />
      </div>
    </div>
  );
}

function SumCell({ t, label, value, valueColor, border }: { t: HubTheme; label: string; value: string; valueColor?: string; border?: boolean }) {
  return (
    <div style={{ padding: '12px 8px', textAlign: 'center', borderRight: border ? `1px solid ${t.line}` : undefined }}>
      <div style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: '.06em', color: t.t3 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: valueColor ?? t.t1, marginTop: 4 }}>{value}</div>
    </div>
  );
}
