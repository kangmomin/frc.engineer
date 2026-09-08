import type { HubTheme } from '../theme';
import { msToTime, secFmt, gapLabel, tyreLabel } from '../format';
import type { LeaderboardBoard, LeaderboardPage, LeaderboardPosition } from '../data/types';
import type { LeaderboardLoad } from '../data/leaderboardState';
import { HUB_TRACKS, HUB_FORMATS } from '../data/tracks';
import { SelectChip } from '../components/SelectChip';

const MONO = "'JetBrains Mono',monospace";
const BOARDS: { value: LeaderboardBoard; label: string }[] = [
  { value: 'pb', label: 'ALL-SESSION PB' }, { value: 'tt', label: 'TIME TRIAL' }, { value: 'pace', label: 'VALID-LAP PACE' },
];
interface Props {
  t: HubTheme;
  load: LeaderboardLoad;
  configured: boolean;
  signedIn: boolean;
  trackId: number;
  format: string;
  onSetTrack: (id: number) => void;
  onSetFormat: (format: string) => void;
  tab: LeaderboardBoard;
  onSetTab: (tab: LeaderboardBoard) => void;
  rowPad: string;
  highlightAccountId: string | null;
  position: LeaderboardPosition;
  onNavigate: (position: LeaderboardPosition) => void;
  onRetry: () => void;
}

export function Rankings({ t, load, configured, signedIn, trackId, format, onSetTrack, onSetFormat, tab, onSetTab, rowPad, highlightAccountId, position, onNavigate, onRetry }: Props) {
  const data = load.data;
  const missingAnchor = Boolean(position.around && data && !data.anchorFound);
  const busy = load.status === 'loading';
  const navigate = (target: LeaderboardPosition) => { if (!busy) onNavigate(target); };
  const buttonStyle: React.CSSProperties = { padding: '9px 13px', border: `1px solid ${t.line2}`, borderRadius: 7, background: t.panel, color: t.t1, cursor: 'pointer', fontSize: 12 };
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: t.t1 }}>Leaderboards</h1>
          <p style={{ fontSize: 12.5, color: t.t2, margin: '6px 0 0', maxWidth: 700, lineHeight: 1.7 }}>
            클라이언트가 제출한 유효 랩 중 기본 형식·범위·섹터 검사를 통과한 기록입니다. 계정의 참여 기록은 부정행위 방지 인증을 뜻하지 않습니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SelectChip t={t} label="TRACK" value={String(trackId)} onChange={(v) => onSetTrack(Number(v))} options={HUB_TRACKS.map((tr) => ({ value: String(tr.id), label: tr.name }))} />
          <SelectChip t={t} label="FORMAT" value={format} onChange={onSetFormat} options={HUB_FORMATS.map((f) => ({ value: f, label: f }))} />
        </div>
      </div>
      <div aria-label="기록 기준" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
        {BOARDS.map(({ value, label }) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => onSetTab(value)} style={{ ...buttonStyle, fontFamily: MONO, background: tab === value ? t.acc : t.panel2, color: tab === value ? t.onAcc : t.t2 }}>{label}</button>)}
      </div>
      <p style={{ color: t.t2, fontSize: 12, lineHeight: 1.7 }}>
        {tab === 'pb' ? '모든 세션의 개인 최고 유효 랩입니다. 세션 유형을 알 수 없는 기록도 포함합니다.' : tab === 'tt' ? '세션 유형이 Time Trial로 저장된 기록만 집계합니다. Race·Practice·유형 미상 기록은 PB에서 확인하세요.' : '모든 세션의 유효 랩 5개 이상을 집계한 평균입니다. 피트·아웃·인·SC 랩을 별도로 제외하지 않습니다.'}
      </p>
      {configured && <>
        <div aria-live="polite" style={{ color: t.t2, fontSize: 12, marginBottom: 10 }}>
          {data ? `전체 ${data.total.toLocaleString()}명${data.rows.length ? ` · P${data.rows[0].rank}–P${data.rows[data.rows.length - 1].rank}` : ''}` : busy ? '순위 불러오는 중…' : '순위 조회 실패'}
          {signedIn && data && (data.viewer ? ` · 내 순위 P${data.viewer.rank}` : ' · 이 기준에 내 기록 없음')}
        </div>
        <nav aria-label="순위 페이지" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <button type="button" style={buttonStyle} aria-disabled={busy} onClick={() => navigate({})}>처음</button>
          <button type="button" style={buttonStyle} aria-disabled={busy || !data?.previousCursor} onClick={() => { if (data?.previousCursor) navigate({ cursor: data.previousCursor }); }}>이전</button>
          <button type="button" style={buttonStyle} aria-disabled={busy || !data?.nextCursor} onClick={() => { if (data?.nextCursor) navigate({ cursor: data.nextCursor }); }}>다음</button>
          <button type="button" style={buttonStyle} disabled={!signedIn} aria-disabled={busy || !signedIn} aria-describedby={!signedIn ? 'rank-login-note' : undefined} onClick={() => { if (signedIn) navigate({ around: 'me' }); }}>내 순위 주변</button>
        </nav>
        {!signedIn && <p id="rank-login-note" style={{ color: t.t3, fontSize: 12 }}>로그인하면 내 순위와 주변 기록을 볼 수 있습니다. 전체 순위는 로그인 없이 탐색할 수 있습니다.</p>}
      </>}
      {!configured ? <State t={t} title="플랫폼 미연결" note="리더보드는 Pitwall Cloud 플랫폼에 연결됐을 때 표시됩니다." />
        : load.status === 'error' ? <div role="alert"><State t={t} title="순위를 불러오지 못했습니다" note={load.error} /><button type="button" onClick={onRetry} style={{ ...buttonStyle, marginTop: 12 }}>다시 시도</button></div>
        : !data ? <State t={t} title="불러오는 중…" note="" />
        : missingAnchor ? <State t={t} title={position.around === 'me' ? '내 기록 없음' : '선택한 드라이버의 기록 없음'} note="이 트랙·포맷·기록 기준에 해당 드라이버의 순위가 없습니다. 처음 버튼으로 전체 순위를 볼 수 있습니다." />
        : data.rows.length === 0 && data.total > 0 ? <State t={t} title="현재 페이지에 기록 없음" note="조회 중 기록이 변경되었을 수 있습니다. 처음 버튼으로 전체 순위를 다시 확인하세요." />
        : data.rows.length === 0 ? <State t={t} title="기록 없음" note={tab === 'tt' ? '이 트랙·포맷에 Time Trial 세션 기록이 없습니다. 다른 세션의 기록은 ALL-SESSION PB에서 확인하세요.' : '이 트랙·포맷에 집계 가능한 유효 랩 기록이 아직 없습니다.'} />
        : <RecordsTable t={t} data={data} rowPad={rowPad} highlightAccountId={highlightAccountId} />}
      {tab === 'pace' && <p style={{ fontSize: 12, color: t.t3, lineHeight: 1.8 }}>표준편차는 집계된 전체 랩의 시간 변동을 초 단위로 표시합니다. ±1초 비율은 표시 평균에서 1초 이내(경계 포함)에 든 랩의 비율이며 성공 확률이 아닙니다. 기존 일관성 지수는 1 − 표준편차 / 평균입니다.</p>}
      {data && <p style={{ color: t.t3, fontSize: 11, lineHeight: 1.7 }}>조회 기준 시각: {data.asOf} · 이후 업로드는 다음 페이지에서 제외됩니다. 진행 중이던 업로드의 반영·기록 삭제·계정 정지로 순위가 달라질 수 있습니다. 동률에도 고유한 순번을 부여합니다.</p>}
    </section>
  );
}

