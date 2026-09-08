// Owner-only setup history. Grouping is intentionally server-owned: this screen
// only displays the typed response and never compares setup values itself.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';
import { SETUP_FIELDS } from '../data/setupFields';
import { ListingError, PlatformMarket, type PlatformMySetupDetail, type PlatformMySetupParams, type PlatformMySetupSummary, type UpdateMySetupResult } from '../data/platform';
import { canEditMySetups, canReadMySetups } from '../data/permissions';
import { reduceMySetupsSelection, replaceMySetupDraftText, resolveMySetupsRefreshOutcome, type MySetupDraft } from './mySetupsState';

type LoadState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; value: T }
  | { kind: 'error'; message: string };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'refresh-error' };

interface Props {
  t: HubTheme;
  configured: boolean;
  loading: boolean;
  account: PlatformAccount | null;
  market: PlatformMarket;
  onLogin: () => void;
  viewOnly?: boolean;
}

export function MySetups({ t, configured, loading, account, market, onLogin, viewOnly = false }: Props) {
  if (!configured) return <Gate t={t} title="플랫폼 연결이 필요합니다" note="My Setups는 연결된 플랫폼에서 사용할 수 있습니다." />;
  if (loading) return <Gate t={t} title="세션을 확인하는 중…" note="" status />;
  if (!account) return <Gate t={t} title="로그인이 필요합니다" note="내 셋업과 레이스 기록은 Profile에서 로그인한 뒤 확인할 수 있습니다." action="Profile에서 로그인" onAction={onLogin} />;
  if (!account.permissions) return <Gate t={t} title="서버 업데이트 필요" note="My Setups 권한 정보를 받지 못했습니다. 플랫폼 서버를 업데이트한 뒤 다시 시도하세요." />;
  if (!canReadMySetups(account)) return <Gate t={t} title="My Setups 열람 권한이 없습니다" note="pithub.race.read 권한이 필요합니다." alert />;
  return <MySetupsData key={`${account.id}:${account.permissions.join('\u0001')}`} t={t} market={market} canEdit={!viewOnly && canEditMySetups(account)} />;
}

