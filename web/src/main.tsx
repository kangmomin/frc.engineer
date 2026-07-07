import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// App = Hub(기본 홈) ↔ 텔레메트리(재구축 AppShell) 서피스 스위처.
// 딥링크(?view/?roomCode/?mock 등)는 App.initialSurface가 텔레메트리로 라우팅한다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
