import { useState } from 'react';
import { HubApp } from './hub/HubApp';
import { AppShell } from './shell/AppShell';
import './styles/theme.css';
import { getViewAsToken } from './hub/data/session';

type Surface = 'hub' | 'telemetry';

// The telemetry viewer is entered via deep-link params (backward-compatible) or
// from the Hub's "LIVE" launch; otherwise the Hub is the default home surface.
// 텔레메트리 서피스는 재구축된 AppShell(Broadcast/PitWall/Qualifying)이다 — legacy Layout 대체.
// ?mock도 텔레메트리 검증용 딥링크이므로 telemetry로 라우팅한다.
function initialSurface(): Surface {
  // A tab carrying a View As child may not deep-link into local telemetry.
  if (getViewAsToken()) return 'hub';
  const p = new URLSearchParams(window.location.search);
  if (p.has('remote') || p.has('roomId') || p.has('roomCode') || p.has('signalingUrl') || p.has('view') || p.has('mock')) {
    return 'telemetry';
  }
  return 'hub';
}

function App() {
  const [surface, setSurface] = useState<Surface>(initialSurface);

  if (surface === 'telemetry') {
    return <AppShell onExitToHub={() => setSurface('hub')} />;
  }
  return <HubApp onLaunchLive={() => setSurface('telemetry')} />;
}

export default App;
