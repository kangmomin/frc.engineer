import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import {
  NO_FEATURE_PERMISSIONS,
  useTelemetryStore,
} from '../../store/telemetryStore';
import { getConnectionDetail, isConnectionFailure } from '../../utils/connectionStatus';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { PostRaceDebrief } from '../debrief/PostRaceDebrief';
import { QualifyingDashboard } from '../qualifying/QualifyingDashboard';
import { RemoteConnect } from '../remote/RemoteConnect';
import { F1SetupManager } from '../setup/F1SetupManager';
import styles from './Layout.module.css';

type DashboardView = 'cockpit' | 'qualifying' | 'setup';

function readInitialView(): DashboardView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'qualifying') return 'qualifying';
  if (view === 'setup') return 'setup';
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
  const raceResult = useTelemetryStore((state) => state.raceResult);
  const viewQualifying = useTelemetryStore((state) => state.featurePermissions.viewQualifying);
  const setupSupport = useTelemetryStore((state) => state.featurePermissions.setupSupport);
  const sessionType = useTelemetryStore((state) => state.pitwallState?.session?.sessionType ?? '');
  const isQualiSession = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i.test(sessionType);
  const showQualifying = viewQualifying && isQualiSession;

  const [dashboardView, setDashboardView] = useState<DashboardView>(readInitialView);

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
  const { connectionState: rtcConnectionState, lastError: rtcLastError, sendView } = useWebRTCDataChannel(webrtcOpts);

  const switchView = useCallback((view: DashboardView) => {
    setDashboardView(view);
    persistView(view);
    sendView(view);
  }, [sendView]);

  const handleRemoteConnect = useCallback((
    signalingUrl: string,
    roomId: string,
    password: string,
  ) => {
    const nextOptions = { signalingUrl, roomId, password };
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

  // Setup manager runs independently — no .shell wrapper (it has overflow:hidden)
  if (dashboardView === 'setup') {
    if (!setupSupport) {
      switchView('cockpit');
      return null;
    }
    return <F1SetupManager onBack={() => switchView('cockpit')} />;
  }

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
      />
    );
  }

  if (
    rtcConnectionState === 'failed' ||
    isConnectionFailure(connectionState) ||
    (connectAttempted && connectionState === 'disconnected' && rtcConnectionState !== 'new')
  ) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
        onCancel={goToMainScreen}
        cancelLabel="Main Screen"
        title="P2P Telemetry Link"
        subtitle={rtcLastError || getConnectionDetail(connectionState)}
        initialSignalingUrl={rtcOptions.signalingUrl}
        initialRoomId={rtcOptions.roomId}
        initialPassword={rtcOptions.password}
      />
    );
  }

  const remoteAction = { label: 'Rooms', onClick: openRoomPicker, active: true };

  return (
    <div className={styles.shell}>
      {dashboardView === 'qualifying' && showQualifying ? (
        <QualifyingDashboard
          onSwitchToCockpit={() => switchView('cockpit')}
          onGoHome={goToMainScreen}
          remoteAction={remoteAction}
        />
      ) : (
        <CockpitDashboard
          onOpenSettings={() => {}}
          showSettingsButton={false}
          remoteAction={remoteAction}
          onSwitchToQualifying={showQualifying ? () => switchView('qualifying') : undefined}
          onGoHome={goToMainScreen}
        />
      )}
      {raceResult ? <PostRaceDebrief result={raceResult} onClose={clearRaceResult} /> : null}
    </div>
  );
}
