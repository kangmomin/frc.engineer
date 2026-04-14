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
import { RaceArchiveDrawer } from '../races/RaceArchiveDrawer';
import type { RaceArchiveDataSource } from '../races/replayArchive';
import { RemoteConnect } from '../remote/RemoteConnect';
import { F1SetupManager } from '../setup/F1SetupManager';
import styles from './Layout.module.css';
import type { RaceListItem, ReplayFrame, ReplayStreamMeta } from '../../types/telemetry';

type DashboardView = 'cockpit' | 'qualifying' | 'setup' | 'races';

function readInitialView(): DashboardView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'qualifying') return 'qualifying';
  if (view === 'races') return 'races';
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
  roomId?: string;
  roomCode?: string;
  password: string;
}

function readRemoteQuery(): Partial<RemoteRTCOptions> {
  const params = new URLSearchParams(window.location.search);
  return {
    signalingUrl: params.get('signalingUrl') ?? '',
    roomId: params.get('roomId') ?? '',
    roomCode: params.get('roomCode') ?? '',
  };
}

function buildInitialRemoteOptions(): RemoteRTCOptions | null {
  const query = readRemoteQuery();

  if ((query.roomId || query.roomCode) && query.signalingUrl) {
    return {
      signalingUrl: query.signalingUrl,
      roomId: query.roomId,
      roomCode: query.roomCode,
      password: '',
    };
  }

  return null;
}

function persistRemoteSession(options: RemoteRTCOptions) {
  const params = new URLSearchParams(window.location.search);
  params.set('remote', '1');
  params.set('signalingUrl', options.signalingUrl);
  if (options.roomId) params.set('roomId', options.roomId);
  else params.delete('roomId');
  if (options.roomCode) params.set('roomCode', options.roomCode);
  else params.delete('roomCode');

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
  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const raceResult = useTelemetryStore((state) => state.raceResult);
  const viewQualifying = useTelemetryStore((state) => state.featurePermissions.viewQualifying);
  const setupSupport = useTelemetryStore((state) => state.featurePermissions.setupSupport);
  const sessionType = useTelemetryStore((state) => state.pitwallState?.session?.sessionType ?? '');
  const isQualiSession = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i.test(sessionType);
  const showQualifying = viewQualifying && isQualiSession;

  const [dashboardView, setDashboardView] = useState<DashboardView>(() => {
    return readInitialView();
  });

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
  const { connectionState: rtcConnectionState, lastError: rtcLastError, sendView, request, stream } = useWebRTCDataChannel(webrtcOpts);

  const raceArchiveDataSource = useMemo<RaceArchiveDataSource>(() => ({
    listRaces: (signal?: AbortSignal) =>
      request<RaceListItem[]>({ type: 'getRaceArchiveList' }, { signal }),
    loadReplay: async (id: string, signal?: AbortSignal) => {
      let meta: ReplayStreamMeta | null = null;
      const frames: ReplayFrame[] = [];

      await stream(
        { type: 'getRaceReplay', data: { id } },
        {
          signal,
          doneType: 'raceReplayDone',
          onMessage: (response) => {
            if (response.type === 'raceReplayMeta') {
              const nextMeta = response.data as Omit<ReplayStreamMeta, 'type'> & { type?: 'meta' };
              meta = { ...nextMeta, type: 'meta' };
              return;
            }
            if (response.type === 'raceReplayChunk') {
              const chunk = response.data as { frames?: ReplayFrame[] } | undefined;
              if (Array.isArray(chunk?.frames)) {
                frames.push(...chunk.frames);
              }
            }
          },
        },
      );

      return { meta, frames };
    },
  }), [request, stream]);

  const switchView = useCallback((view: DashboardView) => {
    if (dashboardView === 'races' && view !== 'races') {
      setPlaybackActive(false);
    }
    setDashboardView(view);
    persistView(view);
    sendView(view);
  }, [dashboardView, sendView, setPlaybackActive]);

  const handleRemoteConnect = useCallback((nextOptions: RemoteRTCOptions) => {
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
        initialRoomCode={readRemoteQuery().roomCode || ''}
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
        initialRoomCode={rtcOptions.roomCode}
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
          onSwitchToRaces={() => switchView('races')}
          onGoHome={goToMainScreen}
          remoteAction={remoteAction}
        />
      ) : (
        <CockpitDashboard
          onOpenSettings={() => {}}
          showSettingsButton={false}
          enableStrategyGuide={false}
          remoteAction={remoteAction}
          onSwitchToQualifying={showQualifying ? () => switchView('qualifying') : undefined}
          onSwitchToRaces={() => switchView('races')}
          onGoHome={goToMainScreen}
        />
      )}
      {dashboardView === 'races' ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={() => switchView('cockpit')}
            aria-label="Close race archive"
          />
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <span className={styles.drawerEyebrow}>Archive</span>
                <h2 className={styles.drawerTitle}>Race Replay</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => switchView('cockpit')}
              >
                Close
              </button>
            </div>
            <div className={styles.drawerBody}>
              <RaceArchiveDrawer onClose={() => switchView('cockpit')} dataSource={raceArchiveDataSource} />
            </div>
          </aside>
        </>
      ) : null}
      {raceResult ? <PostRaceDebrief result={raceResult} onClose={clearRaceResult} /> : null}
    </div>
  );
}