function State({ t, title, note }: { t: HubTheme; title: string; note: string }) {
  return <div role="status" style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: '36px 24px', textAlign: 'center' }}><div style={{ fontSize: 13, color: t.t2, fontWeight: 600 }}>{title}</div>{note && <p style={{ fontSize: 12.5, color: t.t3, lineHeight: 1.7 }}>{note}</p>}</div>;
}

function RecordsTable({ t, data, rowPad, highlightAccountId }: { t: HubTheme; data: LeaderboardPage; rowPad: string; highlightAccountId: string | null }) {
  const pace = data.board === 'pace';
  const headers = pace ? ['순위', '드라이버', '평균', '타이어', '랩 수', '표준편차 (초)', '평균 ±1초', '기존 일관성 지수', '전체 1위와 차이'] : ['순위', '드라이버', 'S1', 'S2', 'S3', '랩', '전체 1위와 차이'];
  const cell: React.CSSProperties = { padding: `${rowPad} 14px`, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: MONO };
  return <div tabIndex={0} role="region" aria-label="전체 순위 기록 표. 가로로 스크롤할 수 있습니다." style={{ overflowX: 'auto', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12 }}>
    <table style={{ width: '100%', minWidth: pace ? 1050 : 760, borderCollapse: 'collapse', color: t.t2, fontSize: 12 }}>
      <caption style={{ padding: 12, textAlign: 'left', fontFamily: MONO, color: t.t1 }}>{BOARDS.find((board) => board.value === data.board)?.label}</caption>
      <thead style={{ background: t.panel2, color: t.t3 }}><tr>{headers.map((header, index) => <th key={header} scope="col" style={{ ...cell, textAlign: index === 1 ? 'left' : 'right' }}>{header}</th>)}</tr></thead>
      <tbody>{data.rows.map((row) => <tr key={row.accountId} style={{ borderTop: `1px solid ${t.linesoft}`, background: row.you || row.accountId === highlightAccountId ? t.accSoft : undefined }}>
        <td style={{ ...cell, color: row.you ? t.accInk : t.t1, fontWeight: 700 }}>{row.rank}</td>
        <th scope="row" style={{ ...cell, textAlign: 'left', color: t.t1 }}>{row.persona}{row.you && <span style={{ marginLeft: 8, color: t.accInk }}>YOU</span>}{row.accountId === highlightAccountId && <span style={{ marginLeft: 8, color: t.accInk }}>MATCH</span>}</th>
        {pace ? <>
          <td style={cell}>{msToTime(row.scoreMs)}</td><td style={cell}>{row.tyre === null ? '—' : tyreLabel(row.tyre)}</td><td style={cell}>{row.laps ?? '—'}</td>
          <td style={cell}>{row.stddevMs === null ? '—' : (row.stddevMs / 1000).toFixed(3)}</td>
          <td style={cell}>{row.withinOneSecond === null ? '—' : `${(row.withinOneSecond * 100).toFixed(1)}%`}</td>
          <td style={cell}>{row.consistency === null ? '—' : `${(row.consistency * 100).toFixed(1)}%`}</td>
        </> : <>
          {[0, 1, 2].map((index) => <td key={index} style={cell}>{row.sectorsMs && row.sectorsMs[index] > 0 ? secFmt(row.sectorsMs[index]) : '—'}</td>)}
          <td style={{ ...cell, fontWeight: 700, color: t.t1 }}>{msToTime(row.scoreMs)}</td>
        </>}
        <td style={cell}>{data.leaderMs === null ? '—' : gapLabel(row.scoreMs, data.leaderMs)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
