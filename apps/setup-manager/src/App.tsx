import { Component, useState, useEffect, type ReactNode } from 'react';
import { F1SetupManager } from './F1SetupManager';
import { Button, Hint, Modal, Notice, Panel } from './ui';

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
      onOpenSenderUdpSettings?: (cb: () => void) => () => void;
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
      <Modal zIndex={30000}>
        <Panel title="Mandatory Update" detail="필수 업데이트" tone="secondary">
          <Hint>
            {installing
              ? '설치를 시작합니다. 앱이 곧 자동으로 재시작됩니다.'
              : `새 버전 v${update.version} 을 내려받는 중입니다. 완료되면 자동으로 설치·재시작됩니다.`}
          </Hint>
          <div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,229,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: 'var(--accent)', transition: 'width 0.3s' }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-racing)', fontWeight: 700 }}>
              {installing ? '설치 준비 중...' : `${percent}%`}
            </div>
          </div>
          <Hint>
            진행되지 않으면{' '}
            <a href={update.releasesUrl || RELEASES_URL} target="_blank" rel="noopener noreferrer">
              릴리스 페이지
            </a>
            에서 직접 내려받아 설치할 수 있습니다.
          </Hint>
        </Panel>
      </Modal>
    );
  }

  if (update.status === 'downloading') {
    return (
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,229,255,0.1)', zIndex: 10000 }}>
        <div style={{ height: '100%', width: `${update.percent || 0}%`, background: 'var(--accent)', transition: 'width 0.3s' }} />
      </div>
    );
  }

  if (update.status === 'ready') {
    return (
      <BottomBar>
        <Notice
          tone="info"
          title={`v${update.version} 업데이트 준비 완료`}
          action={<Button size="sm" onClick={() => window.electronAPI?.installUpdate?.()}>재시작</Button>}
        />
      </BottomBar>
    );
  }

  // 강제 업데이트 실패 — 게이트는 해제되고(fail-open) 수동 설치 안내만 남는다
  if (update.status === 'error' && !dismissed) {
    return (
      <BottomBar>
        <Notice
          tone="error"
          title={`업데이트 설치 실패${update.version ? ` (v${update.version})` : ''}`}
          action={
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <a href={update.releasesUrl || RELEASES_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600 }}>
                다운로드
              </a>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                닫기
              </Button>
            </span>
          }
        >
          수동으로 내려받아 주세요
        </Notice>
      </BottomBar>
    );
  }

  return null;
}

function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10000, padding: '8px 16px', background: 'var(--bg-panel)', borderTop: '1px solid var(--bg-panel-border)', backdropFilter: 'blur(8px)' }}>
      {children}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontSize: 13, background: 'var(--bg-primary)', height: '100%', overflow: 'auto' }}>
          <h2 style={{ color: 'var(--accent-red)', fontFamily: 'var(--font-racing)', marginBottom: 16 }}>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)', marginTop: 8, fontSize: 11 }}>{this.state.error.stack}</pre>
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
