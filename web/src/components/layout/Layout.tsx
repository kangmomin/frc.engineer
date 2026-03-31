import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import {
  NO_FEATURE_PERMISSIONS,
  useTelemetryStore,
} from '../../store/telemetryStore';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { CommentaryDashboard } from '../commentary/CommentaryDashboard';
import { QualifyingDashboard } from '../qualifying/QualifyingDashboard';
import { RemoteConnect } from '../remote/RemoteConnect';
import styles from './Layout.module.css';

type DashboardView = 'cockpit' | 'commentary' | 'qualifying';

function readInitialView(): DashboardView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'commentary') return 'commentary';
  if (view === 'qualifying') return 'qualifying';
  return 'cockpit';
}

function persistView(view: DashboardView) {
  const params = new URLSearchParams(window.location.search);
  if (view === 'cockpit') params.delete('view');
  else params.set('view', view);
  const nextQuery = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
}

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

function buildInitialRemoteOptions(): RemoteRTCOptions | null {
  const query = readRemoteQuery();

  if (query.roomId && query.signalingUrl) {
    return {
      signalingUrl: query.signalingUrl,
      roomId: query.roomId,
      password: '',
      permissionsCode: '',
    };
  }

  return null;
}

function persistRemoteSession(options: RemoteRTCOptions) {
  const params = new URLSearchParams(window.location.search);
  params.set('remote', '1');
  params.set('roomId', options.roomId);
  params.set('signalingUrl', options.signalingUrl);

  const nextQuery = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
}

function clearRemoteQuery() {
  window.history.replaceState(null, '', window.location.pathname);
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
  const viewCommentary = useTelemetryStore((state) => state.featurePermissions.viewCommentary);
  const viewQualifying = useTelemetryStore((state) => state.featurePermissions.viewQualifying);

  const [dashboardView, setDashboardView] = useState<DashboardView>(readInitialView);

  const switchView = useCallback((view: DashboardView) => {
    setDashboardView(view);
    persistView(view);
  }, []);

  useEffect(() => {
    window.sessionStorage.removeItem('frc_remote_session');
    window.sessionStorage.removeItem('frc_signaling_url');
    window.localStorage.removeItem('frc_signaling_url');
  }, []);

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
  const { connectionState: rtcConnectionState, lastError: rtcLastError } = useWebRTCDataChannel(webrtcOpts);

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

  const goToMainScreen = useCallback(() => {
    clearRemoteQuery();
    setRtcOptions(null);
    setConnectAttempted(false);
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
        initialSignalingUrl={readRemoteQuery().signalingUrl || ''}
        initialRoomId={readRemoteQuery().roomId || ''}
        initialPassword=""
        initialPermissionsCode=""
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
        onCancel={goToMainScreen}
        cancelLabel="Main Screen"
        title="P2P Telemetry Link"
        subtitle={rtcLastError || 'Connection dropped. Pick the room again and retry.'}
        initialSignalingUrl={rtcOptions.signalingUrl}
        initialRoomId={rtcOptions.roomId}
        initialPassword={rtcOptions.password}
        initialPermissionsCode={rtcOptions.permissionsCode}
      />
    );
  }

  const remoteAction = { label: 'Rooms', onClick: openRoomPicker, active: true };

  return (
    <div className={styles.shell}>
      {dashboardView === 'qualifying' && viewQualifying ? (
        <QualifyingDashboard
          onSwitchToCockpit={() => switchView('cockpit')}
          onSwitchToCommentary={viewCommentary ? () => switchView('commentary') : undefined}
          onGoHome={goToMainScreen}
          remoteAction={remoteAction}
        />
      ) : dashboardView === 'commentary' && viewCommentary ? (
        <CommentaryDashboard
          onSwitchToCockpit={() => switchView('cockpit')}
          onSwitchToQualifying={viewQualifying ? () => switchView('qualifying') : undefined}
          onGoHome={goToMainScreen}
          remoteAction={remoteAction}
        />
      ) : (
        <CockpitDashboard
          onOpenSettings={() => {}}
          showSettingsButton={false}
          remoteAction={remoteAction}
          onSwitchToCommentary={viewCommentary ? () => switchView('commentary') : undefined}
          onSwitchToQualifying={viewQualifying ? () => switchView('qualifying') : undefined}
          onGoHome={goToMainScreen}
        />
      )}
    </div>
  );
}
