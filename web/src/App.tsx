import { useState } from 'react';
import { Layout } from './components/layout/Layout';
import { HubApp } from './hub/HubApp';
import './styles/theme.css';

type Surface = 'hub' | 'telemetry';

// The telemetry viewer is entered via deep-link params (backward-compatible) or
// from the Hub's "LIVE" launch; otherwise the Hub is the default home surface.
function initialSurface(): Surface {
  const p = new URLSearchParams(window.location.search);
  if (p.has('remote') || p.has('roomId') || p.has('roomCode') || p.has('signalingUrl') || p.has('view')) {
    return 'telemetry';
  }
  return 'hub';
}

function App() {
  const [surface, setSurface] = useState<Surface>(initialSurface);

  if (surface === 'telemetry') {
    return <Layout onExitToHub={() => setSurface('hub')} />;
  }
  return <HubApp onLaunchLive={() => setSurface('telemetry')} />;
}

export default App;
