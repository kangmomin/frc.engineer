import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { msToTime } from '../format';
import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';
import { PlatformMarket, RaceAnalysisError } from '../data/platform';
import type {
  IncidentReplay as IncidentReplayValue,
  RaceAnalysisDetail as RaceAnalysisDetailValue,
  RaceAnalysisListItem,
} from '../data/raceAnalysisTypes';
import { canReadRaceAnalysis } from '../data/permissions';
import { AdminAnalysisReports } from './AdminAnalysisReports';
import { IncidentReplay } from './IncidentReplay';
import { RaceAnalysisDetail } from './RaceAnalysisDetail';
import {
  appendAnalysisPage,
  incidentFailureTransition,
  isCurrentRaceAnalysisGeneration,
  type RaceAnalysisFailureReason,
} from './raceAnalysisState';
import styles from './Analysis.module.css';

interface Props {
  t: HubTheme;
  market: PlatformMarket;
  configured?: boolean;
  loading?: boolean;
  account?: PlatformAccount | null;
  viewOnly?: boolean;
  canReadOwnerAnalysis?: boolean;
  canAdminReports?: boolean;
  canDeleteAdminReports?: boolean;
}

export interface ListState {
  kind: 'idle' | 'loading' | 'ready' | 'error';
  items: RaceAnalysisListItem[];
  nextOffset: number | null;
  loadingMore: boolean;
  error: RaceAnalysisFailureReason | null;
}

interface DetailState {
  kind: 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
  id: string | null;
  value: RaceAnalysisDetailValue | null;
  error: RaceAnalysisFailureReason | null;
}

interface IncidentState {
  kind: 'idle' | 'loading' | 'ready' | 'invalid-empty' | 'not-found' | 'error';
  index: number | null;
  value: IncidentReplayValue | null;
  error: RaceAnalysisFailureReason | null;
}

const EMPTY_LIST: ListState = { kind: 'idle', items: [], nextOffset: null, loadingMore: false, error: null };
const EMPTY_DETAIL: DetailState = { kind: 'idle', id: null, value: null, error: null };
const EMPTY_INCIDENT: IncidentState = { kind: 'idle', index: null, value: null, error: null };

