import { Component, Suspense, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onBack?: () => void;
}

class ScreenErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui,sans-serif' }}>
        <p>화면을 불러오지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          {this.props.onBack && <button type="button" onClick={this.props.onBack}>돌아가기</button>}
          <button type="button" onClick={() => window.location.reload()}>새로고침</button>
        </div>
      </div>
    );
  }
}

// Keep connection and account state outside this boundary. Only the selected
// screen resets when navigation changes; failed imports can be retried by reload.
export function ScreenBoundary({ resetKey, children, onBack }: Props & { resetKey: string }) {
  return (
    <ScreenErrorBoundary key={resetKey} onBack={onBack}>
      <Suspense fallback={<div role="status" style={{ padding: 24 }}>화면을 불러오는 중…</div>}>
        {children}
      </Suspense>
    </ScreenErrorBoundary>
  );
}
