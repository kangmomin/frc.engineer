import { Component, useState, useEffect, type ReactNode } from 'react';
import { F1SetupManager } from './F1SetupManager';

interface SenderStorageInfo {
  selected: string | null;
  effective: string;
  usingCustom: boolean;
}

interface OverlayHotkeySyncResult {
  hotkeys: {
    radar?: string;
    weather?: string;
    strategy?: string;
    radio?: string;
  };
  errors: string[];
  registered: {
    radar: boolean;
    weather: boolean;
    strategy: boolean;
    radio?: boolean;
  };
}

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      onUpdateStatus?: (cb: (data: UpdateStatus) => void) => void;
      getUpdateStatus?: () => Promise<UpdateStatus | null>;
      installUpdate?: () => void;
      getSetting?: <T = unknown>(key: string) => Promise<T | null>;
      setSetting?: (key: string, value: unknown) => Promise<void>;
      getAllSettings?: () => Promise<Record<string, unknown>>;
      getOverlayHotkeys?: () => Promise<Record<string, string> | null>;
      setOverlayHotkeys?: (hotkeys: OverlayHotkeySyncResult['hotkeys']) => Promise<OverlayHotkeySyncResult>;
      getSenderStorageInfo?: () => Promise<SenderStorageInfo>;
      selectDirectory?: (defaultPath?: string) => Promise<string | null>;
      restartSender?: () => Promise<void>;
      getIntercomBridgeToken?: () => Promise<string>;
    };
  }
}

interface UpdateStatus {
  status: 'available' | 'downloading' | 'ready' | 'error' | 'mandatory' | 'unavailable';
  phase?: 'downloading' | 'installing';
  version?: string;
  percent?: number;
  releasesUrl?: string;
}

const RELEASES_URL = 'https://github.com/kangmomin/frc.engineer-deploy/releases';

function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.electronAPI?.onUpdateStatus?.((data: UpdateStatus) => {
      setUpdate(data);
      setDismissed(false);
    });
    // 마운트 전에 도착한 상태를 놓치지 않도록 현재 값을 한 번 끌어온다
    void window.electronAPI
      ?.getUpdateStatus?.()
      .then((data) => {
        if (data) setUpdate((prev) => prev ?? data);
      })
      .catch(() => {});
  }, []);

  if (!update) return null;

  // 필수 업데이트 — 해제 수단 없는 전체화면 게이트 (zIndex 는 PairingGateModal 20000 보다 위)
  if (update.status === 'mandatory') {
    const installing = update.phase === 'installing';
    const percent = installing ? 100 : update.percent || 0;
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 30000,
        background: 'rgba(6, 8, 10, 0.92)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <div style={{
          width: '100%', maxWidth: 460,
          background: 'rgba(32, 31, 32, 0.92)',
          border: '1px solid rgba(59, 73, 76, 0.15)',
          borderRadius: 8, padding: 24,
          fontFamily: 'Inter, sans-serif', color: '#e5e2e3',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 6 }}>
            필수 업데이트
          </div>
          <div style={{ fontSize: 12, color: '#849396', lineHeight: 1.6, marginBottom: 18 }}>
            {installing
              ? '설치를 시작합니다. 앱이 곧 자동으로 재시작됩니다.'
              : `새 버전 v${update.version} 을 내려받는 중입니다. 완료되면 자동으로 설치·재시작됩니다.`}
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,229,255,0.1)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent}%`, background: '#00e5ff', transition: 'width 0.3s' }} />
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#5a6577', fontFamily: "'Space Grotesk', sans-serif" }}>
            {installing ? '설치 준비 중...' : `${percent}%`}
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: '#5a6577', lineHeight: 1.6 }}>
            진행되지 않으면{' '}
            <a
              href={update.releasesUrl || RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#849396' }}
            >
              릴리스 페이지
            </a>
            에서 직접 내려받아 설치할 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  if (update.status === 'downloading') {
    return (
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,229,255,0.1)', zIndex: 10000 }}>
        <div style={{ height: '100%', width: `${update.percent || 0}%`, background: '#00e5ff', transition: 'width 0.3s' }} />
      </div>
    );
  }

  if (update.status === 'ready') {
    return (
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(0,229,255,0.08)', backdropFilter: 'blur(8px)',
        borderTop: '1px solid rgba(0,229,255,0.15)',
        padding: '8px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', zIndex: 10000,
        fontFamily: 'Inter, sans-serif', fontSize: 13,
      }}>
        <span style={{ color: '#c8d0da' }}>v{update.version} 업데이트 준비 완료</span>
        <button
          onClick={() => window.electronAPI?.installUpdate?.()}
          style={{
            background: '#00e5ff', color: '#06080d', border: 'none',
            borderRadius: 4, padding: '4px 14px', fontWeight: 600,
            fontSize: 12, cursor: 'pointer',
          }}
        >
          재시작
        </button>
      </div>
    );
  }

  // 강제 업데이트 실패 — 게이트는 해제되고(fail-open) 수동 설치 안내만 남는다
  if (update.status === 'error' && !dismissed) {
    return (
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,82,92,0.08)', backdropFilter: 'blur(8px)',
        borderTop: '1px solid rgba(255,82,92,0.2)',
        padding: '8px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 12, zIndex: 10000,
        fontFamily: 'Inter, sans-serif', fontSize: 13,
      }}>
        <span style={{ color: '#c8d0da' }}>
          업데이트 설치 실패{update.version ? ` (v${update.version})` : ''} — 수동으로 내려받아 주세요
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <a
            href={update.releasesUrl || RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#00e5ff', fontSize: 12, fontWeight: 600 }}
          >
            다운로드
          </a>
          <button
            onClick={() => setDismissed(true)}
            style={{
              background: 'transparent', color: '#849396',
              border: '1px solid rgba(59,73,76,0.4)', borderRadius: 4,
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </span>
      </div>
    );
  }

  return null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff525c', fontFamily: 'monospace', fontSize: 13, background: '#06080d', minHeight: '100vh' }}>
          <h2 style={{ color: '#00e5ff', marginBottom: 16 }}>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#c8d0da' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#5a6577', marginTop: 8, fontSize: 11 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <>
      <ErrorBoundary>
        <F1SetupManager />
      </ErrorBoundary>
      {/* 본체가 죽어도 강제 업데이트 게이트는 살아 있어야 한다 — 경계 밖에 둔다 */}
      <UpdateBanner />
    </>
  );
}
