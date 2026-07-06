// Overview screen (hub.dc.html:73-168).
import type { HubTheme } from '../theme';
import { rgba, teamColor } from '../theme';
import { msToTime, relativeTime, signed } from '../format';
import type { HubOverview, HubMarketItem, HubSession, HubLedgerEntry } from '../data/types';

const MONO = "'JetBrains Mono',monospace";

// RealWallet overrides the mock wallet/ledger with the logged-in account's actual
// platform balance and entries (Phase 3D1). Absent → mock demo.
export interface RealWallet {
  balance: number;
  ledger: HubLedgerEntry[];
}

interface Props {
  t: HubTheme;
  data: HubOverview;
  featured: HubMarketItem[];
  onGoMarket: () => void;
  onGoAnalysis: () => void;
  wallet?: RealWallet | null;
  // Logged-in account's display name for the banner greeting. Absent (logged
  // out / not yet loaded) → generic greeting.
  persona?: string | null;
}

export function Overview({ t, data, featured, onGoMarket, onGoAnalysis, wallet, persona }: Props) {
  // Real sessions carry true epoch timestamps, so relative time must be based on
  // the real clock, not format.ts's REF_NOW (which exists only to keep mock
  // demo times deterministic and would render every real session as "방금").
  const now = Date.now();
  return (
    <section>
      {/* season banner */}
      <div style={{ position: 'relative', overflow: 'hidden', background: t.banner, border: `1px solid ${t.line}`, borderRadius: 12, padding: '22px 26px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: t.acc }} />
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.28em', color: t.accInk, marginBottom: 9 }}>SEASON 3 · 2026 — ACTIVE</div>
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>돌아오셨어요, {(persona && persona.trim()) || '드라이버'}</div>
          <div style={{ fontSize: 13.5, color: t.t2, marginTop: 5 }}>
            시즌 종료까지 <span style={{ color: t.t1, fontWeight: 600 }}>{data.seasonDaysLeft}일</span> 남았습니다. 지금 페이스면 실버스톤 TT 톱10 진입까지{' '}
            <span style={{ color: t.ok, fontWeight: 600 }}>{(data.ttGapToTop10Ms / 1000).toFixed(3)}s</span>.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 26, flex: 'none' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.18em', color: t.t3, marginBottom: 6 }}>SEASON RANK</div>
            <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: t.t1, lineHeight: 1 }}>P{data.seasonRank}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.18em', color: t.t3, marginBottom: 6 }}>SILVERSTONE TT</div>
            <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: t.accInk, lineHeight: 1 }}>P{data.silverstoneTT}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 344px', gap: 20, alignItems: 'start' }}>
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            <StatCard t={t} label="VERIFIED SESSIONS" value={String(data.verifiedSessions)} valueColor={t.t1} foot={`▲ 이번 주 ${signed(data.verifiedSessionsDelta)}`} footColor={t.ok} />
            <StatCard t={t} label="SEASON BEST" value={msToTime(data.seasonBestMs)} valueColor={t.sbest} foot={data.seasonBestTrack} footColor={t.t2} />
            <StatCard t={t} label="CREDITS · S3" value={`⬢ ${data.creditsSeason.toLocaleString('en-US')}`} valueColor={t.accInk} foot="획득 누계" footColor={t.t2} />
            <StatCard t={t} label="SETUPS SOLD" value={String(data.setupsSold)} valueColor={t.t1} foot={`순수익 ⬢ ${data.setupsNetProfit}`} footColor={t.t2} />
          </div>

          {/* recent sessions */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 13px' }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>RECENT SESSIONS</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>라이브니스 바인딩 검증</div>
            </div>
            {data.recentSessions.map((s, i) => (
              <SessionRow key={i} t={t} s={s} now={now} />
            ))}
          </div>

          {/* pace trend */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>PACE TREND · 최근 12세션</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: t.ok }}>▲ 개선 중</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 84 }}>
              {data.paceTrend.map((h, i) => (
                <div key={i} style={{ flex: 1, height: h, background: i >= data.paceTrend.length - 3 ? t.acc : t.barbase, borderRadius: '3px 3px 0 0' }} />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* wallet */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>CREDIT WALLET</div>
              {/* Real when logged in (3D1); demo otherwise so a mock ledger isn't
                  read as real payouts about real sessions. */}
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.08em', color: wallet ? t.accInk : t.t3, border: `1px solid ${wallet ? t.accBorder : t.line2}`, borderRadius: 4, padding: '2px 6px' }}>{wallet ? '실계정' : '데모'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, color: t.accInk, lineHeight: 0.9 }}>⬢ {(wallet ? wallet.balance : data.spendableCredits).toLocaleString('en-US')}</span>
              <span style={{ fontSize: 11, color: t.t3, paddingBottom: 4 }}>spendable</span>
            </div>
            {/* No escrow in 3D1 (immediate settlement) — the escrow row is mock-only. */}
            {!wallet && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '9px 12px', background: t.warnSoft, border: `1px dashed ${t.warnBorder}`, borderRadius: 8 }}>
                <span style={{ color: t.warn, fontFamily: MONO, fontSize: 13, animation: 'escpulse 1.6s ease-in-out infinite' }}>◷</span>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: t.warn }}>{data.escrowCredits}</span>
                <span style={{ fontSize: 11, color: t.warn, opacity: 0.85 }}>escrowed · 검증 수렴 대기</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={onGoAnalysis} style={{ flex: 1, background: t.acc, color: t.onAcc, border: 0, borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>분석 unlock</button>
              <button onClick={onGoMarket} style={{ flex: 1, background: 'transparent', color: t.t1, border: `1px solid ${t.line2}`, borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>마켓 열기</button>
            </div>
            <div style={{ marginTop: 16, borderTop: `1px solid ${t.linesoft}`, paddingTop: 6 }}>
              {(wallet ? wallet.ledger : data.ledger).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: t.t3, padding: '8px 0' }}>거래 내역 없음</div>
              ) : (
                (wallet ? wallet.ledger : data.ledger).map((l, i) => (
                  <LedgerRow key={i} t={t} l={l} />
                ))
              )}
            </div>
          </div>

          {/* featured market */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>추천 셋업</div>
              <button onClick={onGoMarket} style={{ background: 'transparent', border: 0, color: t.accInk, fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', cursor: 'pointer' }}>ALL →</button>
            </div>
            {featured.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${t.linesoft}` }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: teamColor(c.team), flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3, marginTop: 3 }}>{c.creator} · ★ {c.rating}</div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: t.accInk, flex: 'none' }}>⬢ {c.priceCredits}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ t, label, value, valueColor, foot, footColor }: { t: HubTheme; label: string; value: string; valueColor: string; foot: string; footColor: string }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 11, padding: '15px 16px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.15em', color: t.t3, marginBottom: 11 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, color: valueColor, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: footColor, marginTop: 8 }}>{foot}</div>
    </div>
  );
}

function SessionRow({ t, s, now }: { t: HubTheme; s: HubSession; now: number }) {
  const valid = s.state === 'valid';
  const stateLabel = valid ? '✓ VALID' : '◷ ESCROW';
  const stateColor = valid ? t.green : t.warn;
  const stateBg = valid ? rgba(t.green, 0.12) : t.warnSoft;
  // crDelta 0 = real session with no platform credit ledger yet → hide the badge
  // rather than assert a false "+0 cr".
  const showCr = s.crDelta !== 0;
  const crText = valid ? `${signed(s.crDelta)} cr` : `${signed(s.crDelta)} 대기`;
  const crColor = valid ? t.green : t.warn;
  const lapText = s.lapMs > 0 ? msToTime(s.lapMs) : '—';
  const timeText = s.atMs > 0 ? relativeTime(s.atMs, now) : '—';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 50px 96px 108px 74px 78px', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: `1px solid ${t.linesoft}` }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.t1 }}>{s.track}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', color: t.t3, marginLeft: 9 }}>{s.type}</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.t2 }}>P{s.pos}</div>
      <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: t.t1 }}>{lapText}</div>
      <div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '.05em', padding: '4px 9px', borderRadius: 5, color: stateColor, background: stateBg }}>{stateLabel}</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: crColor, textAlign: 'right' }}>{showCr ? crText : ''}</div>
      <div style={{ fontSize: 11, color: t.t3, textAlign: 'right' }}>{timeText}</div>
    </div>
  );
}

function LedgerRow({ t, l }: { t: HubTheme; l: HubLedgerEntry }) {
  const escrow = l.state === 'escrow';
  const deltaColor = escrow ? t.warn : l.amount >= 0 ? t.green : t.negRed;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${t.linesoft}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: t.t1, fontWeight: 600 }}>{l.label}</div>
        <div style={{ fontSize: 10.5, color: t.t3, marginTop: 2 }}>{l.sub}</div>
      </div>
      {escrow && (
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.06em', color: t.warn, border: `1px solid ${t.warnBorder}`, borderRadius: 4, padding: '2px 5px' }}>ESCROW</span>
      )}
      <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: deltaColor }}>{signed(l.amount)}</div>
    </div>
  );
}
