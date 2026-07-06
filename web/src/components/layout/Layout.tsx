import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMockTelemetry } from '../../hooks/useMockTelemetry';
import { usePitwallWebSocket } from '../../hooks/usePitwallWebSocket';
import { useWebRTCDataChannel } from '../../hooks/useWebRTCDataChannel';
import { useTelemetryStore } from '../../store/telemetryStore';
import { getConnectionDetail, isConnectionFailure } from '../../utils/connectionStatus';
import { CockpitDashboard } from '../cockpit/CockpitDashboard';
import { PostRaceDebrief } from '../debrief/PostRaceDebrief';
import { QualifyingDashboard } from '../qualifying/QualifyingDashboard';
import { RaceArchiveDrawer } from '../races/RaceArchiveDrawer';
import type { RaceArchiveDataSource } from '../races/replayArchive';
import { RemoteConnect } from '../remote/RemoteConnect';
import { F1SetupManager } from '../setup/F1SetupManager';
import styles from './Layout.module.css';
import type { RaceListItem, RaceSummary, ReplayFrame, ReplayStreamMeta } from '../../types/telemetry';

type DashboardView = 'cockpit' | 'qualifying' | 'setup' | 'races';

const RACE_ARCHIVE_LIST_TIMEOUT_MS = 60_000;
const RACE_SUMMARY_TIMEOUT_MS = 60_000;
const RACE_REPLAY_TIMEOUT_MS = 120_000;

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

interface LayoutProps {
  /** When provided, "go home" actions return to the Hub surface instead of the
   * room picker (App.tsx switches surfaces). Absent → legacy standalone behavior. */
  onExitToHub?: () => void;
}

export function Layout({ onExitToHub }: LayoutProps = {}) {
  const initialRemoteOptions = useMemo(() => buildInitialRemoteOptions(), []);
  const [rtcOptions, setRtcOptions] = useState<RemoteRTCOptions | null>(initialRemoteOptions);
  const [connectAttempted, setConnectAttempted] = useState(initialRemoteOptions !== null);

  const setConnectionMode = useTelemetryStore((state) => state.setConnectionMode);
  const setConnectionState = useTelemetryStore((state) => state.setConnectionState);
  const setPitwallState = useTelemetryStore((state) => state.setPitwallState);
  const clearNotifications = useTelemetryStore((state) => state.clearNotifications);
  const clearRaceResult = useTelemetryStore((state) => state.clearRaceResult);
  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const raceResult = useTelemetryStore((state) => state.raceResult);
  const sessionType = useTelemetryStore((state) => state.pitwallState?.session?.sessionType ?? '');
  const isQualiSession = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i.test(sessionType);
  const showQualifying = isQualiSession;

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

  usePitwallWebSocket({ url: '' });
  useMockTelemetry(false);

  const webrtcOpts = useMemo(() => rtcOptions, [rtcOptions]);
  const {
    connectionState: rtcConnectionState,
    lastError: rtcLastError,
    sendView,
    request,
    stream,
    forceReconnect,
  } = useWebRTCDataChannel(webrtcOpts);

  const raceArchiveDataSource = useMemo<RaceArchiveDataSource>(() => ({
    listRaces: async (signal?: AbortSignal) => {
      const items: RaceListItem[] = [];

      await stream(
        { type: 'getRaceArchiveList' },
        {
          signal,
          timeoutMs: RACE_ARCHIVE_LIST_TIMEOUT_MS,
          doneType: 'raceArchiveListDone',
          onMessage: (response) => {
            if (response.type !== 'raceArchiveList') {
              return;
            }
            if (Array.isArray(response.data)) {
              items.push(...(response.data as RaceListItem[]));
              return;
            }
            const chunk = response.data as { items?: RaceListItem[] } | undefined;
            if (Array.isArray(chunk?.items)) {
              items.push(...chunk.items);
            }
          },
        },
      );

      return items;
    },
    loadSummary: (id: string, signal?: AbortSignal) => {
      return request<RaceSummary>(
        { type: 'getRaceSummary', data: { id } },
        { signal, timeoutMs: RACE_SUMMARY_TIMEOUT_MS },
      );
    },
    loadReplay: async (id: string, signal?: AbortSignal) => {
      let meta: ReplayStreamMeta | null = null;
      const frames: ReplayFrame[] = [];

      await stream(
        { type: 'getRaceReplay', data: { id } },
        {
          signal,
          timeoutMs: RACE_REPLAY_TIMEOUT_MS,
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
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
    // Bump the hook's nonce so reconnecting to the SAME room after a terminal
    // failure (auto-retries exhausted) still re-runs the connection effect.
    forceReconnect();
  }, [clearNotifications, clearRaceResult, forceReconnect, setConnectionState, setPitwallState]);

  const openRoomPicker = useCallback(() => {
    setRtcOptions(null);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
  }, [clearNotifications, clearRaceResult, setConnectionState, setPitwallState]);

  const goToMainScreen = useCallback(() => {
    clearRemoteQuery();
    setRtcOptions(null);
    setConnectAttempted(false);
    setConnectionState('disconnected');
    setPitwallState(null);
    clearNotifications();
    clearRaceResult();
    onExitToHub?.();
  }, [clearNotifications, clearRaceResult, setConnectionState, setPitwallState, onExitToHub]);

  // Setup manager runs independently — no .shell wrapper (it has overflow:hidden)
  if (dashboardView === 'setup') {
    return <F1SetupManager onBack={() => switchView('cockpit')} />;
  }

  if (!rtcOptions) {
    return (
      <RemoteConnect
        onConnect={handleRemoteConnect}
        connectionState={connectionState}
        onCancel={onExitToHub}
        cancelLabel={onExitToHub ? '홈' : undefined}
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
    connectionState !== 'reconnecting' &&
    (rtcConnectionState === 'failed' ||
      isConnectionFailure(connectionState) ||
      (connectAttempted && connectionState === 'disconnected' && rtcConnectionState !== 'new'))
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
          requestP2P={request}
          remoteAction={remoteAction}
          onSwitchToQualifying={showQualifying ? () => switchView('qualifying') : undefined}
          onSwitchToRaces={() => switchView('races')}
          onGoHome={goToMainScreen}
        />
      )}
      {dashboardView === 'races' ? (
        <RaceArchiveDrawer onClose={() => switchView('cockpit')} dataSource={raceArchiveDataSource} />
      ) : null}
      {raceResult ? <PostRaceDebrief result={raceResult} onClose={clearRaceResult} /> : null}
    </div>
  );
}
