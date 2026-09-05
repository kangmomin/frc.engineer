import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isIntercomTransportReady, type IntercomSignalingAdapter } from '../intercom/core';
import { PostRaceDebrief } from '../components/debrief/PostRaceDebrief';
import { RaceArchiveDrawer } from '../components/races/RaceArchiveDrawer';
import type { RaceArchiveDataSource } from '../components/races/replayArchive';
import { RemoteConnect } from '../components/remote/RemoteConnect';
import { IntercomDock } from '../components/intercom/IntercomDock';
import { F1SetupManager } from '../components/setup/F1SetupManager';
import { useMockTelemetry } from '../hooks/useMockTelemetry';
import { useWebRTCDataChannel } from '../hooks/useWebRTCDataChannel';
import { isMockMode, mockScenario } from '../runtimeFlags';
import { startLapHistoryTracker } from '../store/lapHistoryStore';
import { startRaceMetaTracker } from '../store/raceMetaStore';
import { useTelemetryStore } from '../store/telemetryStore';
import type {
  RaceListItem,
  RaceSummary,
  ReplayFrame,
  ReplayStreamMeta,
} from '../types/telemetry';
import { getConnectionDetail, isConnectionFailure } from '../utils/connectionStatus';
import { BroadcastView } from '../views/broadcast/BroadcastView';
import { PitWallView } from '../views/pitwall/PitWallView';
import type { RequestFn } from '../views/pitwall/useStrategyGuide';
import { QualifyingView } from '../views/qualifying/QualifyingView';
import '../styles/theme.css';
import { Stage } from './Stage';
import type { ShellControls } from './types';
import { persistView, readInitialView, viewToSenderView, type ViewId } from './viewNav';

const RACE_ARCHIVE_LIST_TIMEOUT_MS = 60_000;
const RACE_SUMMARY_TIMEOUT_MS = 60_000;
const RACE_REPLAY_TIMEOUT_MS = 120_000;

const QUALI_SESSION_RE = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i;

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

interface AppShellProps {
  /** When provided, "go home" actions return to the Hub surface instead of the
   * room picker (App.tsx switches surfaces). Absent → legacy standalone behavior. */
  onExitToHub?: () => void;
}

function AppShellWithIntercom({ transport, children }: { transport: IntercomSignalingAdapter; children: ReactNode }) {
  return (
    <>
      {children}
      <div hidden={!isIntercomTransportReady(transport)}>
        <IntercomDock transport={transport} />
      </div>
    </>
  );
}

