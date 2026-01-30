import { Layout } from './components/layout/Layout';
import { BattleAlertModal } from './components/notification/BattleAlertModal';
import { NotificationOverlay } from './components/notification/NotificationOverlay';
import { useTelemetry } from './hooks/useTelemetry';
import './styles/theme.css';

function App() {
  const { data, connectionState, reconnect, lapData, requestLapData, pitwallState, notifications, battleAlert, dismissBattle } = useTelemetry();

  return (
    <>
      <NotificationOverlay notifications={notifications} />
      <BattleAlertModal alert={battleAlert} onDismiss={dismissBattle} />
      <Layout
        data={data}
        connectionState={connectionState}
        onReconnect={reconnect}
        lapData={lapData}
        requestLapData={requestLapData}
        pitwallState={pitwallState}
      />
    </>
  );
}

export default App;
