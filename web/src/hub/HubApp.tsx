// FRC Engineer Hub — root shell. Owns top-level navigation + session state and
// threads the shared track context into the leaderboard and marketplace. Data
// is real: own telemetry (OwnHubDataSource), platform leaderboards, wallet, and
// the hosted marketplace. Screens render explicit empty states, not demo data.
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenBoundary } from '../components/ScreenBoundary';
import './hub.css';
import { buildTheme, hubCssVars, rowPadFor } from './theme';
import { relativeTime } from './format';
import { OwnHubDataSource } from './data/http';
import { DEFAULT_TRACK_CONTEXT, trackContextFor, trackName } from './data/tracks';
import type { TrackContext } from './data/tracks';
import type { HubOverview, HubLedgerEntry, LeaderboardBoard, LeaderboardPosition } from './data/types';
import { Sidebar } from './components/Sidebar';
import type { HubScreen } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import type { RealWallet } from './screens/Overview';
import { useLeaderboard } from './data/useLeaderboard';
import { leaderboardContextKey, leaderboardPosition } from './data/leaderboardState';
import { Guide } from './screens/Guide';
import { ViewAsBanner } from './components/ViewAsBanner';
import { UpdateLogs } from './screens/UpdateLogs';
import { isPlatformConfigured } from './data/platformBase';
import { PlatformMarket, PlatformSearch } from './data/platform';
import type { PlatformLedgerEntry, PlatformListingCard } from './data/platform';
import type { SearchResult } from './search';
import {
  captureTokenFromFragment, fetchMeWithToken, beginSteamLogin, createPairingCode,
  getParentSessionToken, getViewAsToken, storeViewAsSession, clearViewAsSession,
  clearParentSessionToken, clearCurrentParentSession, startViewAs, exitViewAs, revokeSession,
  subscribeSessionUnauthorized, notifySessionUnauthorized, SessionRequestError,
} from './data/session';
import type { PlatformAccount } from './data/session';
import { canDeleteAdminAnalysisReports, canManageRBAC, canReadAdminAnalysisReports, canReadRaceAnalysis, canReadStrategy, canViewFeedbackInbox } from './data/permissions';
import { isCurrentSessionSnapshot, isParentStorageChange, parentRevalidationFailureAction, resolveBootstrapIdentity, sessionSubtreeKey, sessionUnauthorizedAction, viewAsEntryFailureAction } from './data/sessionState';

const FONT = "'IBM Plex Sans KR',system-ui,sans-serif";

const Overview = lazy(() => import('./screens/Overview').then(module => ({ default: module.Overview })));
const Rankings = lazy(() => import('./screens/Rankings').then(module => ({ default: module.Rankings })));
const MarketManage = lazy(() => import('./screens/MarketManage').then(module => ({ default: module.MarketManage })));
const Profile = lazy(() => import('./screens/Profile').then(module => ({ default: module.Profile })));
const Feedback = lazy(() => import('./screens/Feedback').then(module => ({ default: module.Feedback })));
const FeedbackInbox = lazy(() => import('./screens/FeedbackInbox').then(module => ({ default: module.FeedbackInbox })));
const Analysis = lazy(() => import('./screens/Analysis').then(module => ({ default: module.Analysis })));
const Access = lazy(() => import('./screens/Access').then(module => ({ default: module.Access })));
const DriverProfile = lazy(() => import('./screens/DriverProfile').then(module => ({ default: module.DriverProfile })));
const MySetups = lazy(() => import('./screens/MySetups').then(module => ({ default: module.MySetups })));
const Strategy = lazy(() => import('./screens/Strategy').then(module => ({ default: module.Strategy })));