export function AppShell({ onExitToHub }: AppShellProps = {}) {
  const mock = isMockMode;

  const initialRemoteOptions = useMemo(() => buildInitialRemoteOptions(), []);
  const [rtcOptions, setRtcOptions] = useState<RemoteRTCOptions | null>(initialRemoteOptions);
  const [connectAttempted, setConnectAttempted] = useState(initialRemoteOptions !== null);
  const [view, setView] = useState<ViewId>(() => readInitialView());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const setConnectionMode = useTelemetryStore((s) => s.setConnectionMode);
  const clearRaceResult = useTelemetryStore((s) => s.clearRaceResult);
  const connectionState = useTelemetryStore((s) => s.connectionState);
  const raceResult = useTelemetryStore((s) => s.raceResult);
  const sessionType = useTelemetryStore((s) => s.pitwallState?.session?.sessionType ?? '');
  const isQualiSession = QUALI_SESSION_RE.test(sessionType);

  // 그리드/노티 lap 추적 + 랩 히스토리 축적 — 뷰보다 상위, 앱 수명 1회 구독.
  // 순서 고정: raceMetaTracker가 먼저 epoch를 갱신해야 lapHistory의 sessionKey 리셋이 성립한다.
  useEffect(() => {
    startRaceMetaTracker();
    startLapHistoryTracker();
  }, []);

  useEffect(() => {
    setConnectionMode('remote');
  }, [setConnectionMode]);

  useEffect(() => {
    window.sessionStorage.removeItem('frc_remote_session');
    window.sessionStorage.removeItem('frc_signaling_url');
    window.localStorage.removeItem('frc_signaling_url');
  }, []);

  // dev mock 피드 (?mock=1 race / ?mock=quali) — connected 상태로 스토어를 채운다
  useMockTelemetry(mock, mockScenario);

  const webrtcOpts = useMemo(() => rtcOptions, [rtcOptions]);
  const {
    connectionState: rtcConnectionState,
    lastError: rtcLastError,
    sendView,
    request,
    stream,
    disconnect,
    forceReconnect,
    intercom,
  } = useWebRTCDataChannel(webrtcOpts);

  // 재연결 후 'connected' 전이마다 현재 뷰 재전송 (peerView 는 재연결 시 cockpit 으로 리셋됨)
  const sendViewRef = useRef(sendView);
  sendViewRef.current = sendView;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (connectionState === 'connected') {
      sendViewRef.current(viewToSenderView(viewRef.current));
    }
  }, [connectionState]);

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
            if (response.type !== 'raceArchiveList') return;
            if (Array.isArray(response.data)) {
              items.push(...(response.data as RaceListItem[]));
              return;
            }
            const chunk = response.data as { items?: RaceListItem[] } | undefined;
            if (Array.isArray(chunk?.items)) items.push(...chunk.items);
          },
        },
      );
      return items;
    },
    loadSummary: (id: string, signal?: AbortSignal) =>
      request<RaceSummary>({ type: 'getRaceSummary', data: { id } }, { signal, timeoutMs: RACE_SUMMARY_TIMEOUT_MS }),
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
              if (Array.isArray(chunk?.frames)) frames.push(...chunk.frames);
            }
          },
        },
      );
      return { meta, frames };
    },
  }), [request, stream]);

  const switchView = useCallback((next: ViewId) => {
    setView(next);
    persistView(next);
    sendView(viewToSenderView(next));
  }, [sendView]);

  const handleRemoteConnect = useCallback((nextOptions: RemoteRTCOptions) => {
    disconnect();
    persistRemoteSession(nextOptions);
    setRtcOptions(nextOptions);
    setConnectAttempted(true);
    forceReconnect();
  }, [disconnect, forceReconnect]);

  const openRoomPicker = useCallback(() => {
    disconnect();
    setRtcOptions(null);
  }, [disconnect]);

  const goToMainScreen = useCallback(() => {
    disconnect();
    clearRemoteQuery();
    setRtcOptions(null);
    setConnectAttempted(false);
    onExitToHub?.();
  }, [disconnect, onExitToHub]);

  const controls: ShellControls = {
    view,
    onNavigate: switchView,
    onOpenRooms: openRoomPicker,
    onOpenArchive: () => setArchiveOpen(true),
    onOpenSetup: () => setSetupOpen(true),
    onGoHome: goToMainScreen,
    // 대기 화면 수동 재연결 — nonce 갱신으로 메인 연결 effect가 재실행되어
    // 시그널링+PC를 처음부터 다시 수립한다(백오프 대기도 즉시 건너뜀).
    onReconnect: forceReconnect,
    navDisabled: { qualifying: !isQualiSession },
    roomsActive: true,
  };

  // 세팅 매니저는 전체 화면 대체 (overflow:hidden 독립 실행)
  if (setupOpen) {
    return (
      <AppShellWithIntercom transport={intercom}>
        <F1SetupManager onBack={() => setSetupOpen(false)} />
      </AppShellWithIntercom>
    );
  }

  // 라이브 모드 게이팅 (mock 모드는 건너뜀)
  if (!mock && !rtcOptions) {
    return (
      <AppShellWithIntercom transport={intercom}>
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
      </AppShellWithIntercom>
    );
  }

  if (
    !mock &&
    rtcOptions &&
    connectionState !== 'reconnecting' &&
    (rtcConnectionState === 'failed' ||
      isConnectionFailure(connectionState) ||
      (connectAttempted && connectionState === 'disconnected' && rtcConnectionState !== 'new'))
  ) {
    return (
      <AppShellWithIntercom transport={intercom}>
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
      </AppShellWithIntercom>
    );
  }

  return (
    <AppShellWithIntercom transport={intercom}>
      <>
        <Stage>{renderView(controls, request)}</Stage>
        {archiveOpen ? (
          <RaceArchiveDrawer onClose={() => setArchiveOpen(false)} dataSource={raceArchiveDataSource} />
        ) : null}
        {raceResult ? <PostRaceDebrief result={raceResult} onClose={clearRaceResult} /> : null}
      </>
    </AppShellWithIntercom>
  );
}

function renderView(controls: ShellControls, request: RequestFn) {
  // Phase 1~3에서 각 뷰를 실제 구현으로 교체 완료(Broadcast/PitWall/Qualifying).
  switch (controls.view) {
    case 'broadcast':
      return <BroadcastView controls={controls} />;
    case 'pitwall':
      return <PitWallView controls={controls} request={request} />;
    case 'qualifying':
      return <QualifyingView controls={controls} />;
  }
}
