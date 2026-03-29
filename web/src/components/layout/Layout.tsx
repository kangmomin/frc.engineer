import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import {
  NO_FEATURE_PERMISSIONS,
  useTelemetryStore,
} from '../../store/telemetryStore';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { RemoteConnect } from '../remote/RemoteConnect';
import styles from './Layout.module.css';

const REMOTE_SESSION_KEY = 'frc_remote_session';

interface RemoteRTCOptions {
  signalingUrl: string;
  roomId: string;
  password: string;
  permissionsCode: string;
}

function readRemoteQuery(): Partial<RemoteRTCOptions> {
  const params = new URLSearchParams(window.location.search);
  return {
    signalingUrl: params.get('signalingUrl') ?? '',
    roomId: params.get('roomId') ?? '',
  };
}

function readStoredRemoteSession(): RemoteRTCOptions | null {
  try {
    const raw = window.sessionStorage.getItem(REMOTE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteRTCOptions;
    if (!parsed.roomId || !parsed.signalingUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildInitialRemoteOptions(): RemoteRTCOptions | null {
  const query = readRemoteQuery();
  const stored = readStoredRemoteSession();

  if (stored && stored.roomId === query.roomId) {
    return {
      ...stored,
      signalingUrl: query.signalingUrl || stored.signalingUrl,
    };
  }

  if (query.roomId && query.signalingUrl) {
    return {
      signalingUrl: query.signalingUrl,
      roomId: query.roomId,
      password: '',
      permissionsCode: '',
    };
  }

  return stored;
}

function persistRemoteSession(options: RemoteRTCOptions) {
  window.sessionStorage.setItem(REMOTE_SESSION_KEY, JSON.stringify(options));

  const params = new URLSearchParams(window.location.search);
  params.set('remote', '1');
  params.set('roomId', options.roomId);
  params.set('signalingUrl', options.signalingUrl);

  const nextQuery = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
}

export function Layout() {
  const initialRemoteOptions = useMemo(() => buildInitialRemoteOptions(), []);
  const [rtcOptions, setRtcOptions] = useState<RemoteRTCOptions | null>(initialRemoteOptions);
  const [connectAttempted, setConnectAttempted] = useState(initialRemoteOptions !== null);

  const setConnectionMode = useTelemetryStore((state) => state.setConnectionMode);
  const setConnectionState = useTelemetryStore((state) => state.setConnectionState);
  const setFeaturePermissions = useTelemetryStore((state) => state.setFeaturePermissions);
  const setPitwallState = useTelemetryStore((state) => state.setPitwallState);
  const clearNotifications = useTelemetryStore((state) => state.clearNotifications);
  const clearRaceResult = useTelemetryStore((state) => state.clearRaceResult);
  const connectionState = useTelemetryStore((state) => state.connectionState);

  useEffect(() => {
    setConnectionMode('remote');
  }, [setConnectionMode]);

  useEffect(() => {
    if (!rtcOptions) {
      setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    }
  }, [rtcOptions, setFeaturePermissions]);

  usePitwallWebSocket({ url: '' });
  useMockTelemetry(false);

  const webrtcOpts = useMemo(() => rtcOptions, [rtcOptions]);
  const { connectionState: rtcConnectionState } = useWebRTCDataChannel(webrtcOpts);

  const handleRemoteConnect = useCallback((
    signalingUrl: string,
    roomId: string,
    password: string,
    permissionsCode: string,
  ) => {
    const nextOptions = { signalingUrl, roomId, password, permissionsCode };
    persistRemoteSession(nextOptions);
    setRtcOptions(nextOptions);
    setConnectAttempted(true);
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
  }, [clearNotifications, clearRaceResult, setConnectionState, setFeaturePermissions, setPitwallState]);

  const openRoomPicker = useCallback(() => {
    setRtcOptions(null);
    setFeaturePermissions(NO_FEATURE_PERMISSIONS);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
  }, [clearNotifications, clearRaceResult, setConnectionState, setFeaturePermissions, setPitwallState]);

  if (!rtcOptions) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
        title="P2P Telemetry Link"
        subtitle="Pick an active sender room from the signaling server, then enter its password to join."
        initialSignalingUrl={readRemoteQuery().signalingUrl || readStoredRemoteSession()?.signalingUrl || ''}
        initialRoomId={readRemoteQuery().roomId || readStoredRemoteSession()?.roomId || ''}
        initialPassword={readStoredRemoteSession()?.password || ''}
        initialPermissionsCode={readStoredRemoteSession()?.permissionsCode || ''}
      />
    );
  }

  if (
    rtcConnectionState === 'failed' ||
    connectionState === 'error' ||
    (connectAttempted && connectionState === 'disconnected' && rtcConnectionState !== 'new')
  ) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState="error"
        title="P2P Telemetry Link"
        subtitle="Connection dropped. Pick the room again and retry."
        initialSignalingUrl={rtcOptions.signalingUrl}
        initialRoomId={rtcOptions.roomId}
        initialPassword={rtcOptions.password}
        initialPermissionsCode={rtcOptions.permissionsCode}
      />
    );
  }

  return (
    <div className={styles.shell}>
      <CockpitDashboard
        onOpenSettings={() => {}}
        showSettingsButton={false}
        remoteAction={{
          label: 'Rooms',
          onClick: openRoomPicker,
          active: true,
        }}
      />
    </div>
  );
}
