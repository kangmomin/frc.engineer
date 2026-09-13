import { useEffect, useRef, useState } from 'react';
import { getTeamName } from '../../constants/teamColors';
import { HUB_FORMATS, HUB_TRACKS, isF126OnlyTrack, trackContextFor, trackName } from '../data/tracks';
import type { TrackContext } from '../data/tracks';
import { STRATEGY_TYRES, StrategyError, strategyClient, strategyErrorMessage } from '../data/strategy';
import type { StrategyContext, StrategyContexts, StrategyFilter, StrategyRequest, StrategyResult, StrategyTyre } from '../data/strategy';
import styles from './Strategy.module.css';

const weather = ['맑음', '옅은 구름', '흐림', '약한 비', '강한 비', '폭우'];
const tyreLabels: Record<StrategyTyre, string> = { Soft: '소프트', Medium: '미디엄', Hard: '하드', Inter: '인터', Wet: '웨트' };
const tyreColors: Record<StrategyTyre, string> = { Soft: '#ba3042', Medium: '#8c6800', Hard: '#596775', Inter: '#28783d', Wet: '#276db0' };
const seconds = (ms: number) => (ms / 1000).toFixed(2);
const mj = (j: number) => (j / 1_000_000).toFixed(2);
// EA's game-mode/ruleset appendix and the packed session settings:
// https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347
const gameModes: Record<number, string> = { 4: '그랑프리', 5: '타임 트라이얼', 6: '분할 화면', 7: '온라인 커스텀', 15: '온라인 주간 이벤트', 17: '브레이킹 포인트', 27: '마이팀 커리어', 28: '드라이버 커리어', 29: '온라인 커리어', 30: '챌린지 커리어', 75: 'APXGP 스토리', 127: '벤치마크' };
const ruleSets: Record<number, string> = { 0: '연습·예선', 1: '레이스', 2: '타임 트라이얼', 12: '엘리미네이션' };
const sessionLengths: Record<number, string> = { 0: '없음', 2: '매우 짧음', 3: '짧음', 4: '중간', 5: '중간~김', 6: '김', 7: '전체' };
const pitExperiences = ['자동', '중계', '몰입형'];
const modeLabel = (id: number) => gameModes[id] ?? `모드 ${id}`;
const rulesLabel = (id: number) => ruleSets[id] ?? `규칙 ${id}`;
const reasons: Record<string, string> = {
  'fuel-age-not-identifiable': '연료 감소와 타이어 사용에 따른 변화를 분리할 수 없어 순위를 보류합니다.',
  'unstable-pace-model': '랩 페이스의 편차가 크거나 계산이 불안정해 순위를 보류합니다.',
  'nonlinear-tyre-profile': '타이어 사용에 따른 변화가 현재 계산 범위를 벗어납니다.',
  'compound-label-conflict': '타이어 종류가 서로 맞지 않는 기록이 있어 순위를 보류합니다.',
  'pit-evidence-missing': '정상 피트 전후 랩의 관측 자료가 부족해 피트 전략을 비교할 수 없습니다.',
  'tyre-age-or-set-coverage': '선택한 새 타이어 수량과 관측된 사용 랩 범위로 완주 가능한 조합이 없습니다.',
  'small-model-difference': '상위 조합 간 차이가 관측 랩의 오차보다 작습니다. 비슷한 대안으로 보세요.',
};
const statusLabels: Record<string, string> = { 'insufficient-data': '기록이 더 필요합니다', unidentifiable: '현재 자료로 순위를 정하기 어렵습니다', 'no-feasible-plan': '비교 가능한 조합이 없습니다' };
const exclusionLabels: Record<string, string> = {
  'partial-lap': '일부만 수집된 랩', invalid: '무효 랩', pit: '피트 진입·이탈', 'safety-car': '세이프티카·VSC',
  incident: '사고', damage: '차량·타이어 손상', traffic: '트래픽·DRS·오버테이크 사용', 'setup-change': '셋업 변경',
  'weather-change': '날씨 변경', gap: '데이터 수신 단절', flashback: '되감기', 'source-missing': '필수 측정값 누락',
  penalty: '페널티', paused: '일시 정지', 'conditions-change': '경기 조건 변경', 'race-start': '출발 랩',
  'missing-conditions': '경기 설정 미확인', 'unsupported-formula': '지원하지 않는 차량 규정', 'missing-setup': '셋업 미확인',
  'missing-fuel': '연료 측정 누락', 'unknown-tyre': '타이어 종류 미확인', 'compound-change': '랩 도중 타이어 변경',
  'no-completed-laps': '완료 랩 없음',
};

