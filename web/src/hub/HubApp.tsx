// FRC Engineer Hub — root shell. Owns top-level navigation + session state and
// threads the shared track context into the leaderboard and marketplace. Data
// is real: own telemetry (OwnHubDataSource), platform leaderboards, wallet, and
// the hosted marketplace. Screens render explicit empty states, not demo data.
import { useEffect, useMemo, useState } from 'react';
import './hub.css';
import { buildTheme, hubCssVars, rowPadFor } from './theme';
import { tyreLabel, relativeTime } from './format';
import { OwnHubDataSource } from './data/http';
import { DEFAULT_TRACK_CONTEXT, trackName } from './data/tracks';
import type { TrackContext } from './data/tracks';
import type { HubOverview, HubRankings, HubLedgerEntry } from './data/types';
import { Sidebar } from './components/Sidebar';
import type { HubScreen } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Overview } from './screens/Overview';
import type { RealWallet } from './screens/Overview';
import { Rankings } from './screens/Rankings';
import { MarketManage } from './screens/MarketManage';
import { Profile } from './screens/Profile';
import { isPlatformConfigured } from './data/platformBase';
import { PlatformMarket } from './data/platform';
import type { PlatformLedgerEntry } from './data/platform';
import {
  captureTokenFromFragment, fetchMe, beginSteamLogin, platformLogout, createPairingCode, getSessionToken,
} from './data/session';
import type { PlatformAccount } from './data/session';

const FONT = "'IBM Plex Sans KR',system-ui,sans-serif";

const PLACEHOLDER: Record<string, { title: string; note: string }> = {
  setups: { title: 'MY SETUPS', note: '캡처·작성 셋업 관리 · 편집 · 불변 스냅샷으로 판매 등록' },
  analysis: { title: 'ANALYSIS', note: '프리미엄 분석 리포트를 크레딧으로 unlock — 순소각 sink' },
};

export function HubApp({ onLaunchLive }: { onLaunchLive: () => void }) {
  const t = useMemo(() => buildTheme('#e0a83d', 'light'), []);
  // Own telemetry summary over HTTP; returns the honest empty state when the
  // local desktop server is absent (Vercel standalone / remote viewing).
  const dataSource = useMemo(() => new OwnHubDataSource(), []);
  const rowPad = rowPadFor('comfortable');

  const [active, setActive] = useState<HubScreen>('overview');
  const [rankTab, setRankTab] = useState<'tt' | 'pace'>('tt');
  // Shared track+format context for the leaderboards and the marketplace browse.
  const [trackCtx, setTrackCtx] = useState<TrackContext>(DEFAULT_TRACK_CONTEXT);
  const platformMkt = useMemo(() => new PlatformMarket(), []);

  const [overview, setOverview] = useState<HubOverview | null>(null);
  const [rankings, setRankings] = useState<HubRankings | null>(null);

  // Hosted platform session (Steam login). null account = logged out.
  // Unconfigured platform → login disabled.
  const platformConfigured = useMemo(() => isPlatformConfigured(), []);
  const [platformAccount, setPlatformAccount] = useState<PlatformAccount | null>(null);
  const [platformLoading, setPlatformLoading] = useState(platformConfigured);
  const [realWallet, setRealWallet] = useState<RealWallet | null>(null);

  // Load the real wallet + ledger for a logged-in account (3D1). refreshWallet is
  // also handed to the market so a purchase updates the Overview wallet card.
  const refreshWallet = useMemo(() => () => {
    if (!platformConfigured || !platformAccount) { setRealWallet(null); return; }
    void Promise.all([platformMkt.getWallet(), platformMkt.getLedger()])
      .then(([balance, ledger]) => setRealWallet({ balance, ledger: ledger.map(toHubLedger) }))
      .catch(() => { /* keep prior on transient error */ });
  }, [platformConfigured, platformAccount, platformMkt]);

  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  useEffect(() => {
    let alive = true;
    void dataSource.getOverview().then((d) => { if (alive) setOverview(d); });
    return () => { alive = false; };
  }, [dataSource]);

  // Leaderboards come straight from the platform for the selected track+format.
  // rankings === null renders as "loading"; a failed/empty fetch renders as the
  // honest empty state (no mock fallback). platformAccount is a dependency so
  // login/logout re-fetches with (or without) the Bearer token — that's what
  // toggles the `you` highlight and the Overview rank card.
  useEffect(() => {
    if (!platformConfigured) { setRankings(null); return; }
    let alive = true;
    setRankings(null);
    void Promise.all([
      platformMkt.leaderboardTT(trackCtx.trackId, trackCtx.format),
      platformMkt.leaderboardPace(trackCtx.trackId, trackCtx.format),
    ]).then(([tt, pace]) => {
      if (!alive) return;
      setRankings({
        tt: tt.map((r) => ({ handle: r.persona, lapMs: r.lapMs, s1Ms: r.s1Ms, s2Ms: r.s2Ms, s3Ms: r.s3Ms, fmt: trackCtx.format, you: r.you })),
        pace: pace.map((r) => ({ handle: r.persona, avgMs: r.avgMs, tyre: tyreLabel(r.tyre), laps: r.laps, consistency: r.consistency, you: r.you })),
      });
    }).catch(() => { if (alive) setRankings({ tt: [], pace: [] }); });
    return () => { alive = false; };
  }, [platformConfigured, platformMkt, trackCtx, platformAccount]);

  // Once logged in, default the track context to the viewer's most recent race
  // so the board opens on a track they actually drive. Manual selection wins after.
  useEffect(() => {
    if (!platformConfigured || !platformAccount) return;
    let alive = true;
    void platformMkt.listMyRaces().then((races) => {
      if (alive && races.length > 0) setTrackCtx({ trackId: races[0].trackId, format: races[0].gameFormat });
    }).catch(() => { /* keep default context */ });
    return () => { alive = false; };
  }, [platformConfigured, platformAccount, platformMkt]);

  useEffect(() => {
    if (!platformConfigured) return;
    captureTokenFromFragment(); // OpenID callback drops the token in the URL fragment.
    if (!getSessionToken()) { setPlatformLoading(false); return; }
    let alive = true;
    void fetchMe().then((acc) => { if (alive) { setPlatformAccount(acc); setPlatformLoading(false); } });
    return () => { alive = false; };
  }, [platformConfigured]);

  const handleLogout = () => { void platformLogout().then(() => setPlatformAccount(null)); };

  const ctx = ctxLabel(active, trackCtx);

  // The viewer's standing on the current TT board, derived from the live
  // leaderboard (the `you` row). null when logged out or not yet ranked here.
  const rankInfo = useMemo(() => {
    if (!rankings || !platformAccount) return null;
    const idx = rankings.tt.findIndex((r) => r.you);
    if (idx < 0) return null;
    const rank = idx + 1;
    const tenth = rankings.tt[9];
    const gapMs = tenth && rank > 10 ? rankings.tt[idx].lapMs - tenth.lapMs : 0;
    return { rank, gapMs, trackName: trackName(trackCtx.trackId) };
  }, [rankings, platformAccount, trackCtx]);

  const rootStyle = {
    ...hubCssVars(t),
    display: 'flex', height: '100vh', overflow: 'hidden',
    background: t.bg, color: t.t1, fontFamily: FONT,
  } as React.CSSProperties;

  return (
    <div className="hubRoot" style={rootStyle}>
      <Sidebar t={t} active={active} onNav={setActive} onLaunchLive={onLaunchLive} account={platformAccount} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar t={t} ctx={ctx} credits={realWallet ? realWallet.balance : null} />
        <main style={{ flex: 1, minHeight: 0, padding: 24, overflow: 'auto' }}>
          {active === 'overview' && (overview ? (
            <Overview t={t} data={overview} wallet={realWallet} persona={platformAccount?.persona} rankInfo={rankInfo} onGoMarket={() => setActive('market')} onGoAnalysis={() => setActive('analysis')} />
          ) : <Loading t={t} />)}

          {active === 'rankings' && (
            <Rankings
              t={t} data={rankings} configured={platformConfigured}
              trackId={trackCtx.trackId} format={trackCtx.format}
              onSetTrack={(id) => setTrackCtx((c) => ({ ...c, trackId: id }))}
              onSetFormat={(f) => setTrackCtx((c) => ({ ...c, format: f }))}
              tab={rankTab} onSetTab={setRankTab} rowPad={rowPad}
            />
          )}

          {active === 'market' && (
            <MarketManage
              t={t} configured={platformConfigured} account={platformAccount}
              market={platformMkt} trackCtx={trackCtx} onSetTrackCtx={setTrackCtx}
              onEconomyChange={refreshWallet}
            />
          )}

          {active === 'profile' && (
            <Profile
              t={t}
              configured={platformConfigured}
              account={platformAccount}
              loading={platformLoading}
              onLogin={beginSteamLogin}
              onLogout={handleLogout}
              onGeneratePairing={createPairingCode}
            />
          )}

          {(active === 'setups' || active === 'analysis') && (
            <Placeholder t={t} title={PLACEHOLDER[active].title} note={PLACEHOLDER[active].note} />
          )}
        </main>
      </div>
    </div>
  );
}

