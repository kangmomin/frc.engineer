import { useEffect, useRef, useState } from 'react';
import type { LeaderboardBoard } from '../data/types';
import type { HubTheme } from '../theme';
import { msToTime, tyreLabel } from '../format';
import { ListingError } from '../data/platform';
import type { PlatformDriverProfile, PlatformMarket } from '../data/platform';
import type { PlatformAccount } from '../data/session';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  configured: boolean;
  account: PlatformAccount | null;
  platformLoading: boolean;
  onLogin: () => void;
  client: Pick<PlatformMarket, 'getDriverProfile'>;
  accountId: string;
  onGoRankings: (accountId: string, trackId: number, format: string, board: LeaderboardBoard) => void;
}

export function DriverProfile({ t, configured, account, platformLoading, onLogin, client, accountId, onGoRankings }: Props) {
  const [profile, setProfile] = useState<PlatformDriverProfile | null>(null);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [error, setError] = useState<ListingError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setProfile(null);
    setProfileTarget(null);
    setError(null);
    if (!configured || platformLoading || !account) return;

    let alive = true;
    const controller = new AbortController();
    void client.getDriverProfile(accountId, controller.signal).then((next) => {
      if (!alive || current !== generation.current) return;
      setProfile(next);
      setProfileTarget(accountId);
    }).catch((cause: unknown) => {
      if (!alive || current !== generation.current || isAbortError(cause)) return;
      setError(cause instanceof ListingError ? cause : new ListingError('network', '프로필을 불러오지 못했습니다'));
    });
    return () => { alive = false; controller.abort(); };
  }, [account, accountId, attempt, client, configured, platformLoading]);

  if (!configured) return <StateCard t={t} title="플랫폼 미연결" note="드라이버 프로필은 Pitwall Cloud 플랫폼이 설정된 경우에만 볼 수 있습니다." />;
  if (platformLoading) return <StateCard t={t} role="status" title="세션 확인 중…" note="로그인 상태를 확인하고 있습니다." />;
  if (!account) return <LoginRequired t={t} onLogin={onLogin} />;
  if (error) return <ErrorState t={t} error={error} onLogin={onLogin} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!profile || profileTarget !== accountId) return <StateCard t={t} role="status" title="프로필 불러오는 중…" note="제출된 유효 랩과 순위를 집계하고 있습니다." />;

  return <ProfileContent t={t} profile={profile} onGoRankings={onGoRankings} />;
}