export function StrategyObservations({ corpus }: { corpus: StrategyContexts }) {
  const [expanded, setExpanded] = useState(false);
  const observations = corpus.observations;
  if (!observations?.length) return null;
  const rows = expanded ? observations : observations.slice(0, 10);
  return <section className={styles.card} aria-labelledby="strategy-observations-title">
    <div className={styles.eyebrow}>실제 업로드 기록</div><h3 id="strategy-observations-title">관측된 타이어·연료</h3>
    <p>과거 업로드를 포함한 타이어별 주행 기록입니다. 연료는 실제 측정값이 있는 랩만 집계합니다.</p>
    <div className={styles.tableWrap}><table><thead><tr><th>서킷</th><th>타이어</th><th>랩타임 중앙값</th><th>유효 랩 / 업로드</th><th>관측 랩 범위</th><th>연료 사용 중앙값</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.trackId}:${row.tyre}`}>
      <td>{trackName(row.trackId)}</td><td>{tyreLabels[row.tyre as StrategyTyre] ?? '미확인'}</td>
      <td>{seconds(row.medianLapMs)}초</td><td>{row.laps.toLocaleString()}랩 / {row.uploads.toLocaleString()}건</td>
      <td>{seconds(row.minLapMs)}–{seconds(row.maxLapMs)}초</td><td>{row.medianFuelKg == null ? '측정 없음' : <>{row.medianFuelKg.toFixed(2)} kg/랩 · {row.fuelLaps.toLocaleString()}랩 측정</>}</td>
    </tr>)}</tbody></table></div>
    {observations.length > 10 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? '처음 10개만 보기' : `전체 ${observations.length}개 보기`}</button>}
    <p className={styles.note}>선택한 트랙·게임의 최근 최대 {corpus.archiveCoverage?.limit ?? corpus.recordLimit}개 레이스 업로드 기준이며, 같은 경기의 여러 업로드가 포함될 수 있습니다. 랩타임은 연료·날씨·트래픽·피트 영향을 보정하지 않은 값으로 타이어 성능 순위가 아닙니다. 연료는 제외 사유 없이 측정된 랩만 집계합니다.</p>
  </section>;
}

export function StrategyCollectionStatus({ corpus }: { corpus: StrategyContexts }) {
  const { archiveCoverage: coverage, diagnostics: d } = corpus;
  if (!coverage && !d) return null;
  return <section className={`${styles.card} ${styles.collection}`} aria-labelledby="strategy-collection-title">
    <h3 id="strategy-collection-title">수집 현황</h3>
    {coverage && <>
      <div className={styles.metrics} aria-label="레이스 업로드 현황">
        <div>최근 레이스 업로드<strong>{coverage.uploadedRaces.toLocaleString()}건</strong></div>
        <div>전략 계측 포함<strong>{coverage.withEvidence.toLocaleString()}건</strong></div>
        <div>전략 계측 없음<strong>{coverage.withoutEvidence.toLocaleString()}건</strong></div>
      </div>
      <p className={styles.note}>선택한 트랙·게임의 최근 최대 {coverage.limit}개 업로드 기준입니다.{coverage.truncated ? ' 현재 조회 한도에 도달했습니다.' : ''} 같은 경기의 여러 업로드가 각각 집계될 수 있습니다.
        {coverage.latestUploadAt && <> 마지막 업로드: <time dateTime={coverage.latestUploadAt}>{new Date(coverage.latestUploadAt).toLocaleString('ko-KR')}</time>.</>}
      </p>
    </>}
    {d && <>
      <div className={styles.metrics} aria-label="전략 랩 수집 현황">
        <div>수집된 완료 랩<strong>{d.collectedLaps.toLocaleString()}랩</strong></div>
        <div>비교 가능한 정상 랩<strong>{d.cleanLaps.toLocaleString()}랩</strong></div>
        <div>제외된 랩<strong>{d.excludedLaps.toLocaleString()}랩</strong></div>
      </div>
      <p className={styles.note}>중복과 조회 한도를 적용한 전략 기록 {corpus.records}건의 랩입니다. 경기 설정까지 확인된 정상 랩을 조건 목록에 표시합니다.{d.excludedRecords > 0 ? ` 이 중 ${d.excludedRecords}건은 비교에 사용할 랩이 없습니다.` : ''}</p>
      {d.exclusions.length > 0 && <details open={corpus.contexts.length === 0}>
        <summary>제외 사유 {d.exclusions.length}개 보기</summary>
        <div className={styles.tableWrap}><table><thead><tr><th>제외 사유</th><th>랩</th><th>전략 기록</th></tr></thead><tbody>{d.exclusions.map(reason => <tr key={reason.code}>
          <td>{exclusionLabels[reason.code] ?? '기타 제외 사유'}</td><td>{reason.laps.toLocaleString()}랩</td><td>{reason.records.toLocaleString()}건</td>
        </tr>)}</tbody></table></div>
        <p className={styles.note}>한 랩에 여러 사유가 겹칠 수 있어 사유별 합계는 제외된 랩 수와 다를 수 있습니다. 완료 랩이 남지 않은 기록은 사유에 0랩으로 표시될 수 있습니다.</p>
      </details>}
    </>}
  </section>;
}

export function StrategyEvidenceProgress({ context, corpus }: { context: StrategyContext; corpus: Pick<StrategyContexts, 'minUsers' | 'minSessions' | 'minCleanLaps' | 'referenceMinimums'> }) {
  const minimums = corpus.referenceMinimums ?? { users: corpus.minUsers, sessions: corpus.minSessions, cleanLaps: corpus.minCleanLaps ?? 40 };
  const metrics = [
    { label: '참여자', value: context.users, minimum: minimums.users, unit: '명' },
    { label: '독립 경기', value: context.sessions, minimum: minimums.sessions, unit: '경기' },
    { label: '정상 랩', value: context.cleanLaps, minimum: minimums.cleanLaps, unit: '랩' },
  ];
  const enough = metrics.every(m => m.value >= m.minimum);
  return <div className={styles.evidenceProgress} aria-labelledby="strategy-evidence-title">
    <h3 id="strategy-evidence-title">선택한 조건의 {corpus.referenceMinimums ? '참고용 ' : ''}분석 기준</h3>
    <div className={styles.metrics}>{metrics.map(m => <div key={m.label}>{m.label}
      <strong>{m.value.toLocaleString()} / {m.minimum.toLocaleString()}{m.unit}</strong>
      <progress aria-label={`${m.label} 최소 기준`} max={m.minimum} value={Math.min(m.value, m.minimum)} />
    </div>)}</div>
    <p className={styles.note}>{enough ? '최소 수량 기준을 충족했습니다.' : '선택한 조건의 기록이 더 필요합니다.'} 컴파운드별 표본과 타이어 사용 범위도 확인하므로 세 기준을 충족해도 비교 결과가 나오지 않을 수 있습니다.</p>
    {corpus.referenceMinimums && <p className={styles.note}>한 사람의 서로 다른 경기로도 참고용 계산을 시작할 수 있습니다. 기본 표본 기준은 {corpus.minUsers}명·{corpus.minSessions}경기·정상 랩 {corpus.minCleanLaps ?? 40}개이며, 그보다 적으면 결과에 ‘표본 제한’을 표시합니다. 표본 수는 예측 정확도를 보장하지 않습니다.</p>}
  </div>;
}

export function StrategyEmptyState({ corpus, format, onRefresh }: { corpus: StrategyContexts; format: string; onRefresh: () => void }) {
  const coverage = corpus.archiveCoverage;
  const minimums = corpus.referenceMinimums ?? { users: corpus.minUsers, sessions: corpus.minSessions, cleanLaps: corpus.minCleanLaps ?? 40 };
  const noUploads = corpus.records === 0 && coverage?.uploadedRaces === 0;
  const noMeasurements = corpus.records === 0 && coverage != null && coverage.withEvidence === 0 && coverage.withoutEvidence > 0;
  const title = noUploads ? '이 조건에 업로드된 레이스가 없습니다'
    : noMeasurements ? '레이스 업로드에 전략 계측이 없습니다'
      : corpus.records === 0 ? '이 조건의 기록을 모으고 있습니다' : '기록은 수집됐지만 비교할 정상 랩이 없습니다';
  return <div className={styles.empty}>
    <h3>{title}</h3>
    {!!corpus.observations?.length && <p>저장된 랩타임·타이어 정보는 위의 관측 표에서 확인할 수 있습니다.</p>}
    {noUploads ? <p>트랙·게임 선택을 확인하세요. Driver Pack에서 로그인과 인터넷 연결을 확인한 뒤 레이스를 마치거나 저장하고 기록을 업로드하세요.</p>
      : noMeasurements ? <><p>최근 레이스 업로드 {coverage.withoutEvidence}건에는 전략 분석에 필요한 연료·타이어 나이 등의 계측이 첨부되지 않았습니다.</p><p>최신 Driver Pack으로 새 레이스를 수집해 업로드하세요. 기존 업로드에 없던 측정값은 추정해서 채우지 않습니다.</p></>
        : corpus.records === 0 ? <p>전략 수집을 지원하는 Driver Pack으로 레이스 기록을 업로드하면 자료가 쌓입니다. 기존 업로드에 없던 연료·타이어 나이·차량 설정은 추정해서 채우지 않습니다.</p>
          : <><p>수집된 {corpus.records}건에서 경기 조건과 정상 랩이 함께 확인되는 자료를 찾지 못했습니다. 계측 누락이나 손상·트래픽·되감기 등으로 제외된 기록은 비교에 사용하지 않습니다.</p><p>제외 사유를 확인하고 같은 경기 조건에서 손상·트래픽·SC 없이 주행한 랩을 더 수집하세요. 필수 측정값이 누락됐다면 최신 Driver Pack과 게임의 UDP 설정을 확인하세요.</p></>}
    {(noMeasurements || corpus.records > 0) && format === 'F1 25' && <p>2026 차량을 사용한다면 게임의 UDP 형식도 2026으로 설정해 수집하세요.</p>}
    <p>{corpus.referenceMinimums ? '참고용 전략' : '전략'} 비교 계산에는 최소 {minimums.users}명·{minimums.sessions}개의 서로 다른 경기와 {minimums.cleanLaps}개의 정상 랩이 필요합니다. 정상 랩이 하나라도 있으면 조건 카드부터 표시합니다.</p>
    <button type="button" onClick={onRefresh}>다시 확인</button>
  </div>;
}

export function strategyContextLabel(c: StrategyContext): string {
  const r = c.conditions.rules;
  return `${trackName(c.trackId)} · ${c.conditions.totalLaps}랩 · ${r.equalPerformance ? '이퀄' : `논이퀄 ${getTeamName(c.conditions.teamId ?? -1)}`} · ${weather[c.weather]} · ${c.trackTempBucket}–${c.trackTempBucket + 4}°C · v${c.conditions.gameMajor}.${c.conditions.gameMinor} · ${modeLabel(r.gameMode)} / ${rulesLabel(r.ruleSet)} · 저연료 ${r.lowFuelMode ? '어려움' : '쉬움'} · 피트 ${pitExperiences[r.pitStopExperience]}`;
}

export function StrategyContextDetails({ context: c }: { context: StrategyContext }) {
  const r = c.conditions.rules;
  return <dl className={styles.conditions}>
    <dt>서킷</dt><dd>{trackName(c.trackId)}</dd>
    <dt>게임 모드 / 규칙</dt><dd>{modeLabel(r.gameMode)} / {rulesLabel(r.ruleSet)}</dd>
    <dt>게임 연도 / 차량 규정</dt><dd>20{c.conditions.gameYear} / {c.conditions.formula === 13 ? 'F1 2026' : 'F1 현대 규정'}</dd>
    <dt>레이스 세션 / 길이</dt><dd>{c.conditions.sessionType === 15 ? 'Race' : `Race ${c.conditions.sessionType - 14}`} / {sessionLengths[r.sessionLength] ?? `길이 ${r.sessionLength}`}</dd>
    <dt>트랙 / 총 랩</dt><dd>{c.conditions.trackLengthM.toLocaleString()} m / {c.conditions.totalLaps}랩</dd>
    <dt>차량 성능</dt><dd>{r.equalPerformance ? '이퀄' : `논이퀄 · ${getTeamName(c.conditions.teamId ?? -1)}`}</dd>
    <dt>타이어 온도 / 노면</dt><dd>{r.tyreTemperature ? '표면+내부' : '표면만'} / {r.surfaceType ? '시뮬레이션' : '단순'}</dd>
    <dt>저연료 모드</dt><dd>{r.lowFuelMode ? '어려움' : '쉬움'}</dd>
    <dt>피트 레인 타이어 시뮬레이션</dt><dd>{r.pitLaneTyreSim === 0 ? '켜짐' : '꺼짐'}</dd>
    <dt>피트 스톱 경험</dt><dd>{pitExperiences[r.pitStopExperience]}</dd>
    <dt>주행 보조</dt><dd>TC {['꺼짐', '중간', '전체'][c.tractionControl]} · ABS {c.abs ? '켜짐' : '꺼짐'} · ERS {r.ersAssist ? '켜짐' : '꺼짐'}</dd>
    <dt>피트 / 릴리즈 보조</dt><dd>{r.pitAssist ? '켜짐' : '꺼짐'} / {r.pitReleaseAssist ? '켜짐' : '꺼짐'}</dd>
  </dl>;
}

export function Strategy(props: { track: TrackContext; onSetTrack: (track: TrackContext) => void; onDenied: () => void }) {
  const [trackId, setTrackId] = useState<number | null>(null);
  return <section className={styles.screen}>
    <header className={styles.header}><div><div className={styles.eyebrow}>STRATEGY LAB · 실험 중</div><h2>내 다음 레이스의 전략</h2><p>모든 사용자의 업로드 기록 중 경기 조건이 맞는 자료로 타이어·피트 조합을 비교합니다.</p></div></header>
    <div className={styles.filters}>
      <label>트랙<select value={trackId ?? ''} onChange={e => { const id = e.target.value === '' ? null : Number(e.target.value); setTrackId(id); if (id !== null) props.onSetTrack(trackContextFor(id, props.track.format)); }}><option value="">전체 트랙</option>{HUB_TRACKS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>게임<select value={props.track.format} onChange={e => props.onSetTrack(trackContextFor(trackId ?? 0, e.target.value))}>{HUB_FORMATS.map(f => <option key={f} disabled={f === 'F1 25' && trackId !== null && isF126OnlyTrack(trackId)}>{f}</option>)}</select></label>
    </div>
    <Workbench key={`${trackId ?? 'all'}:${props.track.format}`} track={{ trackId, format: props.track.format }} onDenied={props.onDenied} />
  </section>;
}

function Workbench({ track, onDenied }: { track: StrategyFilter; onDenied: () => void }) {
  const [corpus, setCorpus] = useState<StrategyContexts | null>(null);
  const [contextId, setContextId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [weatherFilter, setWeatherFilter] = useState('');
  const [performanceFilter, setPerformanceFilter] = useState('');
  const [lapsFilter, setLapsFilter] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setCorpus(null); setError('');
    void strategyClient.contexts(track, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setCorpus(data);
        setContextId(previous => data.contexts.some(c => c.id === previous) ? previous : data.contexts[0]?.id ?? '');
      }
    }).catch(err => {
      if (!controller.signal.aborted) { setError(strategyErrorMessage(err)); if (err instanceof StrategyError && err.status === 403) onDenied(); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [track.trackId, track.format, revision, onDenied]);
  const records = (corpus?.contexts ?? []).map((context, index) => ({ context, number: index + 1 }));
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = records.filter(({ context: c, number }) =>
    (!weatherFilter || String(c.weather) === weatherFilter)
    && (!performanceFilter || (c.conditions.rules.equalPerformance ? 'equal' : 'realistic') === performanceFilter)
    && (!lapsFilter || String(c.conditions.totalLaps) === lapsFilter)
    && terms.every(term => `조건 ${number} ${strategyContextLabel(c)}`.toLocaleLowerCase().includes(term)));
  const context = visible.find(({ context: c }) => c.id === contextId)?.context;
  const resetFilters = () => { setSearch(''); setWeatherFilter(''); setPerformanceFilter(''); setLapsFilter(''); };
  return <>
    {loading && <div className={styles.empty} role="status">업로드된 경기 조건을 찾고 있습니다…</div>}
    {error && <div className={styles.empty} role="alert"><p>{error}</p><button onClick={() => setRevision(n => n + 1)}>조건 다시 불러오기</button></div>}
    {!loading && !error && corpus && <>
        <StrategyObservations corpus={corpus} />
        <StrategyCollectionStatus corpus={corpus} />
        <section className={styles.card} aria-labelledby="strategy-records-title">
          <div className={styles.cardHeading}><h3 id="strategy-records-title">수집 기록 · 경기 조건</h3><button type="button" onClick={() => setRevision(n => n + 1)}>새로고침</button></div>
          <p>같은 경기 조건의 기록을 묶었습니다. 조건 카드를 선택해 전략을 비교하세요.</p>
          <div className={styles.recordFilters} role="search" aria-label="경기 조건 검색 및 필터">
            <label className={styles.searchField}>조건 검색<input type="search" placeholder="서킷, 모드, 팀, 버전, 온도 검색" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label>날씨<select value={weatherFilter} onChange={e => setWeatherFilter(e.target.value)}><option value="">전체 날씨</option>{[...new Set(corpus.contexts.map(c => c.weather))].sort((a, b) => a - b).map(value => <option key={value} value={value}>{weather[value]}</option>)}</select></label>
            <label>차량 성능<select value={performanceFilter} onChange={e => setPerformanceFilter(e.target.value)}><option value="">전체 성능</option><option value="equal">이퀄</option><option value="realistic">논이퀄</option></select></label>
            <label>총 랩 수<select value={lapsFilter} onChange={e => setLapsFilter(e.target.value)}><option value="">전체 랩 수</option>{[...new Set(corpus.contexts.map(c => c.conditions.totalLaps))].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}랩</option>)}</select></label>
            <button type="button" onClick={resetFilters}>초기화</button>
          </div>
          <p className={styles.note} role="status">조회 범위의 수집 기록 {corpus.records}건 · 경기 조건 {visible.length} / {records.length}개</p>
          {corpus.contexts.length === 0 ? <StrategyEmptyState corpus={corpus} format={track.format} onRefresh={() => setRevision(n => n + 1)} />
            : visible.length === 0 ? <div className={styles.empty}><h3>검색·필터에 맞는 경기 조건이 없습니다</h3><p>검색어나 필터를 바꾸거나 초기화해 전체 조건을 확인하세요.</p></div> : <ul className={styles.recordGrid} aria-label="경기 조건 목록">{visible.map(({ context: c, number }) => <li key={c.id}>
            <button type="button" className={styles.recordButton} aria-pressed={c.id === contextId} onClick={() => setContextId(c.id)}>
              <span className={styles.recordHeading}><strong>조건 {number} · {c.conditions.totalLaps}랩</strong><span>{c.id === contextId ? '선택됨' : '조건 선택'}</span></span>
              <strong>{trackName(c.trackId)}</strong>
              <span className={styles.recordSummary}>{weather[c.weather]} · {c.trackTempBucket}–{c.trackTempBucket + 4}°C · {c.conditions.rules.equalPerformance ? '이퀄' : `논이퀄 · ${getTeamName(c.conditions.teamId ?? -1)}`}</span>
              <span className={styles.recordSummary}>{modeLabel(c.conditions.rules.gameMode)} / {rulesLabel(c.conditions.rules.ruleSet)} · v{c.conditions.gameMajor}.{c.conditions.gameMinor}</span>
              <span className={styles.recordStats}><span><strong>{c.users}</strong>참여자</span><span><strong>{c.sessions}</strong>독립 경기</span><span><strong>{c.cleanLaps}</strong>정상 랩</span></span>
            </button>
          </li>)}</ul>}
          {context ? <><StrategyEvidenceProgress context={context} corpus={corpus} /><details key={context.id}><summary>선택한 조건 상세</summary><StrategyContextDetails context={context} /><p>게임 버전·모드·규칙·경기 길이와 물리 설정이 같은 기록끼리만 비교합니다. 드라이버와 고정 셋업 차이는 경기별 기준 페이스로 보정하며, 도중에 셋업이 바뀐 자료는 제외합니다.</p></details></> : visible.length > 0 && <p className={styles.note}>비교할 조건 카드를 선택하세요.</p>}
        </section>
        {context && <Comparison key={`${context.id}:${revision}`} track={{ trackId: context.trackId, format: track.format }} context={context} allowLimitedEvidence={!!corpus.referenceMinimums} onDenied={onDenied} />}
      <p className={styles.note}>정밀 계측을 이용한 전략 계산은 선택한 {track.trackId === null ? '전체 트랙' : trackName(track.trackId)} · {track.format} 범위에서 최근 최대 {corpus.recordLimit}개 업로드, 사용자별 최대 20경기를 사용합니다.{corpus.truncated ? ' 현재 전체 조회 한도에 도달했습니다.' : ''} 같은 사용자의 같은 경기 재업로드는 한 건으로 처리합니다.</p>
    </>}
  </>;
}

function Comparison({ track, context, allowLimitedEvidence, onDenied }: { track: TrackContext; context: StrategyContext; allowLimitedEvidence: boolean; onDenied: () => void }) {
  const wet = context.weather >= 3;
  // Editable starting inventory, never inferred from an upload.
  const [sets, setSets] = useState<StrategyRequest['availableSets']>(wet ? { Inter: 2, Wet: 1 } : { Soft: 1, Medium: 1, Hard: 1 });
  const [maxStops, setMaxStops] = useState(2);
  const [twoCompounds, setTwoCompounds] = useState(!wet);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const invalidate = () => { pending.current?.abort(); setResult(null); setError(''); setBusy(false); };
  const run = async () => {
    invalidate();
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const data = await strategyClient.simulate(track, { contextId: context.id, maxStops, availableSets: sets, requireTwoCompounds: twoCompounds,
        ...(allowLimitedEvidence ? { allowLimitedEvidence: true } : {}) }, controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch (err) {
      if (!controller.signal.aborted) { setError(strategyErrorMessage(err)); if (err instanceof StrategyError && err.status === 403) onDenied(); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <>
    <div className={styles.card}><h3>사용할 타이어와 피트 횟수</h3><p>아래 수량을 실제 사용할 <strong>새 타이어 세트</strong>에 맞추세요. 사용한 타이어의 잔여 수명은 계산하지 않습니다.</p>
      <div className={styles.inventory}>{STRATEGY_TYRES.map(tyre => <label key={tyre} style={{ borderTopColor: tyreColors[tyre] }}>{tyreLabels[tyre]}<select aria-label={`${tyreLabels[tyre]} 새 세트`} value={sets[tyre] ?? 0} onChange={e => { invalidate(); setSets({ ...sets, [tyre]: Number(e.target.value) }); }}>{[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}세트</option>)}</select></label>)}</div>
      <div className={styles.options}><label>최대 피트 횟수<select value={maxStops} onChange={e => { invalidate(); setMaxStops(Number(e.target.value)); }}>{[0, 1, 2].map(n => <option key={n} value={n}>{n}회</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={twoCompounds} onChange={e => { invalidate(); setTwoCompounds(e.target.checked); }} />서로 다른 두 종류의 타이어 사용</label></div>
      <button className={styles.primary} onClick={() => void run()} disabled={busy || !Object.values(sets).some(n => n > 0)}>{busy ? '전략 비교 중…' : '전략 비교하기'}</button>
      {error && <p role="alert">{error}</p>}
    </div>
    {result && <StrategyResultView result={result} />}
  </>;
}

export function StrategyResultView({ result: r }: { result: StrategyResult }) {
  const minimums = r.minimumEvidence ?? { users: 3, sessions: 6, cleanLaps: 40 };
  const readyTitle = r.sampleLevel === 'limited' ? '참고용 타이어·피트 조합' : '관측 자료에서 비용이 낮은 조합';
  return <div className={styles.results} aria-live="polite">
    <div className={styles.card}><div className={styles.eyebrow}>{r.sampleLevel === 'limited' ? '참고용 · 표본 제한' : '타이어 · 피트'}</div><h3>{r.status === 'ready' ? readyTitle : statusLabels[r.status] ?? '비교할 수 없습니다'}</h3>
      {r.context && <p>계산에 사용한 정상 랩 {r.context.cleanLaps}개 · {r.context.users}명 · 독립 경기 {r.context.sessions}개</p>}
      {r.sampleLevel === 'limited' && <p className={styles.note}>참여자나 경기 수가 제한된 참고용 분석입니다. 같은 기록에 맞춘 계산이며 다른 경기에서의 예측 정확도는 검증되지 않았습니다.</p>}
      {r.reasons.includes('minimum-evidence') && <p className={styles.note}>실제 계산에 사용할 수 있는 기록이 부족합니다. 최소 {minimums.users}명·{minimums.sessions}경기·정상 랩 {minimums.cleanLaps}개가 필요합니다. 타이어 종류별로도 {minimums.users}명·{minimums.sessions}경기와 3랩 이상의 타이어 사용 나이 범위를 확인합니다.</p>}
      {r.reasons.filter(reason => reasons[reason]).map(reason => <p key={reason} className={styles.note}>{reasons[reason]}</p>)}
      {r.status === 'ready' && <><p>첫 조합과의 계산상 차이입니다. 실제 완주 시간이나 확정된 최적 전략을 뜻하지 않습니다.</p>
        <ol className={styles.plans}>{r.plans.map((plan, i) => <li key={i}><div className={styles.planHeading}><strong>{i + 1}. {plan.stints.map(s => tyreLabels[s.tyre]).join(' → ')}</strong><span>{i === 0 ? '비교 기준' : `+${seconds(plan.deltaMs)}초`}</span></div>
          <div className={styles.stints}>{plan.stints.map((s, j) => <div key={j} style={{ flex: s.endLap - s.startLap + 1, background: tyreColors[s.tyre] }} title={`${tyreLabels[s.tyre]} ${s.startLap}–${s.endLap}랩`}>{s.tyre[0]} · {s.endLap - s.startLap + 1}L</div>)}</div>
          <p>{plan.pitLaps.length ? `${plan.pitLaps.map(n => `${n}랩 종료`).join(', ')}에 피트` : '무피트'} · {plan.stints.map(s => `${tyreLabels[s.tyre]} ${s.startLap}–${s.endLap}랩`).join(' / ')}</p>
        </li>)}</ol>
        <details><summary>계산 근거</summary><div className={styles.tableWrap}><table><thead><tr><th>타이어</th><th>사용 1랩당 변화</th><th>관측 나이</th><th>정상 랩</th></tr></thead><tbody>{r.compounds.map(m => <tr key={m.compound}><td>{tyreLabels[m.tyre]}</td><td>{m.ageSlopeMs >= 0 ? '+' : ''}{seconds(m.ageSlopeMs)}초</td><td>{m.minAge}–{m.maxAge}랩</td><td>{m.laps}</td></tr>)}</tbody></table></div>
          {r.fuelSlopeMsPerKg !== null && <p>연료 1 kg의 계산상 영향: {seconds(r.fuelSlopeMsPerKg)}초/랩</p>}
          {r.lapMedianAbsoluteErrorMs !== null && <p>계산에 사용한 랩의 절대 오차 중앙값: {seconds(r.lapMedianAbsoluteErrorMs)}초. 별도 경기로 검증한 예측 오차는 아닙니다.</p>}
        </details>
      </>}
      {r.pit && <p className={styles.note}>피트 전후 랩의 관측 추가 시간 {seconds(r.pit.additionalTimeMs)}초 · {r.pit.users}명 / {r.pit.sessions}경기 / {r.pit.stops}회. 타이어 예열을 포함하며 피트 레인 체류 시간과 다릅니다.</p>}
    </div>
    <div className={styles.card}><div className={styles.eyebrow}>ERS · 실측 예산</div><h3>한 랩의 사용과 회수</h3>
      {r.ers.status !== 'observed-budget' ? <p>구간별 ERS 측정이 충분하지 않습니다. 랩의 98% 이상을 측정한 자료가 3명·6경기 이상 쌓여야 표시합니다.</p> : <>
        <div className={styles.metrics}><div>사용 중앙값<strong>{mj(r.ers.deployedJ)} MJ</strong></div><div>회수 중앙값<strong>{mj(r.ers.harvestedJ)} MJ</strong></div><div>순사용 중앙값<strong>{mj(r.ers.netUseJ)} MJ</strong></div></div>
        <p>{r.ers.users}명 · {r.ers.sessions}경기 · {r.ers.laps}랩 중 {r.ers.sustainableLaps}랩은 종료 잔량이 시작 잔량 이상이었습니다.</p>
        <div className={styles.tableWrap}><table><thead><tr><th>트랙 거리 구간</th><th>사용</th><th>회수</th></tr></thead><tbody>{r.ers.segments.map((s, i) => <tr key={i}><td>{['첫 1/3', '중간 1/3', '마지막 1/3'][i]}</td><td>{mj(s.deployedJ)} MJ</td><td>{mj(s.harvestedJ)} MJ</td></tr>)}</tbody></table></div>
        <p className={styles.note}>공식 섹터가 아닌 거리 3등분입니다. 경기별 중앙값을 구한 뒤 사용자·경기의 중복 영향을 줄여 집계합니다. 랩 합계·순사용과 각 구간은 따로 중앙값을 구하므로 합이 다를 수 있습니다. 순사용이 양수면 같은 운용을 반복할 때 잔량이 줄 수 있습니다. 구간별 사용량이 시간 이득을 증명하지는 않습니다.</p>
      </>}
    </div>
    <p className={styles.note}>AI 없이 관측 기록과 수식으로 비교합니다. 정상 주행이 이어지는 조건의 기준 전략이며, 사고·트래픽·SC 발생 확률과 날씨 전환은 예측하지 않습니다. 관측된 타이어 나이 밖으로 스틴트를 늘리지 않고, 새 타이어의 첫 0–2랩은 예열을 근사합니다. 실제 경기 예측 정확도는 아직 검증되지 않았습니다.</p>
  </div>;
}