const LEDGER_LABEL: Record<string, string> = {
  grant: '가입 보너스',
  purchase: '구매',
  sale: '판매 수익',
  fee: '수수료',
  sink_unlock: '분석 unlock',
};

// toHubLedger maps a raw platform ledger row to the Overview's display shape.
// 3D1 settles immediately, so every real entry is 'settled' (no escrow).
function toHubLedger(e: PlatformLedgerEntry): HubLedgerEntry {
  const atMs = Date.parse(e.createdAt);
  return {
    label: LEDGER_LABEL[e.kind] ?? e.kind,
    sub: Number.isNaN(atMs) ? e.ref : relativeTime(atMs, Date.now()),
    amount: e.amount,
    state: 'settled',
  };
}

function ctxLabel(active: HubScreen, trackCtx: TrackContext): string {
  switch (active) {
    case 'overview': return 'OVERVIEW';
    case 'rankings': return `RANKINGS · ${trackName(trackCtx.trackId).toUpperCase()} · ${trackCtx.format}`;
    case 'market': return 'MARKETPLACE';
    case 'setups': return 'MY SETUPS';
    case 'analysis': return 'ANALYSIS';
    case 'profile': return 'PROFILE';
  }
}

function Loading({ t }: { t: ReturnType<typeof buildTheme> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '.1em', color: t.t3 }}>
      불러오는 중…
    </div>
  );
}

function Placeholder({ t, title, note }: { t: ReturnType<typeof buildTheme>; title: string; note: string }) {
  return (
    <section style={{ display: 'flex', minHeight: 420, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.28em', color: t.accInk, marginBottom: 14 }}>{title}</div>
        <div style={{ width: '100%', height: 150, border: `1px dashed ${t.line2}`, borderRadius: 12, background: `repeating-linear-gradient(45deg,${t.inset},${t.inset} 11px,${t.panel2} 11px,${t.panel2} 22px)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.1em', color: t.t3 }}>SCREEN — 설계 예정</div>
        <div style={{ fontSize: 13, color: t.t2, marginTop: 18, lineHeight: 1.6 }}>{note}</div>
      </div>
    </section>
  );
}