export function Analysis({
  t,
  market,
  configured = false,
  loading = false,
  account = null,
  viewOnly = false,
  canReadOwnerAnalysis,
  canAdminReports = false,
  canDeleteAdminReports = false,
}: Props) {
  const ownerAllowed = canReadOwnerAnalysis ?? canReadRaceAnalysis(account);
  const [accessFailure, setAccessFailure] = useState<'unauthorized' | 'forbidden' | null>(null);
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [detail, setDetail] = useState<DetailState>(EMPTY_DETAIL);
  const [incident, setIncident] = useState<IncidentState>(EMPTY_INCIDENT);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const incidentGeneration = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const incidentController = useRef<AbortController | null>(null);

  const invalidatePrivate = useCallback((reason: 'unauthorized' | 'forbidden' | null = null) => {
    listController.current?.abort();
    detailController.current?.abort();
    incidentController.current?.abort();
    listGeneration.current += 1;
    detailGeneration.current += 1;
    incidentGeneration.current += 1;
    setList(EMPTY_LIST);
    setDetail(EMPTY_DETAIL);
    setIncident(EMPTY_INCIDENT);
    setAccessFailure(reason);
  }, []);

  const fetchList = useCallback((append = false, offset = 0) => {
    if (!append) listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const generation = ++listGeneration.current;
    setList((current) => append
      ? { ...current, kind: 'ready', loadingMore: true, error: null }
      : { kind: 'loading', items: [], nextOffset: null, loadingMore: false, error: null });
    void market.listRaceAnalyses({ limit: 50, offset, signal: controller.signal })
      .then((page) => {
        if (!isCurrentRaceAnalysisGeneration(generation, listGeneration.current)) return;
        setList((current) => {
          const result = append
            ? appendAnalysisPage({ items: current.items, nextOffset: current.nextOffset }, page)
            : page;
          return { kind: 'ready', ...result, loadingMore: false, error: null };
        });
      })
      .catch((error: unknown) => {
        if (!isCurrentRaceAnalysisGeneration(generation, listGeneration.current) || isAbort(error)) return;
        const reason = failureReason(error);
        if (reason === 'unauthorized' || reason === 'forbidden') {
          invalidatePrivate(reason);
          return;
        }
        setList((current) => ({ ...current, kind: 'error', loadingMore: false, error: reason }));
      });
  }, [invalidatePrivate, market]);

  const selectRace = useCallback((id: string) => {
    detailController.current?.abort();
    incidentController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    const generation = ++detailGeneration.current;
    incidentGeneration.current += 1;
    setDetail({ kind: 'loading', id, value: null, error: null });
    setIncident(EMPTY_INCIDENT);
    void market.getRaceAnalysis(id, controller.signal)
      .then((value) => {
        if (!isCurrentRaceAnalysisGeneration(generation, detailGeneration.current)) return;
        setDetail({ kind: 'ready', id, value, error: null });
      })
      .catch((error: unknown) => {
        if (!isCurrentRaceAnalysisGeneration(generation, detailGeneration.current) || isAbort(error)) return;
        const reason = failureReason(error);
        if (reason === 'unauthorized' || reason === 'forbidden') {
          invalidatePrivate(reason);
          return;
        }
        if (reason === 'not-found') {
          setDetail({ kind: 'not-found', id, value: null, error: reason });
          fetchList(false, 0);
          return;
        }
        setDetail({ kind: 'error', id, value: null, error: reason });
      });
  }, [fetchList, invalidatePrivate, market]);

  const selectIncident = useCallback((index: number) => {
    const raceId = detail.id;
    const summary = detail.value?.incidents.find((candidate) => candidate.index === index);
    if (!raceId) return;
    incidentController.current?.abort();
    const generation = ++incidentGeneration.current;
    if (!summary || summary.frameCount === 0) {
      setIncident({ kind: 'invalid-empty', index, value: null, error: null });
      return;
    }
    const controller = new AbortController();
    incidentController.current = controller;
    setIncident({ kind: 'loading', index, value: null, error: null });
    // The only frame request is this explicit incident selection.
    void market.getRaceAnalysisIncident(raceId, index, controller.signal)
      .then((value) => {
        if (!isCurrentRaceAnalysisGeneration(generation, incidentGeneration.current)) return;
        setIncident(value.frames.length === 0
          ? { kind: 'invalid-empty', index, value: null, error: null }
          : { kind: 'ready', index, value, error: null });
      })
      .catch((error: unknown) => {
        if (!isCurrentRaceAnalysisGeneration(generation, incidentGeneration.current) || isAbort(error)) return;
        const reason = failureReason(error);
        if (reason === 'unauthorized' || reason === 'forbidden') {
          invalidatePrivate(reason);
          return;
        }
        const transition = incidentFailureTransition(reason);
        setIncident({ kind: transition.kind, index, value: null, error: reason });
        if (transition.refreshList) fetchList(false, 0);
      });
  }, [detail.id, detail.value?.incidents, fetchList, invalidatePrivate, market]);

  const basicReady = configured && !loading && account !== null && account.permissions !== undefined && ownerAllowed;
  useEffect(() => {
    if (!basicReady) {
      invalidatePrivate(null);
      return undefined;
    }
    // A session/account transition must never leave the previous owner's
    // selected detail or lazy incident visible while the new list is loading.
    invalidatePrivate(null);
    fetchList(false, 0);
    return () => listController.current?.abort();
  }, [account?.id, basicReady, fetchList, invalidatePrivate]);

  useEffect(() => () => {
    listController.current?.abort();
    detailController.current?.abort();
    incidentController.current?.abort();
  }, []);

  const themeVars = {
    '--analysis-panel': t.panel, '--analysis-panel2': t.panel2, '--analysis-inset': t.inset,
    '--analysis-line': t.line, '--analysis-line2': t.line2, '--analysis-text': t.t1,
    '--analysis-sub': t.t2, '--analysis-muted': t.t3, '--analysis-accent': t.acc,
    '--analysis-accent-ink': t.accInk, '--analysis-accent-soft': t.accSoft, '--analysis-negative': t.negRed,
  } as CSSProperties;

  const globalGate = accessFailure
    ? accessFailure === 'unauthorized' ? ['로그인이 필요합니다', '세션을 확인한 뒤 다시 시도하세요.'] : ['레이스 분석 접근이 차단되었습니다', '이 계정에서는 개인 레이스 분석을 열 수 없습니다.']
    : !configured ? ['플랫폼 연결이 필요합니다', '플랫폼 주소가 구성되면 내 레이스 분석을 불러옵니다.']
      : loading ? ['세션 확인 중', '권한을 확인하고 있습니다.']
        : !account ? ['로그인이 필요합니다', '내 레이스 분석은 로그인한 계정에만 표시됩니다.']
          : !account.permissions ? ['권한 정보를 확인할 수 없습니다', '이 서버는 개인 레이스 분석 권한을 아직 제공하지 않습니다.']
            : null;
  const ownerGate = !ownerAllowed ? ['레이스 분석 권한이 없습니다', 'pithub.race.read 권한이 필요한 개인 화면입니다.'] : null;

  return (
    <section className={styles.root} style={themeVars} aria-labelledby="analysis-title">
      {globalGate ? <AnalysisGate title={globalGate[0]} note={globalGate[1]} loading={loading} /> : (
        <>
          <header className={styles.header}>
            <div><div className={styles.eyebrow}>{ownerAllowed ? 'OWNER-ONLY · NO CACHE' : 'ADMINISTRATOR REPORTS'}</div><h1 id="analysis-title">{ownerAllowed ? 'My race analysis' : 'Analysis'}</h1><p>{ownerAllowed ? '구조화된 랩, 피트, 이벤트와 선택한 사고의 measured-time replay입니다.' : '관리자 HTML 리포트는 별도 권한으로만 열립니다.'}</p></div>
            <span className={styles.badge}>{ownerAllowed ? 'race.read' : 'reports'}</span>
          </header>
          {ownerGate ? <AnalysisGate title={ownerGate[0]} note={ownerGate[1]} loading={false} /> : (
            <div className={styles.layout}>
              <RaceList state={list} selectedId={detail.id} onSelect={selectRace} onRetry={() => fetchList(false, 0)} onLoadMore={() => list.nextOffset !== null && fetchList(true, list.nextOffset)} />
              <div className={styles.detail}>
                {detail.kind === 'idle' && <p className={styles.empty}>왼쪽에서 레이스를 선택하세요.</p>}
                {detail.kind === 'loading' && <p className={styles.status} role="status">분석을 불러오는 중…</p>}
                {detail.kind === 'not-found' && <ScopedFailure title="분석을 찾을 수 없습니다" note="목록을 새로 고쳤습니다. 다른 레이스를 선택하세요." onRetry={() => fetchList(false, 0)} />}
                {detail.kind === 'error' && <ScopedFailure title="분석을 불러오지 못했습니다" note={failureMessage(detail.error)} onRetry={() => detail.id && selectRace(detail.id)} />}
                {detail.kind === 'ready' && detail.value && <>
                  <RaceAnalysisDetail t={t} detail={detail.value} selectedIncidentIndex={incident.index} onSelectIncident={selectIncident} />
                  <IncidentPanel state={incident} detail={detail.value} t={t} onRetry={() => incident.index !== null && selectIncident(incident.index)} />
                </>}
              </div>
            </div>
          )}
          {!viewOnly && canAdminReports && <AdminAnalysisReports t={t} market={market} canDelete={canDeleteAdminReports} />}
        </>
      )}
    </section>
  );
}

