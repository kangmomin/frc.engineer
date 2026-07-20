import type { CSSProperties } from 'react';
import { useTelemetryStore } from '../store/telemetryStore';
import { getConnectionLabel } from '../utils/connectionStatus';
import type { ShellControls } from './types';

const buttonBase: CSSProperties = {
  cursor: 'pointer',
  padding: '8px 16px',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
};

/** "Waiting for telemetry stream…" 대기 화면 공통 액션 — 링크 상태 + 수동 재연결 + 홈 복귀.
 * 연결은 살아있다고 표시되지만 데이터가 오지 않는 상태(또는 무한 자동 재연결 루프)에서
 * 사용자가 스스로 빠져나올 수 있는 탈출구를 제공한다. */
export function TelemetryWaitingActions({ controls }: { controls: ShellControls }) {
  const connectionState = useTelemetryStore((s) => s.connectionState);
  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        Link status · {getConnectionLabel(connectionState)}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={controls.onReconnect}
          style={{ ...buttonBase, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', color: 'var(--accent)' }}
        >
          Reconnect
        </button>
        <button
          type="button"
          onClick={controls.onGoHome}
          style={{ ...buttonBase, background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', color: 'var(--text-secondary)' }}
        >
          Main Screen
        </button>
      </div>
    </>
  );
}