function MySetupsData({ t, market, canEdit }: {
  t: HubTheme;
  market: PlatformMarket;
  canEdit: boolean;
}) {
  const [list, setList] = useState<LoadState<PlatformMySetupSummary[]>>({ kind: 'loading' });
  const [detail, setDetail] = useState<LoadState<PlatformMySetupDetail> | null>(null);
  const [selection, dispatchSelection] = useReducer(reduceMySetupsSelection, { selectedId: null, generation: 0, draft: null });
  const [editing, setEditing] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [readForbidden, setReadForbidden] = useState(false);
  const listGeneration = useRef(0);
  const screenGeneration = useRef(0);
  const { selectedId, draft } = selection;

  const expireIfUnauthorized = useCallback((error: unknown) => {
    // pfetch emits the captured-token 401 event. HubApp is the single owner of
    // child recovery, so screens only stop their local error path here.
    return reasonOf(error) === 'unauthorized';
  }, []);

  // A denied owner GET must never leave previously loaded private metadata on
  // screen. This is intentionally separate from a denied POST, which keeps the
  // editor draft so the user can retry after their update grant is restored.
  const denyRead = useCallback(() => {
    listGeneration.current += 1;
    screenGeneration.current += 1;
    dispatchSelection({ type: 'clear' });
    setList({ kind: 'loading' });
    setDetail(null);
    setEditing(false);
    setSave({ kind: 'idle' });
    setReadForbidden(true);
  }, []);

  const loadList = useCallback(async (): Promise<void> => {
    const generation = ++listGeneration.current;
    setList({ kind: 'loading' });
    try {
      const value = await market.listMySetups();
      if (generation !== listGeneration.current) return;
      setList({ kind: 'ready', value });
    } catch (error: unknown) {
      if (generation !== listGeneration.current) return;
      if (expireIfUnauthorized(error)) return;
      if (reasonOf(error) === 'forbidden') { denyRead(); return; }
      setList({ kind: 'error', message: messageOf(error, '셋업 목록을 불러오지 못했습니다') });
    }
  }, [denyRead, expireIfUnauthorized, market]);

  const loadDetail = useCallback(async (id: string, generation: number): Promise<void> => {
    setDetail({ kind: 'loading' });
    try {
      const value = await market.getMySetup(id);
      if (generation !== screenGeneration.current) return;
      setDetail({ kind: 'ready', value });
      dispatchSelection({ type: 'metadata', id, generation, draft: toDraft(value) });
    } catch (error: unknown) {
      if (generation !== screenGeneration.current) return;
      if (expireIfUnauthorized(error)) return;
      if (reasonOf(error) === 'forbidden') { denyRead(); return; }
      if (reasonOf(error) === 'not-found') {
        screenGeneration.current += 1;
        dispatchSelection({ type: 'clear' });
        setDetail(null);
        setEditing(false);
        void loadList();
        return;
      }
      setDetail({ kind: 'error', message: messageOf(error, '셋업 상세를 불러오지 못했습니다') });
    }
  }, [denyRead, expireIfUnauthorized, loadList, market]);

  useEffect(() => {
    void loadList();
    return () => { listGeneration.current += 1; screenGeneration.current += 1; };
  }, [loadList]);

  const select = (id: string) => {
    const generation = ++screenGeneration.current;
    dispatchSelection({ type: 'select', id });
    setEditing(false);
    setSave({ kind: 'idle' });
    void loadDetail(id, generation);
  };

  const clearSelection = useCallback(() => {
    screenGeneration.current += 1;
    dispatchSelection({ type: 'clear' });
    setDetail(null);
    setEditing(false);
    setSave({ kind: 'idle' });
  }, []);

  // Manual retries need a new generation too: otherwise an older retry may
  // finish after a newer one and overwrite its detail or refresh result.
  const advanceRetryGeneration = () => {
    const generation = ++screenGeneration.current;
    dispatchSelection({ type: 'retry' });
    return generation;
  };

  const retryDetail = () => {
    if (!selectedId) return;
    void loadDetail(selectedId, advanceRetryGeneration());
  };

  const retryRefreshAfterSave = () => {
    if (!selectedId) return;
    void refreshAfterSave(selectedId, advanceRetryGeneration());
  };

  const refreshAfterSave = useCallback(async (id: string, generation: number): Promise<void> => {
    const results = await Promise.allSettled([market.listMySetups(), market.getMySetup(id)]);
    if (generation !== screenGeneration.current) return;
    const outcome = resolveMySetupsRefreshOutcome(results.map((result) => result.status === 'rejected' ? reasonOf(result.reason) : null));
    switch (outcome) {
      case 'unauthorized':
        expireIfUnauthorized(new ListingError('unauthorized', '로그인이 필요합니다'));
        return;
      case 'forbidden':
        denyRead();
        return;
      case 'not-found':
        clearSelection();
        void loadList();
        return;
      case 'network':
        setSave({ kind: 'refresh-error' });
        return;
      case 'ready': {
        const [summaries, freshDetail] = results;
        // The outcome proves both promises fulfilled; retain this guard so the
        // TypeScript narrowing matches the state-machine invariant as well.
        if (summaries.status !== 'fulfilled' || freshDetail.status !== 'fulfilled') {
          setSave({ kind: 'refresh-error' });
          return;
        }
        setList({ kind: 'ready', value: summaries.value });
        setDetail({ kind: 'ready', value: freshDetail.value });
        dispatchSelection({ type: 'metadata', id, generation, draft: toDraft(freshDetail.value) });
        setEditing(false);
        setSave({ kind: 'saved' });
      }
    }
  }, [clearSelection, denyRead, expireIfUnauthorized, loadList, market]);

  const saveMetadata = async () => {
    if (!selectedId || !draft || save.kind === 'saving') return;
    const id = selectedId;
    const generation = screenGeneration.current;
    setSave({ kind: 'saving' });
    try {
      const result = await market.updateMySetup(id, draft);
      if (generation !== screenGeneration.current || id !== selectedId) return;
      // The write response is immediately reflected before either refetch can
      // finish, so a successful save never appears to have been lost.
      setDetail((current) => current?.kind === 'ready' ? { kind: 'ready', value: applyMetadata(current.value, result) } : current);
      setList((current) => current.kind === 'ready' ? { kind: 'ready', value: current.value.map((item) => item.id === id ? applyMetadata(item, result) : item) } : current);
      dispatchSelection({ type: 'draft', draft: { name: result.name, rating: result.rating, memo: result.memo } });
      await refreshAfterSave(id, generation);
    } catch (error: unknown) {
      if (generation !== screenGeneration.current || id !== selectedId) return;
      if (expireIfUnauthorized(error)) return;
      if (reasonOf(error) === 'not-found') {
        clearSelection();
        void loadList();
        return;
      }
      setSave({ kind: 'error', message: messageOf(error, '셋업을 저장하지 못했습니다') });
    }
  };

  if (readForbidden) return <Gate t={t} title="My Setups 열람 권한이 없습니다" note="권한이 변경되었거나 pithub.race.read 권한이 필요합니다." alert />;

  return (
    <section style={{ maxWidth: 1120 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>My Setups</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>같은 23개 설정값으로 사용한 내 레이스 기록입니다.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <SetupList t={t} state={list} selectedId={selectedId} onSelect={select} onRetry={() => void loadList()} />
        <SetupDetail
          t={t} state={detail} selectedId={selectedId} draft={draft} editing={editing} save={save} canEdit={canEdit}
          onEdit={() => { if (detail?.kind === 'ready') { dispatchSelection({ type: 'draft', draft: toDraft(detail.value) }); setEditing(true); setSave({ kind: 'idle' }); } }}
          onCancel={() => { if (detail?.kind === 'ready') dispatchSelection({ type: 'draft', draft: toDraft(detail.value) }); setEditing(false); setSave({ kind: 'idle' }); }}
          onDraft={(nextDraft) => dispatchSelection({ type: 'draft', draft: nextDraft })} onSave={() => void saveMetadata()} onRetry={retryDetail}
          onRefreshRetry={retryRefreshAfterSave}
        />
      </div>
    </section>
  );
}

export function SetupList({ t, state, selectedId, onSelect, onRetry }: {
  t: HubTheme; state: LoadState<PlatformMySetupSummary[]>; selectedId: string | null; onSelect: (id: string) => void; onRetry: () => void;
}) {
  return <div style={panel(t)}>
    <div style={{ fontSize: 13, fontWeight: 700, color: t.t1 }}>내 셋업</div>
    <div style={{ ...muted(t), marginTop: 4 }}>최근 최대 100개 셋업</div>
    <div style={{ marginTop: 14 }}>
      {state.kind === 'loading' && <div role="status" aria-live="polite" style={muted(t)}>불러오는 중…</div>}
      {state.kind === 'error' && <Problem t={t} message={state.message} onRetry={onRetry} />}
      {state.kind === 'ready' && state.value.length === 0 && <div role="status" style={muted(t)}>아직 저장된 셋업 사용 기록이 없습니다.</div>}
      {state.kind === 'ready' && state.value.length > 0 && <div role="list" aria-label="내 셋업" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {state.value.map((item) => <div key={item.id} role="listitem"><button type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: `1px solid ${selectedId === item.id ? t.accBorder : t.line}`, background: selectedId === item.id ? t.accSoft : t.inset, borderRadius: 8, padding: 11, color: t.t1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{item.name || '이름 없는 셋업'}</div>
          <div style={{ ...muted(t), marginTop: 4 }}>{item.lastTrackName} · {item.lastGameFormat} · {item.usageCount}회 사용</div>
          {item.firstRecordedAt && <div style={{ ...muted(t), marginTop: 4 }}>첫 기록 시각: {formatDate(item.firstRecordedAt)}</div>}
          {item.lastRecordedAt && <div style={{ ...muted(t), marginTop: 3 }}>마지막 기록 시각: {formatDate(item.lastRecordedAt)}</div>}
          {item.rating !== null && <div style={{ fontSize: 11, color: t.accInk, marginTop: 4 }}>내 평점 {item.rating}/5</div>}
        </button></div>)}
      </div>}
    </div>
  </div>;
}

export function SetupDetail({ t, state, selectedId, draft, editing, save, canEdit, onEdit, onCancel, onDraft, onSave, onRetry, onRefreshRetry }: {
  t: HubTheme; state: LoadState<PlatformMySetupDetail> | null; selectedId: string | null; draft: MySetupDraft | null; editing: boolean; save: SaveState; canEdit: boolean;
  onEdit: () => void; onCancel: () => void; onDraft: (draft: MySetupDraft) => void; onSave: () => void; onRetry: () => void; onRefreshRetry: () => void;
}) {
  if (!selectedId) return <div style={panel(t)}><div role="status" aria-live="polite" style={muted(t)}>왼쪽에서 셋업을 선택하세요.</div></div>;
  if (!state || state.kind === 'loading') return <div style={panel(t)}><div role="status" aria-live="polite" style={muted(t)}>셋업 상세를 불러오는 중…</div></div>;
  if (state.kind === 'error') return <div style={panel(t)}><Problem t={t} message={state.message} onRetry={onRetry} /></div>;
  const setup = state.value;
  const disabled = save.kind === 'saving';
  return <div style={panel(t)}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
      <div><div style={{ fontSize: 17, fontWeight: 800 }}>{setup.name || '이름 없는 셋업'}</div><div style={{ ...muted(t), marginTop: 4 }}>{setup.lastTrackName} · {setup.lastGameFormat} · 총 {setup.usageCount}회 사용</div></div>
      {canEdit && !editing && <button type="button" onClick={onEdit} style={button(t)}>평가 편집</button>}
    </div>
    {!canEdit && <div style={{ ...notice(t), marginTop: 14 }}>이 계정은 셋업을 열람만 할 수 있습니다.</div>}
    {(setup.firstRecordedAt || setup.lastRecordedAt) && <div style={{ ...muted(t), marginTop: 12 }}>
      {setup.firstRecordedAt && <div>첫 기록 시각: {formatDate(setup.firstRecordedAt)}</div>}
      {setup.lastRecordedAt && <div>마지막 기록 시각: {formatDate(setup.lastRecordedAt)}</div>}
    </div>}
    {editing && draft && <MetadataEditor t={t} draft={draft} disabled={disabled} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />}
    {save.kind === 'saving' && <div role="status" aria-live="polite" style={{ ...muted(t), marginTop: 12 }}>저장하는 중…</div>}
    {save.kind === 'saved' && <div role="status" aria-live="polite" style={{ color: t.ok, fontSize: 12, marginTop: 12 }}>저장했습니다.</div>}
    {save.kind === 'error' && <div role="alert" style={{ color: t.negRed, fontSize: 12, marginTop: 12 }}><div>{save.message}</div><div style={{ marginTop: 6 }}>입력한 내용은 유지되었습니다. <button type="button" onClick={onSave} style={linkButton(t)}>다시 저장</button></div></div>}
    {save.kind === 'refresh-error' && <div role="alert" style={{ color: t.warn, fontSize: 12, marginTop: 12 }}>저장은 완료됐지만 새로고침하지 못했습니다. <button type="button" onClick={onRefreshRetry} style={linkButton(t)}>다시 시도</button></div>}
    {!editing && <MetadataRead t={t} setup={setup} />}
    <SetupParams t={t} params={setup.params} />
    <RaceHistory t={t} setup={setup} />
  </div>;
}

function MetadataRead({ t, setup }: { t: HubTheme; setup: PlatformMySetupDetail }) {
  return <div style={{ marginTop: 16, fontSize: 12.5, color: t.t2 }}>
    {setup.rating !== null && <div>내 평점: {setup.rating}/5</div>}
    {setup.memo && <div style={{ whiteSpace: 'pre-wrap', marginTop: setup.rating !== null ? 6 : 0 }}>{setup.memo}</div>}
  </div>;
}

function MetadataEditor({ t, draft, disabled, onDraft, onSave, onCancel }: {
  t: HubTheme; draft: MySetupDraft; disabled: boolean; onDraft: (draft: MySetupDraft) => void; onSave: () => void; onCancel: () => void;
}) {
  return <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
    <label style={label(t)}>이름<input aria-label="셋업 이름" value={draft.name} disabled={disabled} onChange={(e) => onDraft(replaceMySetupDraftText(draft, 'name', e.target.value))} style={input(t)} /></label>
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}><legend style={label(t)}>내 평점</legend><div style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 6 }}>
      {[1, 2, 3, 4, 5].map((rating) => <label key={rating} style={{ fontSize: 12, color: t.t2 }}><input type="radio" name="setup-rating" value={rating} checked={draft.rating === rating} onChange={() => onDraft({ ...draft, rating })} /> {rating}</label>)}
      <button type="button" onClick={() => onDraft({ ...draft, rating: null })} style={linkButton(t)}>평점 지우기</button>
    </div></fieldset>
    <label style={label(t)}>메모<textarea aria-label="셋업 메모" value={draft.memo} disabled={disabled} onChange={(e) => onDraft(replaceMySetupDraftText(draft, 'memo', e.target.value))} rows={4} style={{ ...input(t), resize: 'vertical' }} /></label>
    <div style={{ display: 'flex', gap: 8 }}><button type="button" disabled={disabled} onClick={onSave} style={button(t)}>저장</button><button type="button" disabled={disabled} onClick={onCancel} style={button(t)}>취소</button></div>
  </div>;
}

