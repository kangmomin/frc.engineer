// Profile screen — Steam identity, verification (proof-of-play) status, and
// device pairing for the local desktop uploader. Replaces the placeholder once
// the platform (cmd/platform) is wired.
import { useState } from 'react';
import type { HubTheme } from '../theme';
import type { PlatformAccount } from '../data/session';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  configured: boolean;
  account: PlatformAccount | null;
  loading: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onGeneratePairing: () => Promise<string>;
  viewOnly?: boolean;
}

export function Profile({ t, configured, account, loading, onLogin, onLogout, onGeneratePairing, viewOnly = false }: Props) {
  return (
    <section style={{ maxWidth: 620 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>Profile</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>
          Steam 계정 · <span style={{ color: t.ok, fontWeight: 600 }}>proof-of-play</span> 참여 기록 · 디바이스 페어링
        </div>
      </div>

      {!configured ? (
        <Card t={t}>
          <div style={{ fontSize: 13.5, color: t.t2, lineHeight: 1.6 }}>
            플랫폼 서비스가 설정되지 않았습니다. <code style={{ fontFamily: MONO, fontSize: 12, color: t.accInk }}>VITE_PLATFORM_URL</code> 이 지정되면
            Steam 로그인·리더보드·마켓이 활성화됩니다. 현재는 로컬 데이터와 데모 목업으로 동작합니다.
          </div>
        </Card>
      ) : loading ? (
        <Card t={t}>
          <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '.1em', color: t.t3 }}>불러오는 중…</div>
        </Card>
      ) : !account ? (
        <LoginCard t={t} onLogin={onLogin} />
      ) : (
        <>
          <AccountCard t={t} account={account} onLogout={viewOnly ? undefined : onLogout} />
          {viewOnly ? (
            <Card t={t} style={{ marginTop: 14 }}><div style={{ fontSize: 12.5, color: t.t2 }}>View As에서는 계정 정보만 표시하며 로그아웃과 디바이스 페어링은 사용할 수 없습니다.</div></Card>
          ) : <PairingCard t={t} onGeneratePairing={onGeneratePairing} />}
        </>
      )}
    </section>
  );
}

function LoginCard({ t, onLogin }: { t: HubTheme; onLogin: () => void }) {
  return (
    <Card t={t}>
      <div style={{ fontSize: 15, fontWeight: 700, color: t.t1, marginBottom: 6 }}>Steam으로 로그인</div>
      <div style={{ fontSize: 13, color: t.t2, lineHeight: 1.6, marginBottom: 18 }}>
        Steam 계정으로 인증하면 크로스유저 리더보드·셋업 마켓·크레딧 지갑을 사용할 수 있습니다.
        텔레메트리 제출 이력(proof-of-play)은 참여 근거입니다. 게임 소유권이나 부정행위 방지를 인증하지 않습니다.
      </div>
      <button
        onClick={onLogin}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer',
          fontFamily: MONO, fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em',
          padding: '11px 20px', border: 0, borderRadius: 9, background: t.acc, color: t.onAcc,
        }}
      >
        ◆ STEAM 로그인
      </button>
    </Card>
  );
}

function AccountCard({ t, account, onLogout }: { t: HubTheme; account: PlatformAccount; onLogout?: () => void }) {
  return (
    <Card t={t}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Avatar t={t} url={account.avatarUrl} persona={account.persona} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {account.persona || '이름 없음'}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3, marginTop: 3 }}>{account.steamId64}</div>
          <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
            {account.banned ? (
              <Badge label="BANNED" fg={t.onAcc} bg={t.negRed} />
            ) : account.verified ? (
              <Badge label="◆ 참여 기록 있음" fg={t.onAcc} bg={t.ok} />
            ) : (
              <Badge label="참여 기록 미확인" fg={t.t2} bg={t.panel2} border={t.line2} />
            )}
          </div>
        </div>
        {onLogout && <button
          onClick={onLogout}
          style={{
            cursor: 'pointer', fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.05em',
            padding: '8px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${t.line2}`, color: t.t2,
          }}
        >
          로그아웃
        </button>}
      </div>
      {!account.verified && !account.banned && (
        <div style={{ fontSize: 12, color: t.t3, marginTop: 14, lineHeight: 1.6, borderTop: `1px solid ${t.linesoft}`, paddingTop: 12 }}>
          아직 참여 기록이 확인되지 않았습니다. 데스크톱 앱을 페어링하고 F1 세션 텔레메트리를 1건 이상 업로드하면
          <span style={{ color: t.ok, fontWeight: 600 }}> proof-of-play</span> 참여 기록이 반영됩니다.
        </div>
      )}
    </Card>
  );
}

function PairingCard({ t, onGeneratePairing }: { t: HubTheme; onGeneratePairing: () => Promise<string> }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const generate = async () => {
    setBusy(true);
    setErr(false);
    try {
      setCode(await onGeneratePairing());
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card t={t} style={{ marginTop: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: t.t1, marginBottom: 6 }}>디바이스 페어링</div>
      <div style={{ fontSize: 12.5, color: t.t2, lineHeight: 1.6, marginBottom: 14 }}>
        데스크톱 앱(Pitwall Sender)이 이 계정으로 텔레메트리를 업로드하려면 페어링 코드가 필요합니다.
        코드를 생성해 데스크톱 앱에 입력하세요. 코드는 10분간 유효하며 1회만 사용됩니다.
      </div>
      {code ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={{
            fontFamily: MONO, fontSize: 12.5, color: t.accInk, background: t.inset,
            border: `1px solid ${t.line2}`, borderRadius: 8, padding: '10px 14px', wordBreak: 'break-all',
          }}>{code}</code>
          <button onClick={generate} disabled={busy} style={ghostBtn(t, busy)}>새 코드</button>
        </div>
      ) : (
        <button onClick={generate} disabled={busy} style={ghostBtn(t, busy)}>
          {busy ? '생성 중…' : '페어링 코드 생성'}
        </button>
      )}
      {err && <div style={{ fontSize: 12, color: t.negRed, marginTop: 10 }}>코드 생성에 실패했습니다. 다시 시도하세요.</div>}
    </Card>
  );
}

function Avatar({ t, url, persona }: { t: HubTheme; url: string; persona: string }) {
  if (url) {
    return <img src={url} alt={persona} width={56} height={56} style={{ borderRadius: 12, flex: 'none', border: `1px solid ${t.line2}` }} />;
  }
  return (
    <div style={{ width: 56, height: 56, borderRadius: 12, flex: 'none', background: t.panel2, border: `1px solid ${t.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 20, color: t.t3 }}>
      {(persona || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

function Badge({ label, fg, bg, border }: { label: string; fg: string; bg: string; border?: string }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: fg, background: bg, border: border ? `1px solid ${border}` : 0, padding: '3px 8px', borderRadius: 5 }}>
      {label}
    </span>
  );
}

function Card({ t, children, style }: { t: HubTheme; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function ghostBtn(t: HubTheme, busy: boolean): React.CSSProperties {
  return {
    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
    fontFamily: MONO, fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em',
    padding: '10px 16px', borderRadius: 8, background: t.panel2, border: `1px solid ${t.line2}`, color: t.t1,
  };
}
