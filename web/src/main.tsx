import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './shell/AppShell';

// Phase 4 컷오버: 신규 shell이 기본값. 레거시 Layout 트리(App)는 제거됐다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
