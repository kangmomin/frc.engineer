import { Component, type ReactNode } from 'react';
import { F1SetupManager } from './F1SetupManager';

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
    </ErrorBoundary>
  );
}