export function ProfileContent({ t, profile, onGoRankings }: { t: HubTheme; profile: PlatformDriverProfile; onGoRankings: Props['onGoRankings'] }) {
  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <Avatar t={t} url={profile.avatarUrl} persona={profile.persona} />
        <div>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: '-.01em', color: t.t1 }}>{profile.persona || '이름 없음'}</h1>
          <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 10.5, color: profile.verified ? t.ok : t.t3 }}>
            {profile.verified ? '◆ 참여 기록 있음' : '참여 기록 미확인'}
          </div>
        </div>
      </header>

      <ul aria-label="드라이버 제출 기록 요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%, 150px),1fr))', gap: 10, maxWidth: 660, padding: 0, margin: '0 0 18px', listStyle: 'none' }}>
        <Summary t={t} label="ACCEPTED RACES" value={profile.summary.verifiedRaces} />
        <Summary t={t} label="VALID LAPS" value={profile.summary.validLaps} />
        <Summary t={t} label="TRACK FORMATS" value={profile.summary.trackFormats} />
      </ul>

      <p style={{ color: t.t2, fontSize: 12, lineHeight: 1.8 }}>PB는 모든 세션의 개인 최고 유효 랩입니다. 클라이언트 제출 기록에 기본 형식·범위·섹터 검사를 적용하며, 참여 기록은 부정행위 방지 인증이 아닙니다. 페이스는 유효 랩 5개 이상의 평균이며 피트·SC 랩을 별도로 제외하지 않습니다. 표준편차는 전체 집계 랩의 시간 변동입니다.</p>
      {profile.tracks.length === 0 ? (
        <StateCard t={t} title="기록 없음" note="이 드라이버에게 표시할 기본 검사를 통과한 트랙·포맷 기록이 아직 없습니다." />
      ) : (
        <div tabIndex={0} aria-label="드라이버 트랙별 전체 세션 PB 및 유효 랩 페이스 기록 표. 가로로 스크롤할 수 있습니다." style={{ overflowX: 'auto', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12 }}>
          <table style={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 12 }}>
            <caption style={{ padding: '14px 18px', textAlign: 'left', fontFamily: MONO, fontSize: 10.5, letterSpacing: '.08em', color: t.t2, captionSide: 'top' }}>
              CANONICAL TRACK + FORMAT PERFORMANCE
            </caption>
            <thead style={{ background: t.panel2, fontFamily: MONO, fontSize: 9.5, letterSpacing: '.07em', color: t.t3 }}>
              <tr>
                <th scope="col" style={headStyle}>TRACK</th>
                <th scope="col" style={headStyle}>FORMAT</th>
                <th scope="col" style={numberHeadStyle}>PB RANK</th>
                <th scope="col" style={numberHeadStyle}>PB FIELD</th>
                <th scope="col" style={numberHeadStyle}>LAP</th>
                <th scope="col" style={numberHeadStyle}>S1</th>
                <th scope="col" style={numberHeadStyle}>S2</th>
                <th scope="col" style={numberHeadStyle}>S3</th>
                <th scope="col" style={numberHeadStyle}>PACE RANK</th>
                <th scope="col" style={numberHeadStyle}>PACE FIELD</th>
                <th scope="col" style={numberHeadStyle}>AVG</th>
                <th scope="col" style={numberHeadStyle}>LAPS</th>
                <th scope="col" style={numberHeadStyle}>표준편차 (초)</th>
                <th scope="col" style={numberHeadStyle}>기존 일관성 지수</th>
                <th scope="col" style={headStyle}>TYRE</th>
              </tr>
            </thead>
            <tbody>
              {profile.tracks.map((track) => {
                const pace = track.racePace;
                return <tr key={`${track.trackId}-${track.gameFormat}`} style={{ borderTop: `1px solid ${t.linesoft}` }}>
                  <th scope="row" style={{ ...cellStyle, textAlign: 'left', color: t.t1, fontWeight: 700 }}>{track.trackName}</th>
                  <td style={{ ...cellStyle, fontFamily: MONO, color: t.t2 }}>{track.gameFormat}</td>
                  <td style={numberCellStyle}><button onClick={() => onGoRankings(profile.accountId, track.trackId, track.gameFormat, 'pb')} style={secondaryButton(t)} aria-label={`${track.trackName} 전체 세션 PB 순위 보기`}>#{track.timeTrial.rank}</button></td>
                  <td style={numberCellStyle}>{track.timeTrial.participants}</td>
                  <td style={{ ...numberCellStyle, color: t.t1, fontWeight: 700 }}>{msToTime(track.timeTrial.lapMs)}</td>
                  <td style={numberCellStyle}>{track.timeTrial.s1Ms > 0 ? msToTime(track.timeTrial.s1Ms) : '—'}</td>
                  <td style={numberCellStyle}>{track.timeTrial.s2Ms > 0 ? msToTime(track.timeTrial.s2Ms) : '—'}</td>
                  <td style={numberCellStyle}>{track.timeTrial.s3Ms > 0 ? msToTime(track.timeTrial.s3Ms) : '—'}</td>
                  {pace ? <>
                    <td style={numberCellStyle}><button onClick={() => onGoRankings(profile.accountId, track.trackId, track.gameFormat, 'pace')} style={secondaryButton(t)} aria-label={`${track.trackName} 유효 랩 페이스 순위 보기`}>#{pace.rank}</button></td>
                    <td style={numberCellStyle}>{pace.participants}</td>
                    <td style={{ ...numberCellStyle, color: t.t1, fontWeight: 700 }}>{msToTime(pace.avgMs)}</td>
                    <td style={numberCellStyle}>{pace.laps}</td>
                    <td style={numberCellStyle}>{(pace.stddevMs / 1000).toFixed(3)}</td>
                    <td style={numberCellStyle}>{Math.round(pace.consistency * 100)}%</td>
                    <td style={{ ...cellStyle, fontFamily: MONO, fontWeight: 700 }}>{tyreLabel(pace.tyre)}</td>
                  </> : <td colSpan={7} style={{ ...cellStyle, fontStyle: 'italic', color: t.t3 }}>유효 랩 페이스 집계 없음</td>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Summary({ t, label, value }: { t: HubTheme; label: string; value: number }) {
  return <li style={{ padding: '13px 14px', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 9 }}><div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.07em', color: t.t3 }}>{label}</div><div style={{ marginTop: 5, fontFamily: MONO, fontSize: 19, fontWeight: 700, color: t.t1 }}>{value.toLocaleString()}</div></li>;
}

function LoginRequired({ t, onLogin }: { t: HubTheme; onLogin: () => void }) {
  return <StateCard t={t} title="로그인이 필요합니다" note="드라이버 프로필은 로그인한 사용자에게 제공됩니다. 전체 리더보드는 로그인 없이 볼 수 있습니다."><button onClick={onLogin} style={primaryButton(t)}>◆ STEAM 로그인</button></StateCard>;
}

function ErrorState({ t, error, onLogin, onRetry }: { t: HubTheme; error: ListingError; onLogin: () => void; onRetry: () => void }) {
  if (error.reason === 'unauthorized') return <StateCard t={t} role="alert" title="로그인이 만료되었습니다" note="다시 로그인한 뒤 드라이버 프로필을 확인하세요."><button onClick={onLogin} style={primaryButton(t)}>◆ 다시 로그인</button></StateCard>;
  if (error.reason === 'forbidden') return <StateCard t={t} role="alert" title="프로필 접근이 거부되었습니다" note="이 계정에서는 드라이버 프로필을 볼 권한이 없습니다." />;
  if (error.reason === 'not-found') return <StateCard t={t} role="alert" title="프로필을 사용할 수 없습니다" note="드라이버가 없거나 공개 상태가 변경되었습니다." />;
  return <StateCard t={t} role="alert" title="프로필을 불러오지 못했습니다" note="네트워크 상태를 확인한 뒤 다시 시도하세요."><button onClick={onRetry} style={secondaryButton(t)}>다시 시도</button></StateCard>;
}

function StateCard({ t, role, title, note, children }: { t: HubTheme; role?: 'status' | 'alert'; title: string; note: string; children?: React.ReactNode }) {
  return <section role={role} style={{ maxWidth: 600, padding: '38px 24px', textAlign: 'center', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12 }}><h1 style={{ margin: 0, fontFamily: MONO, fontSize: 13, letterSpacing: '.08em', color: t.t2 }}>{title}</h1><p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.6, color: t.t3 }}>{note}</p>{children && <div style={{ marginTop: 18 }}>{children}</div>}</section>;
}

function Avatar({ t, url, persona }: { t: HubTheme; url: string; persona: string }) {
  if (url) return <img src={url} alt="" width={52} height={52} style={{ borderRadius: 12, border: `1px solid ${t.line2}` }} />;
  return <div aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 12, background: t.panel2, border: `1px solid ${t.line2}`, display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 19, color: t.t3 }}>{(persona || '?').slice(0, 1).toUpperCase()}</div>;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

const headStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' };
const numberHeadStyle: React.CSSProperties = { ...headStyle, textAlign: 'right' };
const cellStyle: React.CSSProperties = { padding: '12px', whiteSpace: 'nowrap', color: '#565b66' };
const numberCellStyle: React.CSSProperties = { ...cellStyle, textAlign: 'right', fontFamily: MONO };

function primaryButton(t: HubTheme): React.CSSProperties {
  return { cursor: 'pointer', border: 0, borderRadius: 8, padding: '10px 15px', background: t.acc, color: t.onAcc, fontFamily: MONO, fontWeight: 700, fontSize: 11.5 };
}

function secondaryButton(t: HubTheme): React.CSSProperties {
  return { cursor: 'pointer', border: `1px solid ${t.line2}`, borderRadius: 8, padding: '10px 15px', background: t.panel2, color: t.t1, fontFamily: MONO, fontWeight: 700, fontSize: 11.5 };
}
