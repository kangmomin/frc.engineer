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
  };
  errors: string[];
  registered: {
    radar: boolean;
    weather: boolean;
    strategy: boolean;
  };
}

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      onUpdateStatus?: (cb: (data: UpdateStatus) => void) => void;
      installUpdate?: () => void;
      getSetting?: <T = unknown>(key: string) => Promise<T | null>;
      setSetting?: (key: string, value: unknown) => Promise<void>;
      getAllSettings?: () => Promise<Record<string, unknown>>;
      getOverlayHotkeys?: () => Promise<Record<string, string> | null>;
      setOverlayHotkeys?: (hotkeys: Record<string, string>) => Promise<OverlayHotkeySyncResult>;
      getSenderStorageInfo?: () => Promise<SenderStorageInfo>;
      selectDirectory?: (defaultPath?: string) => Promise<string | null>;
      restartSender?: () => Promise<void>;
    };
  }
}

interface UpdateStatus {
  status: 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
}

function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    window.electronAPI?.onUpdateStatus?.((data: UpdateStatus) => setUpdate(data));
  }, []);

  if (!update) return null;

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
    <ErrorBoundary>
      <F1SetupManager />
      <UpdateBanner />
    </ErrorBoundary>
  );
}