function SetupParams({ t, params }: { t: HubTheme; params: PlatformMySetupParams }) {
  return <div style={{ marginTop: 22 }}><div style={{ fontSize: 13, fontWeight: 700 }}>셋업 값</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 7, marginTop: 9 }}>
    {SETUP_FIELDS.map((field) => <div key={field.key} style={{ border: `1px solid ${t.line}`, borderRadius: 7, padding: '7px 8px', background: t.inset }}><div style={muted(t)}>{field.label}</div><div style={{ color: t.t1, fontSize: 12, marginTop: 3 }}>{params[field.key]}{field.unit ? ` ${field.unit}` : ''}</div></div>)}
  </div></div>;
}

function RaceHistory({ t, setup }: { t: HubTheme; setup: PlatformMySetupDetail }) {
  return <div style={{ marginTop: 22 }}><div style={{ fontSize: 13, fontWeight: 700 }}>사용 레이스</div>{setup.usageCount > setup.races.length && <div style={{ ...notice(t), marginTop: 8 }}>최근 100건만 표시합니다.</div>}
    {setup.races.length === 0 ? <div style={{ ...muted(t), marginTop: 9 }}>표시할 레이스가 없습니다.</div> : <div role="list" aria-label="셋업 사용 레이스" style={{ display: 'grid', gap: 7, marginTop: 9 }}>{setup.races.map((race) => <div key={race.id} role="listitem" style={{ borderTop: `1px solid ${t.line}`, paddingTop: 9, fontSize: 12.5, color: t.t2 }}>
      <div style={{ color: t.t1, fontWeight: 600 }}>{race.trackName} · {race.gameFormat} · {race.sessionType}</div>
      {race.recordedAt && <div style={{ marginTop: 3 }}>기록 시각: {formatDate(race.recordedAt)}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 3 }}>
        {race.finishPosition !== null && <span>종료 시 순위: {race.finishPosition}</span>}
        {race.completedLaps !== null && <span>완료 랩: {race.completedLaps}</span>}
        {race.bestLapMs !== null && <span>베스트 랩: {formatLap(race.bestLapMs)}</span>}
      </div>
    </div>)}</div>}
  </div>;
}

