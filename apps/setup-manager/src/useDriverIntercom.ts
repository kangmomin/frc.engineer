import { useEffect, useMemo, useRef, useState } from 'react';
import { IntercomRuntime, type IntercomRuntimeState } from '../../../shared/intercom';
import { DriverIntercomBridge } from './intercomBridge';

export function useDriverIntercom() {
  const bridgeRef = useRef<DriverIntercomBridge | null>(null);
  if (!bridgeRef.current) bridgeRef.current = new DriverIntercomBridge();
  const runtimeRef = useRef<IntercomRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new IntercomRuntime();
  const bridge = bridgeRef.current;
  const runtime = runtimeRef.current;
  const [state, setState] = useState<IntercomRuntimeState>(runtime.getState());
  const [bridgeRevision, setBridgeRevision] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adapter = useMemo(() => bridge.adapter(), [bridge, bridgeRevision]);

  useEffect(() => runtime.subscribe(setState), [runtime]);
  useEffect(() => bridge.subscribeState(() => setBridgeRevision((value) => value + 1)), [bridge]);
  useEffect(() => {
    runtime.setTransport(adapter);
  }, [adapter, runtime]);
  useEffect(() => {
    if (destroyTimerRef.current) clearTimeout(destroyTimerRef.current);
    destroyTimerRef.current = null;
    runtime.setSurfaceActive(true);
    void bridge.start();
    return () => {
      runtime.setSurfaceActive(false);
      destroyTimerRef.current = setTimeout(() => {
        runtime.close();
        bridge.close();
      }, 0);
    };
  }, [bridge, runtime]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices?.enumerateDevices().then((all) => {
        if (active) setDevices(all.filter((device) => device.kind === 'audioinput'));
      }).catch(() => {});
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, [state.mediaStatus]);

  return { runtime, state, devices };
}
