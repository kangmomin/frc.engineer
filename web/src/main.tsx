import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppShell } from './shell/AppShell';

// Strangler: ?next=1 로 신규 shell 전체를 렌더, 그 외에는 레거시 Layout 유지.
// 두 트리를 동시에 렌더하지 않는다 (useWebRTCDataChannel 2중 연결 방지).
const useNextShell = new URLSearchParams(window.location.search).get('next') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{useNextShell ? <AppShell /> : <App />}</StrictMode>
);
