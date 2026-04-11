import { useEffect, useRef } from 'react';
import type { PitwallState } from '../types/telemetry';
import { buildMockMessages } from '../mock/mockData';
import { useTelemetryStore } from '../store/telemetryStore';
import { routeMessage } from './useMessageRouter';

export function useMockTelemetry(enabled: boolean) {
  const setConnectionState = useTelemetryStore((state) => state.setConnectionState);
  const setPitwallState = useTelemetryStore((state) => state.setPitwallState);
  const addRaceControlNotification = useTelemetryStore((state) => state.addRaceControlNotification);
  const setRaceResult = useTelemetryStore((state) => state.setRaceResult);

  const pendingPitwallRef = useRef<PitwallState | null>(null);
  const pitwallRafRef = useRef(0);
  const pendingPositionsRef = useRef<import('../types/telemetry').CarPosition[] | null>(null);
  const positionsRafRef = useRef(0);
  const raceControlSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    let tick = 0;

    const applyFrame = () => {
      setConnectionState('connected');

      const messages = buildMockMessages(tick++);
      for (const message of messages) {
        routeMessage(
          message,
          { setPitwallState, updatePositions: () => {}, addRaceControlNotification, setRaceResult },
          {
            pendingPitwall: pendingPitwallRef,
            pitwallRaf: pitwallRafRef,
            pendingPositions: pendingPositionsRef,
            positionsRaf: positionsRafRef,
            rcSeq: raceControlSeqRef,
          },
        );
      }
    };

    applyFrame();
    const intervalId = window.setInterval(applyFrame, 250);

    return () => {
      window.clearInterval(intervalId);
      pendingPitwallRef.current = null;
      if (pitwallRafRef.current) {
        cancelAnimationFrame(pitwallRafRef.current);
        pitwallRafRef.current = 0;
      }
    };
  }, [addRaceControlNotification, enabled, setConnectionState, setPitwallState, setRaceResult]);
}