export function HubApp({ onLaunchLive }: { onLaunchLive: () => void }) {
  const t = useMemo(() => buildTheme('#e0a83d', 'light'), []);
  // Own telemetry summary over HTTP; returns the honest empty state when the
  // local desktop server is absent (Vercel standalone / remote viewing).
  const dataSource = useMemo(() => new OwnHubDataSource(), []);
  const rowPad = rowPadFor('comfortable');

  // "맨 처음 가이드 페이지"는 딥링크가 아닌 Hub 진입의 기본 화면을 뜻한다.
  const [active, setActive] = useState<HubScreen>('guide');
  const [rankTab, setRankTab] = useState<LeaderboardBoard>('pb');
  // Shared track+format context for the leaderboards and the marketplace browse.
  const [trackCtx, setTrackCtx] = useState<TrackContext>(DEFAULT_TRACK_CONTEXT);
  const platformMkt = useMemo(() => new PlatformMarket(), []);
  const platformSearch = useMemo(() => new PlatformSearch(), []);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const [selectedDriverAccountId, setSelectedDriverAccountId] = useState<string | null>(null);
  const [searchBuyer, setSearchBuyer] = useState<PlatformListingCard | null>(null);
  // A late default-context response must not undo a track chosen by the user
  // (including a global-search handoff). The request generation also isolates
  // a previous account's listMyRaces response after login changes.
  const trackContextGeneration = useRef(0);
  const raceContextRequestGeneration = useRef(0);

  const [overview, setOverview] = useState<HubOverview | null>(null);
  const [rankSelection, setRankSelection] = useState<{ context: string; position: LeaderboardPosition } | null>(null);

  // Hosted platform session (Steam login). null account = logged out.
  // Unconfigured platform → login disabled.
  const platformConfigured = useMemo(() => isPlatformConfigured(), []);
  const [platformAccount, setPlatformAccount] = useState<PlatformAccount | null>(null);
  const [platformLoading, setPlatformLoading] = useState(platformConfigured);
  const [realWallet, setRealWallet] = useState<RealWallet | null>(null);
  const [viewAs, setViewAs] = useState<{ actor: PlatformAccount; expiresAt: string } | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const sessionEpochRef = useRef(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const viewOnly = viewAs !== null;
  const [strategyDenied, setStrategyDenied] = useState(false);
  const strategyRefreshGeneration = useRef(0);
  const strategyAllowed = !viewOnly && !strategyDenied && canReadStrategy(platformAccount);
  const walletGen = useRef(0);

  const advanceSessionEpoch = useCallback(() => {
    const next = ++sessionEpochRef.current;
    setSessionEpoch(next);
    return next;
  }, []);

  const clearOwnerState = useCallback(() => {
    setStrategyDenied(false);
    strategyRefreshGeneration.current += 1;
    walletGen.current += 1;
    raceContextRequestGeneration.current += 1;
    setRealWallet(null);
    setRankSelection(null);
    setOverview(null);
    setHighlightedAccountId(null);
    setSelectedDriverAccountId(null);
    setSearchBuyer(null);
    setTrackCtx(DEFAULT_TRACK_CONTEXT);
    trackContextGeneration.current += 1;
  }, []);

  // Load the real wallet + ledger for a logged-in account (3D1). refreshWallet is
  // also handed to the market so a purchase updates the Overview wallet card.
  // walletGen: 로그아웃 직후 늦게 도착한 in-flight 응답이 지갑을 되살리지 못하도록
  // 세대 토큰으로 stale 응답을 무시한다.
  const refreshWallet = useMemo(() => () => {
    const gen = ++walletGen.current;
    const epoch = sessionEpochRef.current;
    if (!platformConfigured || !platformAccount) { setRealWallet(null); return; }
    void Promise.all([platformMkt.getWallet(), platformMkt.getLedger()])
      .then(([wallet, ledger]) => {
        if (gen !== walletGen.current || epoch !== sessionEpochRef.current) return;
        setRealWallet({ balance: wallet.balance, initialized: wallet.initialized, ledger: ledger.map(toHubLedger) });
      })
      .catch(() => { /* keep prior on transient error */ });
  }, [platformConfigured, platformAccount, platformMkt]);

  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  useEffect(() => {
    if (viewOnly) { setOverview(null); return; }
    let alive = true;
    const epoch = sessionEpochRef.current;
    void dataSource.getOverview().then((d) => { if (alive && epoch === sessionEpochRef.current) setOverview(d); });
    return () => { alive = false; };
  }, [dataSource, sessionEpoch, viewOnly]);

  const rankContext = leaderboardContextKey(rankTab, trackCtx.trackId, trackCtx.format, platformAccount?.id ?? null, sessionEpoch);
  const rankPosition = leaderboardPosition(rankContext, rankSelection);
  const rankings = useLeaderboard(platformMkt, { ...trackCtx, board: rankTab, ...rankPosition }, rankContext, platformConfigured && !platformLoading, sessionEpochRef);
  // Overview PB metadata has its own query identity, independent of source,
  // page and selected-driver neighborhood in Rankings.
  const pbContext = leaderboardContextKey('pb', trackCtx.trackId, trackCtx.format, platformAccount?.id ?? null, sessionEpoch);
  const overviewPB = useLeaderboard(platformMkt, { ...trackCtx, board: 'pb', limit: 1 }, pbContext, platformConfigured && !platformLoading && !!platformAccount, sessionEpochRef);

  // Once logged in, default the track context to the viewer's most recent race
  // so the board opens on a track they actually drive. Manual selection wins after.
  useEffect(() => {
    if (!platformConfigured || !platformAccount) return;
    let alive = true;
    const epoch = sessionEpochRef.current;
    const requestGeneration = ++raceContextRequestGeneration.current;
    const contextGeneration = trackContextGeneration.current;
    void platformMkt.listMyRaces().then((races) => {
      if (!alive || epoch !== sessionEpochRef.current || requestGeneration !== raceContextRequestGeneration.current || contextGeneration !== trackContextGeneration.current || races.length === 0) return;
      setTrackCtx(trackContextFor(races[0].trackId, races[0].gameFormat));
    }).catch(() => { /* keep default context */ });
    return () => { alive = false; };
  }, [platformConfigured, platformAccount?.id, platformMkt, sessionEpoch]);

  const bootstrapSession = useCallback(async () => {
    const epoch = advanceSessionEpoch();
    clearOwnerState();
    setPlatformAccount(null);
    setViewAs(null);
    setPlatformLoading(true);
    setSessionBusy(false);
    const parentToken = getParentSessionToken();
    const childToken = getViewAsToken();
    if (!parentToken) {
      if (sessionEpochRef.current === epoch) {
        clearViewAsSession();
        setPlatformAccount(null);
        setViewAs(null);
        setPlatformLoading(false);
      }
      return;
    }
    const [parentResult, childResult] = await Promise.allSettled([
      fetchMeWithToken(parentToken),
      childToken ? fetchMeWithToken(childToken) : Promise.resolve(null),
    ]);
    if (sessionEpochRef.current !== epoch || getParentSessionToken() !== parentToken || getViewAsToken() !== childToken) return;
    if (parentResult.status === 'rejected') {
      if (parentResult.reason instanceof SessionRequestError && parentResult.reason.status === 401) clearParentSessionToken();
      clearViewAsSession();
      setPlatformAccount(null);
      setViewAs(null);
      setPlatformLoading(false);
      setActive('profile');
      return;
    }
    const actor = parentResult.value;
    const subject = childResult.status === 'fulfilled' ? childResult.value : null;
    const identity = resolveBootstrapIdentity(actor, childToken ? subject : null);
    if (identity.mode === 'view-as') {
      setPlatformAccount(identity.account);
      setViewAs({ actor: identity.actor, expiresAt: identity.expiresAt });
      setActive('profile');
    } else {
      clearViewAsSession();
      setPlatformAccount(identity.account);
      setViewAs(null);
    }
    setPlatformLoading(false);
  }, [advanceSessionEpoch, clearOwnerState]);

  const recoverChildSession = useCallback(async (capturedChild: string, capturedEpoch: number, destination: 'profile' | 'access' = 'profile') => {
    if (!isCurrentSessionSnapshot({ childToken: capturedChild, epoch: capturedEpoch }, getViewAsToken(), sessionEpochRef.current)) return;
    const epoch = advanceSessionEpoch();
    clearOwnerState();
    clearViewAsSession();
    setPlatformAccount(null);
    setViewAs(null);
    setPlatformLoading(true);
    setSessionBusy(true);
    const parentToken = getParentSessionToken();
    if (!parentToken) {
      setPlatformAccount(null);
      setPlatformLoading(false);
      setSessionBusy(false);
      setActive('profile');
      return;
    }
    try {
      const actor = await fetchMeWithToken(parentToken);
      if (sessionEpochRef.current !== epoch || getParentSessionToken() !== parentToken || getViewAsToken()) return;
      setPlatformAccount(actor);
      setActive(destination === 'access' && canManageRBAC(actor) ? 'access' : 'profile');
    } catch (error: unknown) {
      if (sessionEpochRef.current !== epoch || getParentSessionToken() !== parentToken || getViewAsToken()) return;
      if (parentRevalidationFailureAction(error instanceof SessionRequestError ? error.status : null) === 'clear-parent') clearParentSessionToken();
      setPlatformAccount(null);
      setActive('profile');
    } finally {
      if (sessionEpochRef.current === epoch) {
        setPlatformLoading(false);
        setSessionBusy(false);
      }
    }
  }, [advanceSessionEpoch, clearOwnerState]);

  useEffect(() => {
    if (!platformConfigured) { setPlatformLoading(false); return; }
    captureTokenFromFragment();
    void bootstrapSession();
  }, [bootstrapSession, platformConfigured]);

  useEffect(() => subscribeSessionUnauthorized((token) => {
    const epoch = sessionEpochRef.current;
    const child = getViewAsToken();
    const parent = getParentSessionToken();
    const action = sessionUnauthorizedAction(token, parent, child);
    if (action === 'recover-child' && child) {
      void recoverChildSession(child, epoch);
    } else if (action === 'clear-parent' && sessionEpochRef.current === epoch) {
      advanceSessionEpoch();
      clearOwnerState();
      clearParentSessionToken();
      setPlatformAccount(null);
      setViewAs(null);
      setPlatformLoading(false);
      setActive('profile');
    }
  }), [advanceSessionEpoch, clearOwnerState, recoverChildSession]);

  useEffect(() => {
    const child = getViewAsToken();
    if (!child || !viewAs) return;
    const epoch = sessionEpochRef.current;
    const delay = Math.max(0, Date.parse(viewAs.expiresAt) - Date.now());
    const timer = window.setTimeout(() => void recoverChildSession(child, epoch), delay);
    return () => window.clearTimeout(timer);
  }, [recoverChildSession, viewAs]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!isParentStorageChange(event.key)) return;
      const child = getViewAsToken();
      if (child) void recoverChildSession(child, sessionEpochRef.current);
      else void bootstrapSession();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [bootstrapSession, recoverChildSession]);

  // Refresh grants on entry/focus, including grants added after login. A late
  // response from a prior token or View As transition must not restore access.
  const refreshStrategyAccess = useCallback(async () => {
    const token = getParentSessionToken();
    if (!platformConfigured || !token || getViewAsToken()) return;
    const epoch = sessionEpochRef.current;
    const generation = ++strategyRefreshGeneration.current;
    const current = () => generation === strategyRefreshGeneration.current && epoch === sessionEpochRef.current
      && token === getParentSessionToken() && !getViewAsToken();
    try {
      const account = await fetchMeWithToken(token);
      if (!current()) return;
      setPlatformAccount(previous => {
        if (!previous || previous.id !== account.id) return previous;
        if (previous.banned === account.banned && JSON.stringify(previous.permissions) === JSON.stringify(account.permissions)) return previous;
        return { ...previous, banned: account.banned, permissions: account.permissions };
      });
      setStrategyDenied(false);
    } catch (error) {
      if (current() && error instanceof SessionRequestError && error.status === 401) notifySessionUnauthorized(token);
    }
  }, [platformConfigured]);

  useEffect(() => {
    const refresh = () => { void refreshStrategyAccess(); };
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); strategyRefreshGeneration.current += 1; };
  }, [refreshStrategyAccess, sessionEpoch, viewOnly]);

  useEffect(() => {
    if (active === 'strategy' && !viewOnly) void refreshStrategyAccess();
  }, [active, refreshStrategyAccess, sessionEpoch, viewOnly]);

  const handleStrategyDenied = useCallback(() => {
    strategyRefreshGeneration.current += 1;
    setStrategyDenied(true);
  }, []);

  const handleLogout = useCallback(() => {
    const parentToken = getParentSessionToken();
    advanceSessionEpoch();
    clearOwnerState();
    setPlatformAccount(null);
    setViewAs(null);
    setPlatformLoading(false);
    clearViewAsSession();
    clearParentSessionToken();
    setActive('profile');
    if (parentToken) void revokeSession(parentToken);
  }, [advanceSessionEpoch, clearOwnerState]);

  const handleStartViewAs = useCallback(async (accountId: string) => {
    const parentToken = getParentSessionToken();
    const actor = platformAccount;
    if (!parentToken || !actor || viewAs) throw new Error('View As를 시작할 수 없습니다');
    const epoch = advanceSessionEpoch();
    setSessionBusy(true);
    try {
      let started;
      try {
        started = await startViewAs(accountId, parentToken);
      } catch (error: unknown) {
        const status = error instanceof SessionRequestError ? error.status : null;
        if (
          viewAsEntryFailureAction('start-with-parent', status) === 'logout-parent'
          && sessionEpochRef.current === epoch
          && clearCurrentParentSession(parentToken, null)
        ) {
          advanceSessionEpoch();
          clearOwnerState();
          setPlatformAccount(null);
          setViewAs(null);
          setPlatformLoading(false);
          setSessionBusy(false);
          setActive('profile');
          return;
        }
        throw error;
      }
      if (sessionEpochRef.current !== epoch || getParentSessionToken() !== parentToken || getViewAsToken()) return;
      storeViewAsSession(started.token, started.expiresAt);
      let subject;
      try {
        subject = await fetchMeWithToken(started.token);
      } catch (error: unknown) {
        const action = viewAsEntryFailureAction('validate-child', error instanceof SessionRequestError ? error.status : null);
        if (action === 'recover-parent') {
          await recoverChildSession(started.token, epoch);
          return;
        }
        if (action === 'clear-child' && sessionEpochRef.current === epoch && getParentSessionToken() === parentToken && getViewAsToken() === started.token) clearViewAsSession();
        throw error;
      }
      if (sessionEpochRef.current !== epoch || getParentSessionToken() !== parentToken || getViewAsToken() !== started.token) return;
      if (!subject.viewAs || subject.viewAs.actor.id !== actor.id) throw new Error('View As identity mismatch');
      clearOwnerState();
      setPlatformAccount(subject);
      setViewAs({ actor, expiresAt: subject.viewAs.expiresAt });
      setPlatformLoading(false);
      setActive('profile');
    } catch (error) {
      if (sessionEpochRef.current === epoch && getParentSessionToken() === parentToken) clearViewAsSession();
      throw error;
    } finally {
      if (sessionEpochRef.current === epoch) setSessionBusy(false);
    }
  }, [advanceSessionEpoch, clearOwnerState, platformAccount, recoverChildSession, viewAs]);

  const handleExitViewAs = useCallback(() => {
    const child = getViewAsToken();
    if (!child) return;
    const epoch = sessionEpochRef.current;
    void exitViewAs(child).catch(() => undefined);
    void recoverChildSession(child, epoch, 'access');
  }, [recoverChildSession]);

  const ctx = ctxLabel(active, trackCtx);
  const setUserTrackContext = (context: TrackContext) => {
    trackContextGeneration.current += 1;
    setTrackCtx(trackContextFor(context.trackId, context.format));
    setRankSelection(null);
  };
  const setManualTrack = (trackId: number) => {
    setHighlightedAccountId(null);
    setUserTrackContext({ trackId, format: trackCtx.format });
  };
  const setManualFormat = (format: string) => {
    setHighlightedAccountId(null);
    setUserTrackContext({ trackId: trackCtx.trackId, format });
  };
  const setManualTrackCtx = (context: TrackContext) => {
    setHighlightedAccountId(null);
    setUserTrackContext(context);
  };
  const selectSearchResult = (result: SearchResult) => {
    if (result.type === 'setup') {
      setHighlightedAccountId(null);
      setUserTrackContext({ trackId: result.card.trackId, format: result.card.gameFormat });
      setSearchBuyer(result.card);
      setActive('market');
      return;
    }
    if (result.type === 'driver') {
      setHighlightedAccountId(null);
      setSelectedDriverAccountId(result.driver.accountId);
      setActive('driver-profile');
      return;
    }
    setHighlightedAccountId(null);
    setUserTrackContext({ trackId: result.track.id, format: trackCtx.format });
    setActive('rankings');
  };

  const openDriverRanking = (accountId: string, trackId: number, format: string, board: LeaderboardBoard) => {
    const context = trackContextFor(trackId, format);
    setUserTrackContext(context);
    setRankTab(board);
    setHighlightedAccountId(accountId);
    setRankSelection({ context: leaderboardContextKey(board, context.trackId, context.format, platformAccount?.id ?? null, sessionEpoch), position: { around: accountId } });
    setActive('rankings');
  };
  const pbData = overviewPB.data;
  const rankInfo = platformAccount && pbData?.viewer ? { rank: pbData.viewer.rank, gapMs: pbData.viewerGapToTop10Ms, trackName: trackName(trackCtx.trackId) } : null;

  const rootStyle = {
    ...hubCssVars(t),
    '--line': t.line, '--panel': t.panel, '--panel2': t.panel2,
    '--t1': t.t1, '--t2': t.t2, '--t3': t.t3,
    '--acc': t.acc, '--accInk': t.accInk,
    display: 'flex', height: '100vh', overflow: 'hidden',
    background: t.bg, color: t.t1, fontFamily: FONT,
  } as React.CSSProperties;

  return (
    <div className="hubRoot" style={rootStyle}>
      <Sidebar t={t} active={active} onNav={setActive} onLaunchLive={onLaunchLive} account={platformAccount} viewOnly={viewOnly} strategyDenied={strategyDenied} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar t={t} ctx={ctx} credits={realWallet ? realWallet.balance : null} walletInitialized={realWallet?.initialized} search={platformSearch} onSearchSelect={selectSearchResult} />
        {viewAs && platformAccount && <ViewAsBanner t={t} subject={platformAccount} actorPersona={viewAs.actor.persona} expiresAt={viewAs.expiresAt} busy={sessionBusy} onExit={handleExitViewAs} />}
        <main key={sessionSubtreeKey(viewOnly ? 'view-as' : 'normal', platformAccount?.id ?? null, sessionEpoch)} style={{ flex: 1, minHeight: 0, padding: 24, overflow: 'auto' }}>
          <UpdateLogs t={t} active={active === 'updates'} configured={platformConfigured} account={platformAccount} ready={!platformLoading && !sessionBusy} market={platformMkt} viewOnly={viewOnly} />
          <ScreenBoundary resetKey={active} onBack={() => setActive('guide')}>
          {active === 'guide' && <Guide t={t} onLaunchLive={onLaunchLive} onGoOverview={() => setActive('overview')} viewOnly={viewOnly} />}

          {active === 'overview' && (viewOnly ? (
            <Placeholder t={t} title="OVERVIEW" note="View As에서는 이 PC의 로컬 텔레메트리·리플레이를 대상 사용자 데이터로 표시하지 않습니다." />
          ) : overview ? (
            <Overview
              t={t} data={overview} wallet={realWallet} persona={platformAccount?.persona} rankInfo={rankInfo}
              rankStatus={!platformConfigured ? 'unconfigured' : platformLoading ? 'loading' : !platformAccount ? 'anonymous' : overviewPB.status}
              rankError={overviewPB.error} onRetryRank={overviewPB.retry}
              onGoRankings={() => { if (platformAccount) openDriverRanking(platformAccount.id, trackCtx.trackId, trackCtx.format, 'pb'); }}
              onGoMarket={() => setActive('market')} onGoAnalysis={() => setActive('analysis')}
            />
          ) : <Loading t={t} />)}

          {active === 'rankings' && (
            <Rankings
              t={t} load={rankings} configured={platformConfigured} signedIn={!!platformAccount && !platformLoading}
              trackId={trackCtx.trackId} format={trackCtx.format}
              onSetTrack={setManualTrack} onSetFormat={setManualFormat}
              tab={rankTab} onSetTab={(board) => { setRankTab(board); setRankSelection(null); setHighlightedAccountId(null); }} rowPad={rowPad}
              position={rankPosition} onNavigate={(position) => {
                if (position.around === 'me') setHighlightedAccountId(null);
                setRankSelection({ context: rankContext, position });
              }} onRetry={rankings.retry}
              highlightAccountId={highlightedAccountId}
            />
          )}

          {active === 'market' && (
            <MarketManage
              t={t} configured={platformConfigured} account={platformAccount}
              market={platformMkt} trackCtx={trackCtx} onSetTrackCtx={setManualTrackCtx}
              onEconomyChange={refreshWallet}
              searchBuyer={searchBuyer} onSearchBuyerOpened={() => setSearchBuyer(null)}
              viewOnly={viewOnly}
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
              viewOnly={viewOnly}
            />
          )}

          {active === 'strategy' && (strategyAllowed ? (
            <Strategy track={trackCtx} onSetTrack={setManualTrackCtx} onDenied={handleStrategyDenied} />
          ) : <section><h2>전략 실험실</h2><p>전략 조회 권한이 필요합니다. 관리자에게 권한을 요청하세요.</p><button onClick={() => void refreshStrategyAccess()}>권한 다시 확인</button></section>)}

          {active === 'driver-profile' && selectedDriverAccountId && (
            <DriverProfile
              t={t} configured={platformConfigured} account={platformAccount}
              platformLoading={platformLoading} onLogin={beginSteamLogin}
              client={platformMkt} accountId={selectedDriverAccountId} onGoRankings={openDriverRanking}
            />
          )}

          {active === 'feedback' && (
            <Feedback t={t} configured={platformConfigured} account={platformAccount} market={platformMkt} viewOnly={viewOnly} />
          )}

          {/* FEEDBACK INBOX: Sidebar visibility is only a convenience. Recheck
              the explicit, banned-aware grant before mounting the data screen. */}
          {active === 'feedback-inbox' && (
            !viewOnly && platformAccount && canViewFeedbackInbox(platformAccount) ? (
              <FeedbackInbox
                key={`${platformAccount.id}:${platformAccount.permissions?.join('\u0001') ?? ''}`}
                t={t} market={platformMkt} account={platformAccount}
              />
            ) : (
              <Placeholder t={t} title="FEEDBACK INBOX" note="피드백 인박스는 별도 열람 권한이 있는 계정에서만 열립니다." />
            )
          )}

          {active === 'setups' && (
            <MySetups
              t={t} configured={platformConfigured} loading={platformLoading}
              account={platformAccount} market={platformMkt}
              onLogin={beginSteamLogin}
              viewOnly={viewOnly}
            />
          )}

          {/* ANALYSIS is an owner-race screen. Legacy administrator HTML reports,
              if granted, are a separately-gated panel inside it. */}
          {active === 'analysis' && (
            <Analysis
              t={t} market={platformMkt} configured={platformConfigured} loading={platformLoading}
              account={platformAccount} viewOnly={viewOnly}
              canReadOwnerAnalysis={canReadRaceAnalysis(platformAccount)}
              canAdminReports={canReadAdminAnalysisReports(platformAccount)}
              canDeleteAdminReports={canDeleteAdminAnalysisReports(platformAccount)}
            />
          )}

          {/* ACCESS: rbac 권한이 있을 때만. Sidebar가 항목 자체를 감추지만, 권한을
              잃은 채 화면이 열려 있는 경우(회수 후 재조회)를 위해 여기서도 막는다. */}
          {active === 'access' && (
            !viewOnly && platformAccount && canManageRBAC(platformAccount) ? (
              <Access t={t} market={platformMkt} selfAccountId={platformAccount.id} actor={platformAccount} onViewAs={handleStartViewAs} />
            ) : (
              <Placeholder t={t} title="ACCESS" note="권한 관리는 rbac 권한이 있는 계정에서만 열립니다." />
            )
          )}
          </ScreenBoundary>
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
    case 'guide': return 'GUIDE · 시작하기';
    case 'overview': return 'OVERVIEW';
    case 'rankings': return `RANKINGS · ${trackName(trackCtx.trackId).toUpperCase()} · ${trackCtx.format}`;
    case 'market': return 'MARKETPLACE';
    case 'setups': return 'MY SETUPS';
    case 'analysis': return 'ANALYSIS';
    case 'strategy': return 'STRATEGY · 전략 실험실';
    case 'profile': return 'PROFILE';
    case 'feedback': return 'FEEDBACK';
    case 'updates': return 'UPDATES · 업데이트 로그';
    case 'feedback-inbox': return 'FEEDBACK INBOX';
    case 'access': return 'ACCESS · 권한 관리';
    case 'driver-profile': return 'DRIVER PROFILE';
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
