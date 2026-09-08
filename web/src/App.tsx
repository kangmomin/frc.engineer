import { lazy, useEffect, useState } from 'react';
import { ScreenBoundary } from './components/ScreenBoundary';
import './styles/theme.css';
import { getViewAsToken } from './hub/data/session';

const HubApp = lazy(() => import('./hub/HubApp').then(module => ({ default: module.HubApp })));
const AppShell = lazy(() => import('./shell/AppShell').then(module => ({ default: module.AppShell })));
const SharedRaceAnalysis = lazy(() => import('./hub/screens/SharedRaceAnalysis').then(module => ({ default: module.SharedRaceAnalysis })));

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
  const [shareToken, setShareToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('raceShare'));

  useEffect(() => {
    const update = () => setShareToken(new URLSearchParams(window.location.hash.slice(1)).get('raceShare'));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  if (shareToken !== null) return <ScreenBoundary resetKey={shareToken}><SharedRaceAnalysis key={shareToken} token={shareToken} /></ScreenBoundary>;

  return (
    <ScreenBoundary resetKey={surface} onBack={surface === 'telemetry' ? () => setSurface('hub') : undefined}>
      {surface === 'telemetry'
        ? <AppShell onExitToHub={() => setSurface('hub')} />
        : <HubApp onLaunchLive={() => setSurface('telemetry')} />}
    </ScreenBoundary>
  );
}

export default App;
