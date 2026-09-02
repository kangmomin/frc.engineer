import { useEffect, useRef, useState } from 'react';
import {
  IntercomRuntime,
  bindPTTReleaseGuards,
  isPTTKeyDown,
  type IntercomRuntimeState,
  type IntercomSignalingAdapter,
} from '../../../shared/intercom';

export function useEngineerIntercom(transport: IntercomSignalingAdapter) {
  const runtimeRef = useRef<IntercomRuntime>();
  if (!runtimeRef.current) runtimeRef.current = new IntercomRuntime();
  const runtime = runtimeRef.current;
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<IntercomRuntimeState>(runtime.getState());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => runtime.subscribe(setState), [runtime]);
  useEffect(() => {
    runtime.setTransport(transport);
  }, [runtime, transport]);
  useEffect(() => {
    if (destroyTimerRef.current) clearTimeout(destroyTimerRef.current);
    destroyTimerRef.current = null;
    runtime.setSurfaceActive(true);
    return () => {
      runtime.setSurfaceActive(false);
      destroyTimerRef.current = setTimeout(() => runtime.close(), 0);
    };
  }, [runtime]);

  useEffect(() => {
    const syncVisibility = () => runtime.setSurfaceActive(document.visibilityState === 'visible');
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, [runtime]);

  useEffect(() => {
    const release = () => runtime.setPTT(false);
    const unbindRelease = bindPTTReleaseGuards(release);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPTTKeyDown(event)) return;
      event.preventDefault();
      runtime.setPTT(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      unbindRelease();
    };
  }, [runtime]);

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