export function RaceList({ state, selectedId, onSelect, onRetry, onLoadMore }: {
  state: ListState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  return <aside className={`${styles.list} ${styles.card}`} aria-labelledby="analysis-race-list-title">
    <h2 id="analysis-race-list-title">My races</h2>
    {state.kind === 'idle' ? <p className={styles.status} role="status">목록을 준비 중입니다.</p>
      : state.kind === 'loading' ? <p className={styles.status} role="status">레이스 목록을 불러오는 중…</p>
        : state.kind === 'error' && state.items.length === 0 ? (
          <div><p className={`${styles.status} ${styles.error}`} role="alert">{failureMessage(state.error)}</p><button type="button" className={styles.retryButton} onClick={onRetry}>다시 시도</button></div>
        ) : state.kind === 'ready' && state.items.length === 0 ? <p className={styles.empty}>분석 가능한 내 레이스가 없습니다.</p> : <>
      {state.kind === 'error' && <p className={`${styles.status} ${styles.error}`} role="alert">목록 새로고침 실패: {failureMessage(state.error)} <button type="button" className={styles.retryButton} onClick={onRetry}>다시 시도</button></p>}
      <ul className={styles.raceList}>{state.items.map((item) => <li key={item.id}><button type="button" className={`${styles.raceButton} ${selectedId === item.id ? styles.raceButtonSelected : ''}`} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
        <span className={styles.raceTitle}><span>{item.track.name}</span><span>{item.finishPosition === null ? 'P—' : `P${item.finishPosition}`}</span></span>
        <span className={styles.raceSub}>{item.sessionType} · {item.gameFormat} · {item.completedLaps === null ? 'laps —' : `${item.completedLaps} laps`}{item.bestLapMs === null ? '' : ` · ${msToTime(item.bestLapMs)}`}</span>
      </button></li>)}</ul>
      {state.nextOffset !== null && <button type="button" className={styles.loadMore} onClick={onLoadMore} disabled={state.loadingMore}>{state.loadingMore ? '불러오는 중…' : '더 보기'}</button>}
    </>}
  </aside>;
}

function IncidentPanel({ state, detail, t, onRetry }: { state: IncidentState; detail: RaceAnalysisDetailValue; t: HubTheme; onRetry: () => void }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') return <p className={styles.status} role="status">사고 프레임을 불러오는 중…</p>;
  if (state.kind === 'invalid-empty') return <ScopedFailure title="재생할 프레임이 없습니다" note="이 사고에는 사용 가능한 저장 프레임이 없습니다." />;
  if (state.kind === 'not-found') return <ScopedFailure title="사고를 찾을 수 없습니다" note="사고 목록을 다시 확인하세요." onRetry={onRetry} />;
  if (state.kind === 'error') return <ScopedFailure title="사고 프레임을 불러오지 못했습니다" note={failureMessage(state.error)} onRetry={onRetry} />;
  return state.value ? <IncidentReplay t={t} replay={state.value} trackOutline={detail.trackOutline} /> : null;
}

function AnalysisGate({ title, note, loading }: { title: string; note: string; loading: boolean }) {
  return <div className={styles.gate} role={loading ? 'status' : undefined}><h1>{title}</h1><p>{note}</p></div>;
}

function ScopedFailure({ title, note, onRetry }: { title: string; note: string; onRetry?: () => void }) {
  return <div className={styles.gate} role="alert"><h1>{title}</h1><p>{note}</p>{onRetry && <button type="button" className={styles.retryButton} onClick={onRetry}>다시 시도</button>}</div>;
}

function failureReason(error: unknown): RaceAnalysisFailureReason {
  return error instanceof RaceAnalysisError ? error.reason : 'network';
}

function failureMessage(reason: RaceAnalysisFailureReason | null): string {
  switch (reason) {
    case 'bad-input': return '요청 값이 올바르지 않습니다.';
    case 'not-found': return '요청한 레이스를 찾을 수 없습니다.';
    case 'unauthorized': return '로그인이 필요합니다.';
    case 'forbidden': return '권한이 없습니다.';
    default: return '네트워크 오류입니다. 잠시 후 다시 시도하세요.';
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
