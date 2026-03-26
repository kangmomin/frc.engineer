import { useEffect } from 'react';
import { buildMockFrame } from '../mock/mockData';
import { useTelemetryStore } from '../store/telemetryStore';

export function useMockTelemetry(enabled: boolean) {
  const setConnectionState = useTelemetryStore((state) => state.setConnectionState);
  const setPitwallState = useTelemetryStore((state) => state.setPitwallState);
  const setRaceControlNotifications = useTelemetryStore((state) => state.setRaceControlNotifications);
  const setBattleAlerts = useTelemetryStore((state) => state.setBattleAlerts);

  useEffect(() => {
    if (!enabled) return undefined;

    let tick = 0;

    const applyFrame = () => {
      const frame = buildMockFrame(tick++);
      setConnectionState('connected');
      setPitwallState(frame.pitwallState);
      setRaceControlNotifications(frame.raceControl);
      setBattleAlerts(frame.battleAlerts);
    };

    applyFrame();
    const intervalId = window.setInterval(applyFrame, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, setBattleAlerts, setConnectionState, setPitwallState, setRaceControlNotifications]);
}
