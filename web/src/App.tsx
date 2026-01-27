import { Layout } from './components/layout/Layout';
import { useTelemetry } from './hooks/useTelemetry';
import './styles/theme.css';

function App() {
  const { data, connectionState, reconnect, lapData, requestLapData, pitwallState } = useTelemetry();

  return (
    <Layout
      data={data}
      connectionState={connectionState}
      onReconnect={reconnect}
      lapData={lapData}
      requestLapData={requestLapData}
      pitwallState={pitwallState}
    />
  );
}

export default App;
