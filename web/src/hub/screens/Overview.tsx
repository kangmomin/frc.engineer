// Overview screen (hub.dc.html:73-168).
// Shows the viewer's OWN telemetry summary (verified sessions, season best,
// recent sessions) plus platform-derived data threaded in as props: the real
// credit wallet/ledger (when logged in) and the current-track leaderboard rank.
// Fields that had no backend source (season rank, credits earned, setups sold,
// pace trend) were removed rather than mocked.
import type { HubTheme } from '../theme';
import { rgba } from '../theme';
import { msToTime, relativeTime, signed } from '../format';
import type { HubOverview, HubSession, HubLedgerEntry } from '../data/types';

const MONO = "'JetBrains Mono',monospace";

// RealWallet is the logged-in account's actual platform balance and ledger
// (Phase 3D1). Absent (logged out) → the wallet card shows a login prompt.
export interface RealWallet {
  balance: number;
  initialized: boolean;
  ledger: HubLedgerEntry[];
}

// RankInfo is the viewer's standing on the currently selected track's TT board,
// derived from the live leaderboard. Absent when logged out or not yet ranked.
export interface RankInfo {
  rank: number;
  gapMs: number; // ms to the 10th place lap; 0 when already inside the top 10
  trackName: string;
}

interface Props {
  t: HubTheme;
  data: HubOverview;
  onGoMarket: () => void;
  onGoAnalysis: () => void;
  wallet?: RealWallet | null;
  // Logged-in account's display name for the banner greeting. Absent (logged
  // out / not yet loaded) → generic greeting.
  persona?: string | null;
  rankInfo?: RankInfo | null;
}

export function Overview({ t, data, onGoMarket, onGoAnalysis, wallet, persona, rankInfo }: Props) {
  // Real sessions carry true epoch timestamps, so relative time uses the real clock.
  const now = Date.now();
  return (
    <section>
      {/* season banner */}
      <div style={{ position: 'relative', overflow: 'hidden', background: t.banner, border: `1px solid ${t.line}`, borderRadius: 12, padding: '22px 26px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: t.acc }} />
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.28em', color: t.accInk, marginBottom: 9 }}>2026 SEASON — ACTIVE</div>
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>돌아오셨어요, {(persona && persona.trim()) || '드라이버'}</div>
          <div style={{ fontSize: 13.5, color: t.t2, marginTop: 5 }}>
            {rankInfo ? (
              <>
                현재 <span style={{ color: t.t1, fontWeight: 600 }}>{rankInfo.trackName}</span> 타임트라이얼{' '}
                <span style={{ color: t.accInk, fontWeight: 700 }}>P{rankInfo.rank}</span>
                {rankInfo.gapMs > 0 && (
                  <> · 톱10 진입까지 <span style={{ color: t.ok, fontWeight: 600 }}>{(rankInfo.gapMs / 1000).toFixed(3)}s</span></>
                )}
              </>
            ) : (
              '트랙에 검증된 랩을 남기면 리더보드 순위가 여기 표시됩니다.'
            )}
          </div>
        </div>
        {rankInfo && (
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.18em', color: t.t3, marginBottom: 6 }}>{rankInfo.trackName.toUpperCase()} · TT</div>
            <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: t.accInk, lineHeight: 1 }}>P{rankInfo.rank}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 344px', gap: 20, alignItems: 'start' }}>
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* stat cards — real own-data only */}
          <div style={{ display: 'grid', gridTemplateColumns: rankInfo ? 'repeat(3,1fr)' : 'repeat(2,1fr)', gap: 12 }}>
            <StatCard t={t} label="VERIFIED SESSIONS" value={String(data.verifiedSessions)} valueColor={t.t1}
              foot={data.verifiedSessionsDelta > 0 ? `▲ 이번 주 ${signed(data.verifiedSessionsDelta)}` : '이번 주 신규 없음'}
              footColor={data.verifiedSessionsDelta > 0 ? t.ok : t.t2} />
            <StatCard t={t} label="SEASON BEST" value={data.seasonBestMs > 0 ? msToTime(data.seasonBestMs) : '—'} valueColor={t.sbest}
              foot={data.seasonBestTrack || '기록 없음'} footColor={t.t2} />
            {rankInfo && (
              <StatCard t={t} label={`${rankInfo.trackName.toUpperCase()} TT`} value={`P${rankInfo.rank}`} valueColor={t.accInk}
                foot={rankInfo.gapMs > 0 ? `톱10까지 ${(rankInfo.gapMs / 1000).toFixed(3)}s` : '톱10 진입'} footColor={t.t2} />
            )}
          </div>

          {/* recent sessions */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 13px' }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>RECENT SESSIONS</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>라이브니스 바인딩 검증</div>
            </div>
            {data.recentSessions.length === 0 ? (
              <div style={{ padding: '28px 18px 32px', textAlign: 'center', fontSize: 12.5, color: t.t3, lineHeight: 1.6 }}>
                아직 세션이 없습니다.<br />데스크톱 앱으로 F1 텔레메트리를 업로드하면 여기에 표시됩니다.
              </div>
            ) : (
              data.recentSessions.map((s, i) => <SessionRow key={i} t={t} s={s} now={now} />)
            )}
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* wallet */}
          <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: t.t2, fontWeight: 600 }}>CREDIT WALLET</div>
            </div>
            {wallet?.initialized ? (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, color: t.accInk, lineHeight: 0.9 }}>⬢ {wallet.balance.toLocaleString('en-US')}</span>
                  <span style={{ fontSize: 11, color: t.t3, paddingBottom: 4 }}>spendable</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={onGoAnalysis} style={{ flex: 1, background: t.acc, color: t.onAcc, border: 0, borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>분석 unlock</button>
                  <button onClick={onGoMarket} style={{ flex: 1, background: 'transparent', color: t.t1, border: `1px solid ${t.line2}`, borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>마켓 열기</button>
                </div>
                <div style={{ marginTop: 16, borderTop: `1px solid ${t.linesoft}`, paddingTop: 6 }}>
                  {wallet.ledger.length === 0 ? (
                    <div style={{ fontFamily: MONO, fontSize: 10.5, color: t.t3, padding: '8px 0' }}>거래 내역 없음</div>
                  ) : (
                    wallet.ledger.map((l, i) => <LedgerRow key={i} t={t} l={l} />)
                  )}
                </div>
              </>
            ) : wallet ? (
              <div style={{ fontSize: 12.5, color: t.t3, lineHeight: 1.6, padding: '6px 0 4px' }}>
                이 계정의 크레딧 지갑은 미개설 상태입니다.
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: t.t3, lineHeight: 1.6, padding: '6px 0 4px' }}>
                Steam으로 로그인하면 크레딧 지갑과 거래 내역이 표시됩니다.
                <div style={{ marginTop: 12 }}>
                  <button onClick={onGoMarket} style={{ background: 'transparent', color: t.t1, border: `1px solid ${t.line2}`, borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>마켓 둘러보기</button>
                </div>
              </div>
            )}
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
