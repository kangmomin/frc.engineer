// FRC Engineer Hub — root shell. Owns all top-level state (the design's
// DCLogic.state, hub.dc.html:561) and wires the setup drawer. Data is loaded
// async from a HubDataSource; screens render once their slice is ready.
import { useEffect, useMemo, useState } from 'react';
import './hub.css';
import { buildTheme, hubCssVars, rowPadFor } from './theme';
import { REF_NOW } from './format';
import { MockHubDataSource } from './data/mock';
import { CompositeHubDataSource } from './data/http';
import { isForcedRemoteMode } from '../runtimeFlags';
import type {
  HubOverview, HubRankings, HubSetupMarket, HubStrategyMarket, HubPerf, HubReview, HubLedgerEntry,
} from './data/types';
import { Sidebar } from './components/Sidebar';
import type { HubScreen } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Overview } from './screens/Overview';
import type { RealWallet } from './screens/Overview';
import { Rankings } from './screens/Rankings';
import { Market } from './screens/Market';
import { MarketManage } from './screens/MarketManage';
import { Profile } from './screens/Profile';
import { SetupDrawer } from './SetupDrawer';
import { relativeTime } from './format';
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
  // Desktop (embedded Go server) → composite: own data over HTTP, rest mock.
  // Vercel standalone (no backend) → pure mock.
  const dataSource = useMemo(() => {
    const mock = new MockHubDataSource();
    return isForcedRemoteMode ? mock : new CompositeHubDataSource(mock);
  }, []);
  const rowPad = rowPadFor('comfortable');

  const [active, setActive] = useState<HubScreen>('overview');
  const [rankTab, setRankTab] = useState<'tt' | 'pace'>('tt');
  const [mktCat, setMktCat] = useState<'setups' | 'strategy'>('setups');
  const [openSetup, setOpenSetup] = useState<string | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const platformMkt = useMemo(() => new PlatformMarket(), []);

  const [ownedMap, setOwnedMap] = useState<Record<string, boolean>>({});
  const [stratOwnedMap, setStratOwnedMap] = useState<Record<string, boolean>>({});
  const [racesMap, setRacesMap] = useState<Record<string, boolean>>({});
  const [perfMap, setPerfMap] = useState<Record<string, HubPerf>>({});
  const [myReviews, setMyReviews] = useState<Record<string, HubReview[]>>({});

  const [overview, setOverview] = useState<HubOverview | null>(null);
  const [rankings, setRankings] = useState<HubRankings | null>(null);
  const [setupMkt, setSetupMkt] = useState<HubSetupMarket | null>(null);
  const [stratMkt, setStratMkt] = useState<HubStrategyMarket | null>(null);

  // Hosted platform session (Steam login). Distinct from the mock/own-data
  // sources: null account = logged out. Unconfigured platform → login disabled.
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
      .catch(() => { /* keep prior/mock on transient error */ });
  }, [platformConfigured, platformAccount, platformMkt]);

  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  useEffect(() => {
    let alive = true;
    void dataSource.getOverview().then((d) => { if (alive) setOverview(d); });
    void dataSource.getRankings().then((d) => { if (alive) setRankings(d); });
    void dataSource.getSetupMarket().then((d) => { if (alive) setSetupMkt(d); });
    void dataSource.getStrategyMarket().then((d) => { if (alive) setStratMkt(d); });
    return () => { alive = false; };
  }, [dataSource]);

  useEffect(() => {
    if (!platformConfigured) return;
    captureTokenFromFragment(); // OpenID callback drops the token in the URL fragment.
    if (!getSessionToken()) { setPlatformLoading(false); return; }
    let alive = true;
    void fetchMe().then((acc) => { if (alive) { setPlatformAccount(acc); setPlatformLoading(false); } });
    return () => { alive = false; };
  }, [platformConfigured]);

  const handleLogout = () => { void platformLogout().then(() => setPlatformAccount(null)); };

  const ctx = ctxLabel(active, mktCat);
  const featured = useMemo(() => (setupMkt ? setupMkt.setups.filter((c) => c.priceCredits != null).slice(0, 2) : []), [setupMkt]);

  const rootStyle = {
    ...hubCssVars(t),
    display: 'flex', height: '100vh', overflow: 'hidden',
    background: t.bg, color: t.t1, fontFamily: FONT,
  } as React.CSSProperties;

  const openItem = openSetup && setupMkt ? setupMkt.setups.find((c) => c.id === openSetup) ?? null : null;

  return (
    <div className="hubRoot" style={rootStyle}>
      <Sidebar t={t} active={active} onNav={setActive} onLaunchLive={onLaunchLive} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar t={t} ctx={ctx} spendableCredits={overview?.spendableCredits ?? 0} escrowCredits={overview?.escrowCredits ?? 0} />
        <main style={{ flex: 1, minHeight: 0, padding: 24, overflow: 'auto' }}>
          {active === 'overview' && (overview ? (
            <Overview t={t} data={overview} featured={featured} wallet={realWallet} onGoMarket={() => setActive('market')} onGoAnalysis={() => setActive('analysis')} />
          ) : <Loading t={t} />)}

          {active === 'rankings' && (rankings ? (
            <Rankings t={t} data={rankings} tab={rankTab} onSetTab={setRankTab} rowPad={rowPad} />
          ) : <Loading t={t} />)}

          {active === 'market' && (setupMkt && stratMkt ? (
            <>
              <MarketManage
                t={t} configured={platformConfigured} account={platformAccount}
                market={platformMkt} defaultKind={mktCat === 'setups' ? 'setup' : 'strategy'}
                sellOpen={sellOpen} onCloseSell={() => setSellOpen(false)}
                onEconomyChange={refreshWallet}
              />
              <Market
                t={t} cat={mktCat} onSetCat={setMktCat}
                setups={setupMkt.setups} setupSimilar={setupMkt.similar}
                strategies={stratMkt.strategies} strategySimilar={stratMkt.similar}
                ownedMap={ownedMap} stratOwnedMap={stratOwnedMap} myReviews={myReviews}
                onOpenSetup={setOpenSetup}
                onBuyStrategy={(id) => setStratOwnedMap((s) => ({ ...s, [id]: true }))}
                onSell={platformConfigured && platformAccount ? () => setSellOpen(true) : undefined}
              />
            </>
          ) : <Loading t={t} />)}

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

      {openItem && (
        <SetupDrawer
          key={openItem.id}
          t={t}
          item={openItem}
          owned={!!ownedMap[openItem.id]}
          racesShown={openItem.id in racesMap ? racesMap[openItem.id] : openItem.showRaces}
          sellerPerf={perfMap[openItem.id] ?? openItem.perf}
          reviews={[...(myReviews[openItem.id] ?? []), ...openItem.reviews]}
          onClose={() => setOpenSetup(null)}
          onBuyUnlock={() => setOwnedMap((s) => ({ ...s, [openItem.id]: true }))}
          onToggleRaces={() => setRacesMap((s) => ({ ...s, [openItem.id]: !(openItem.id in s ? s[openItem.id] : openItem.showRaces) }))}
          onSetPerf={(key, value) => setPerfMap((s) => ({ ...s, [openItem.id]: { ...(s[openItem.id] ?? openItem.perf), [key]: value } }))}
          onSubmitReview={(r) => setMyReviews((s) => ({
            ...s,
            [openItem.id]: [{ reviewer: 'kangmomin', stars: r.stars, verifiedBuyer: true, text: r.text, atMs: REF_NOW, perf: r.perf }, ...(s[openItem.id] ?? [])],
          }))}
        />
      )}
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

function ctxLabel(active: HubScreen, mktCat: 'setups' | 'strategy'): string {
  switch (active) {
    case 'overview': return 'OVERVIEW';
    case 'rankings': return 'RANKINGS · SILVERSTONE GP · F1 25';
    case 'market': return `MARKET · ${mktCat === 'setups' ? 'SETUP' : 'STRATEGY'} EXCHANGE`;
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
