import { useState } from 'react';
import { EMPTY_ANALYSIS_FILTERS, type AnalysisFilterValues } from './raceAnalysisState';
import { HUB_FORMATS } from '../data/tracks';
import styles from './Analysis.module.css';

export function AnalysisFilters({ value, onApply }: { value: AnalysisFilterValues; onApply: (value: AnalysisFilterValues) => void }) {
  const [draft, setDraft] = useState(value);
  const change = (key: keyof AnalysisFilterValues, next: string) => setDraft((current) => ({ ...current, [key]: next }));
  return <form className={styles.filters} aria-label="레이스 필터" onSubmit={(event) => { event.preventDefault(); onApply(draft); }}>
    <label className={styles.searchField}>서킷 검색<input type="search" placeholder="서킷 이름으로 검색" maxLength={64} value={draft.search} onChange={(event) => change('search', event.target.value)} /></label>
    <label>게임<select value={draft.gameFormat} onChange={(event) => change('gameFormat', event.target.value)}><option value="">모든 게임</option>{HUB_FORMATS.map((format) => <option key={format}>{format}</option>)}</select></label>
    <label>세션<input list="analysis-session-types" placeholder="모든 세션" maxLength={48} value={draft.sessionType} onChange={(event) => change('sessionType', event.target.value)} /><datalist id="analysis-session-types">{['Race', 'Race 2', 'Race 3', 'Short Race', 'Qualifying', 'Short Qualifying', 'One Shot Qualifying', 'Time Trial', 'Practice 1', 'Practice 2', 'Practice 3'].map((session) => <option key={session} value={session} />)}</datalist></label>
    <label>시작일<input type="date" value={draft.dateFrom} max={draft.dateTo || undefined} onChange={(event) => change('dateFrom', event.target.value)} /></label>
    <label>종료일<input type="date" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={(event) => change('dateTo', event.target.value)} /></label>
    <div className={styles.filterActions}><button type="submit" className={styles.primaryButton}>필터 적용</button><button type="button" className={styles.retryButton} onClick={() => { setDraft(EMPTY_ANALYSIS_FILTERS); onApply(EMPTY_ANALYSIS_FILTERS); }}>초기화</button></div>
  </form>;
}