function Gate({ t, title, note, action, onAction, status, alert }: { t: HubTheme; title: string; note: string; action?: string; onAction?: () => void; status?: boolean; alert?: boolean }) {
  return <section style={{ ...panel(t), maxWidth: 620 }}><div {...(alert ? { role: 'alert' } : status ? { role: 'status', 'aria-live': 'polite' } : {})} style={{ color: alert ? t.negRed : t.t1, fontWeight: 700 }}>{title}</div>{note && <div style={{ color: t.t2, fontSize: 12.5, marginTop: 7 }}>{note}</div>}{action && <button type="button" onClick={onAction} style={{ ...button(t), marginTop: 14 }}>{action}</button>}</section>;
}

function Problem({ t, message, onRetry }: { t: HubTheme; message: string; onRetry: () => void }) {
  return <div role="alert" style={{ color: t.negRed, fontSize: 12.5 }}><div>{message}</div><button type="button" onClick={onRetry} style={{ ...button(t), marginTop: 10 }}>다시 시도</button></div>;
}

function applyMetadata<T extends PlatformMySetupSummary>(setup: T, result: UpdateMySetupResult): T {
  return { ...setup, name: result.name, rating: result.rating, memo: result.memo };
}

function toDraft(setup: Pick<PlatformMySetupSummary, 'name' | 'rating' | 'memo'>): MySetupDraft { return { name: setup.name, rating: setup.rating, memo: setup.memo }; }
function reasonOf(error: unknown): string | null { return error instanceof ListingError ? error.reason : null; }
function messageOf(error: unknown, fallback: string): string { return error instanceof ListingError ? error.message : fallback; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function formatLap(ms: number): string { const minutes = Math.floor(ms / 60000); const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0'); return `${minutes}:${seconds}`; }
function panel(t: HubTheme): React.CSSProperties { return { background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 18, minWidth: 0 }; }
function muted(t: HubTheme): React.CSSProperties { return { fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: t.t3 }; }
function notice(t: HubTheme): React.CSSProperties { return { background: t.warnSoft, border: `1px solid ${t.warnBorder}`, borderRadius: 7, padding: '7px 9px', color: t.warn, fontSize: 12 }; }
function button(t: HubTheme): React.CSSProperties { return { border: `1px solid ${t.line2}`, borderRadius: 6, background: t.inset, color: t.t1, padding: '7px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }; }
function linkButton(t: HubTheme): React.CSSProperties { return { border: 0, padding: 0, color: t.accInk, background: 'transparent', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }; }
function label(t: HubTheme): React.CSSProperties { return { display: 'grid', gap: 5, color: t.t2, fontSize: 12, fontWeight: 700 }; }
function input(t: HubTheme): React.CSSProperties { return { width: '100%', boxSizing: 'border-box', border: `1px solid ${t.line2}`, borderRadius: 6, background: t.inset, color: t.t1, padding: '8px 9px', font: 'inherit' }; }
