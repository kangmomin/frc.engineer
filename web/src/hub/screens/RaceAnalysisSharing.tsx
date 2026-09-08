import { useEffect, useRef, useState } from 'react';
import { PlatformMarket } from '../data/platform';
import type { RaceAnalysisShare } from '../data/raceAnalysisTypes';
import styles from './Analysis.module.css';

function raceShareUrl(token: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  // The capability stays out of frontend access logs and HTTP referrers.
  url.hash = new URLSearchParams({ raceShare: token }).toString();
  return url.toString();
}

export function RaceAnalysisSharing({ market, raceId, canEdit }: { market: PlatformMarket; raceId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className={styles.sharing} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className={styles.primaryButton}>공유</summary>
    {open && <ShareForm market={market} raceId={raceId} canEdit={canEdit} />}
  </details>;
}

function ShareForm({ market, raceId, canEdit }: { market: PlatformMarket; raceId: string; canEdit: boolean }) {
  const [share, setShare] = useState<RaceAnalysisShare | null>(null);
  const [includeSetup, setIncludeSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void market.getRaceAnalysisShare(raceId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setShare(value);
      setIncludeSetup(value?.includeSetup ?? false);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : '공유 설정을 불러오지 못했습니다.');
    });
    return () => { alive.current = false; controller.abort(); };
  }, [market, raceId, retry]);

  const update = async (revoke = false) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const value = revoke ? (await market.deleteRaceAnalysisShare(raceId), null) : await market.setRaceAnalysisShare(raceId, includeSetup);
      if (!alive.current) return;
      setShare(value);
      setIncludeSetup(value?.includeSetup ?? false);
      setMessage(revoke ? '공유를 중단했습니다. 기존 링크는 더 이상 열리지 않습니다.' : '공유 설정을 저장했습니다.');
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '공유 설정을 저장하지 못했습니다.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const copy = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(raceShareUrl(share.token));
      if (alive.current) setMessage('링크를 복사했습니다.');
    } catch {
      if (alive.current) setMessage('아래 링크를 선택해 직접 복사해 주세요.');
    }
  };
  const changed = share !== null && share.includeSetup !== includeSetup;
  return <div className={styles.sharePanel}>
    <h3>레이스 공유</h3><p>링크가 있는 누구나 로그인 없이 분석과 사고 리플레이를 볼 수 있습니다.</p>
    {loading && !error && <p role="status">공유 설정을 불러오는 중…</p>}
    <label className={styles.checkLabel}><input type="checkbox" checked={includeSetup} disabled={loading || busy || !canEdit} onChange={(event) => setIncludeSetup(event.target.checked)} />셋업 값도 공개</label>
    <p className={styles.meta}>{includeSetup ? '저장된 셋업 값을 함께 공개합니다.' : '셋업 값은 공유 화면에 포함되지 않습니다.'}</p>
    {!canEdit && <p className={styles.meta}>공유 설정을 변경할 권한이 없습니다.</p>}
    <div className={styles.controls}>
      {canEdit && <button type="button" disabled={loading || busy || (share !== null && !changed)} onClick={() => void update()}>{busy ? '저장 중…' : share ? '공개 설정 저장' : '공유 링크 만들기'}</button>}
      {share && <button type="button" disabled={busy || changed} onClick={() => void copy()}>링크 복사</button>}
      {share && canEdit && <button type="button" disabled={busy} onClick={() => void update(true)}>공유 중단</button>}
    </div>
    {changed && <p className={styles.meta}>변경한 공개 설정을 저장해 주세요.</p>}
    {share && <label className={styles.shareLink}>공유 링크<input readOnly value={raceShareUrl(share.token)} onFocus={(event) => event.target.select()} /><a href={raceShareUrl(share.token)} target="_blank" rel="noreferrer">공유 화면 열기 ↗</a></label>}
    {message && <p role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}{loading && <button type="button" className={styles.retryButton} onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}</p>}
  </div>;
}
