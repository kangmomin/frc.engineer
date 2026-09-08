import { useEffect, useMemo, useRef, useState } from 'react';
import { PlatformMarket, RaceAnalysisError } from '../data/platform';
import type { IncidentReplay as IncidentReplayValue, SharedRaceAnalysis as SharedRaceAnalysisValue } from '../data/raceAnalysisTypes';
import { buildTheme } from '../theme';
import { IncidentReplay } from './IncidentReplay';
import { RaceAnalysisDetail } from './RaceAnalysisDetail';
import '../hub.css';
import styles from './Analysis.module.css';

export function SharedRaceAnalysis({ token }: { token: string }) {
  const market = useMemo(() => new PlatformMarket(), []);
  const t = useMemo(() => buildTheme('#e0a83d', 'light'), []);
  const [value, setValue] = useState<SharedRaceAnalysisValue | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [incident, setIncident] = useState<IncidentReplayValue | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentError, setIncidentError] = useState('');
  const incidentController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setValue(null);
    setError('');
    setIncident(null);
    setSelected(null);
    setIncidentLoading(false);
    setIncidentError('');
    void market.getSharedRaceAnalysis(token, controller.signal).then((detail) => {
      if (!controller.signal.aborted) setValue(detail);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(sharedError(reason));
    });
    return () => { controller.abort(); incidentController.current?.abort(); };
  }, [market, retry, token]);

  const selectIncident = (index: number) => {
    incidentController.current?.abort();
    setSelected(index);
    setIncident(null);
    setIncidentError('');
    if (!value?.detail.incidents.find((item) => item.index === index)?.frameCount) {
      setIncidentLoading(false);
      setIncidentError('이 사고에는 재생할 수 있는 프레임이 없습니다.');
      return;
    }
    const controller = new AbortController();
    incidentController.current = controller;
    setIncidentLoading(true);
    void market.getSharedRaceAnalysisIncident(token, index, controller.signal).then((replay) => {
      if (!controller.signal.aborted) setIncident(replay);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setIncidentError(sharedError(reason));
      if (reason instanceof RaceAnalysisError && reason.reason === 'not-found') {
        // A revoked capability must also discard the already visible detail.
        setValue(null);
        setError('공유가 중단되었거나 사고 기록을 찾을 수 없습니다.');
      }
    }).finally(() => { if (!controller.signal.aborted) setIncidentLoading(false); });
  };

  return <main className={styles.sharedPage}>
    <div className={styles.root}>
      <header className={styles.header}><div><div className={styles.eyebrow}>PITHUB / SHARED RACE</div><h1>공유 레이스 분석</h1><p>레이스 기록과 사고 순간을 함께 살펴보세요.</p></div><a className={styles.retryButton} href={window.location.pathname}>PitHub 열기 ↗</a></header>
      {error ? <div className={styles.gate} role="alert"><h2>공유 레이스를 열 수 없습니다</h2><p>{error}</p><button type="button" className={styles.retryButton} onClick={() => setRetry((current) => current + 1)}>다시 시도</button></div>
        : !value ? <p className={styles.status} role="status">공유 레이스를 불러오는 중…</p>
          : <div className={styles.detailSurface}><RaceAnalysisDetail key={value.detail.id} t={t} detail={value.detail} selectedIncidentIndex={selected} onSelectIncident={selectIncident} setup={value.setup}
            actions={<span className={styles.badge}>{value.includeSetup ? value.setup ? '셋업 공개' : '저장된 셋업 없음' : '셋업 비공개'}</span>}
            incidentPanel={incidentLoading ? <p className={styles.status} role="status">사고 프레임을 불러오는 중…</p>
              : incidentError ? <p role="alert" className={styles.error}>{incidentError}<button type="button" className={styles.retryButton} onClick={() => selected !== null && selectIncident(selected)}>다시 시도</button></p>
                : incident ? <IncidentReplay key={`${incident.raceId}:${incident.index}`} t={t} replay={incident} trackOutline={value.detail.trackOutline} />
                  : <p className={styles.empty}>사고를 선택하면 리플레이가 열립니다.</p>} /></div>}
    </div>
  </main>;
}

function sharedError(error: unknown): string {
  return error instanceof RaceAnalysisError && error.reason === 'not-found'
    ? '공유가 중단되었거나 링크가 올바르지 않습니다.'
    : '레이스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
