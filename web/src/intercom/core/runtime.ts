import { ActivityLease, VoiceActivityDetector } from './activity';
import {
  computeSourceGates,
  isPrivateReadyRequired,
  isSnapshotNewer,
} from './gates';
import {
  INTERCOM_VERSION,
  parseServerIntercomEnvelope,
  type IntercomErrorPayload,
  type IntercomJoinedPayload,
  type IntercomRole,
  type IntercomSnapshot,
  type ServerIntercomEnvelope,
} from './protocol';
import { SFUAudioController } from './sfu';
import { IntercomRPCClient, IntercomRPCError, isIntercomTransportReady, type IntercomSignalingAdapter } from './transport';

export type IntercomRuntimeStatus = 'unavailable' | 'ready' | 'joining' | 'joined' | 'reconnecting';
export type IntercomMediaStatus = 'idle' | 'connecting' | 'connected' | 'failed';
export type IntercomMicrophoneStatus = 'idle' | 'requesting' | 'live' | 'denied';

export interface IntercomRuntimeState {
  status: IntercomRuntimeStatus;
  mediaStatus: IntercomMediaStatus;
  microphoneStatus: IntercomMicrophoneStatus;
  role: IntercomRole | null;
  participantId: string;
  groupCode: string;
  chiefCode?: string;
  snapshot: IntercomSnapshot | null;
  busEnabled: boolean;
  ptt: boolean;
  locallyMuted: boolean;
  autoplayBlocked: boolean;
  error: string;
}

interface JoinCredentials {
  groupCode: string;
  password: string;
  chiefCode?: string;
  role: IntercomRole;
  displayName: string;
}

const INITIAL_STATE: IntercomRuntimeState = {
  status: 'unavailable',
  mediaStatus: 'idle',
  microphoneStatus: 'idle',
  role: null,
  participantId: '',
  groupCode: '',
  snapshot: null,
  busEnabled: true,
  ptt: false,
  locallyMuted: false,
  autoplayBlocked: false,
  error: '',
};

export class IntercomRuntime {
  private state: IntercomRuntimeState = { ...INITIAL_STATE };
  private listeners = new Set<(state: IntercomRuntimeState) => void>();
  private adapter: IntercomSignalingAdapter | null = null;
  private adapterUnsubscribe: (() => void) | null = null;
  private adapterInvalidationUnsubscribe: (() => void) | null = null;
  private readonly rpc = new IntercomRPCClient();
  private readonly audio = new SFUAudioController(this.rpc);
  private readonly activity = new ActivityLease((activity) => this.rpc.notify('intercom_activity', { ...activity }));
  private readonly vad = new VoiceActivityDetector();
  private joined: IntercomJoinedPayload | null = null;
  private credentials: JoinCredentials | null = null;
  private resumeToken = '';
  private transportGeneration = -1;
  private adapterGeneration = -1;
  private adapterReady = false;
  private acknowledgedPrivateRevision = -1;
  private mediaOperation = 0;
  private membershipOperation = 0;
  private acceptUnsolicitedJoin = true;
  private deviceId = '';
  private chiefTargetSignature = '';
  private microphoneLive = false;
  private currentInputTrack: MediaStreamTrack | null = null;
  private vadRunning = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private surfaceActive = true;
  private brokerRebuildAttempted = false;
  private privateReadyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.audio.onStateChange((status, error) => {
      const mediaStatus: IntercomMediaStatus = status === 'failed' ? 'failed' : status;
      this.setState({ mediaStatus, ...(error ? { error } : {}) });
      this.applyGates();
    });
    this.audio.remoteAudio.onAutoplayChange((blocked) => this.setState({ autoplayBlocked: blocked }));
  }

  getState = (): IntercomRuntimeState => this.state;

  subscribe = (listener: (state: IntercomRuntimeState) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  };

  setTransport(adapter: IntercomSignalingAdapter | null): void {
    const previousGeneration = this.adapterGeneration;
    const previousReady = this.adapterReady;
    this.adapterUnsubscribe?.();
    this.adapterUnsubscribe = null;
    this.adapterInvalidationUnsubscribe?.();
    this.adapterInvalidationUnsubscribe = null;
    this.adapter = adapter;
    this.adapterGeneration = adapter?.generation ?? -1;
    this.rpc.setAdapter(adapter);
    if (adapter) {
      this.adapterUnsubscribe = adapter.subscribeIntercom((message) => this.onMessage(message));
      this.adapterInvalidationUnsubscribe = adapter.subscribeInvalidation?.(() => {
        if (this.adapter === adapter) this.onTransportInvalidated();
      }) ?? null;
    }
    const ready = isIntercomTransportReady(adapter);
    this.adapterReady = ready;
    if (!adapter || !ready) {
      this.onTransportInvalidated();
      return;
    }
    if (!this.joined) this.setState({ status: 'ready', error: '' });
    if (!previousReady && this.joined && this.transportGeneration === adapter.generation) {
      this.setState({ status: 'joined' });
      void this.rebuildMedia();
      return;
    }
    if (previousGeneration >= 0
      && previousGeneration !== adapter.generation
      && this.credentials?.password
      && this.resumeToken) {
      this.failClosed();
      this.setState({ status: 'reconnecting' });
      if (this.resumeTimer) clearTimeout(this.resumeTimer);
      const operation = this.membershipOperation;
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        if (operation === this.membershipOperation && this.credentials
          && (!this.joined || this.transportGeneration !== adapter.generation)) {
          void this.joinInternal(this.credentials, this.resumeToken);
        }
      }, 250);
    }
  }

  async createGroup(displayName: string, password: string): Promise<void> {
    const operation = ++this.membershipOperation;
    const credentials: JoinCredentials = { groupCode: '', password, role: 'driver', displayName };
    this.credentials = credentials;
    this.setState({ status: 'joining', error: '' });
    try {
      const response = await this.rpc.request<ServerIntercomEnvelope>(
        'intercom_group_create', { displayName, password }, 'intercom_joined',
      );
      if (operation !== this.membershipOperation) return;
      await this.applyJoined(response.payload as IntercomJoinedPayload, credentials);
    } catch (error) {
      if (operation !== this.membershipOperation) return;
      this.setState({ status: 'ready', error: errorMessage(error) });
    }
  }

  async join(credentials: JoinCredentials): Promise<void> {
    ++this.membershipOperation;
    this.credentials = { ...credentials };
    this.setState({ status: 'joining', error: '' });
    await this.joinInternal(credentials, '');
  }

  async leave(): Promise<void> {
    this.failClosed();
    this.clearMembership();
    this.setState({ ...INITIAL_STATE, status: isIntercomTransportReady(this.adapter) ? 'ready' : 'unavailable' });
    const stopped = this.audio.stop();
    try {
      if (isIntercomTransportReady(this.adapter)) {
        await this.rpc.request<ServerIntercomEnvelope>('intercom_leave', {}, 'intercom_left', 4_000);
      }
    } catch {
      // Local leave must complete even when the network is gone.
    }
    await stopped;
  }

  async retryMicrophone(deviceId = this.deviceId): Promise<void> {
    if (!this.joined) return;
    const operation = ++this.mediaOperation;
    const hadMediaSession = this.state.mediaStatus === 'connected';
    this.setState({ microphoneStatus: 'requesting', error: '' });
    let track: MediaStreamTrack;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      track = stream.getAudioTracks()[0];
      for (const extra of stream.getTracks()) if (extra !== track) extra.stop();
      if (!track) throw new Error('No microphone track was returned.');
    } catch (error) {
      if (operation !== this.mediaOperation) return;
      this.setState({ microphoneStatus: 'denied', error: `Microphone unavailable: ${errorMessage(error)}` });
      if (!hadMediaSession) void this.startSFU(null, operation);
      return;
    }
    if (operation !== this.mediaOperation || !this.joined) {
      track.stop();
      return;
    }
    this.deviceId = deviceId;
    if (this.state.mediaStatus === 'connected' && this.microphoneLive) {
      try {
        await this.audio.replaceInput(track);
        if (operation !== this.mediaOperation) return;
        this.startVAD(track);
        this.setState({ microphoneStatus: 'live' });
        this.applyGates();
      } catch (error) {
        track.stop();
        if (operation !== this.mediaOperation) return;
        this.audio.disableAll();
        this.setState({ mediaStatus: 'failed', error: errorMessage(error) });
      }
      return;
    }
    if (this.state.mediaStatus === 'connected') await this.audio.stop();
    await this.startSFU(track, operation);
  }

  setBusEnabled(enabled: boolean): void {
    this.setState({ busEnabled: enabled });
    this.activity.update({ busEnabled: enabled });
    this.applyGates();
  }

  setLocalMuted(muted: boolean): void {
    this.setState({ locallyMuted: muted, ...(muted ? { ptt: false } : {}) });
    this.activity.update({ ptt: muted ? false : this.state.ptt });
    this.applyGates();
    this.syncVAD();
  }

  setPTT(active: boolean): void {
    const self = this.state.snapshot?.participants.find((participant) => participant.id === this.state.participantId);
    const privateBlocked = Boolean(
      this.state.snapshot?.privateSession
      && self?.assignmentDriverKey === this.state.snapshot.privateSession.driverKey,
    );
    const allowed = active
      && this.state.role === 'engineer'
      && this.state.status === 'joined'
      && this.surfaceActive
      && !this.state.locallyMuted
      && !self?.forcedMuted
      && !privateBlocked;
    if (allowed === this.state.ptt) return;
    this.setState({ ptt: allowed });
    this.activity.update({ ptt: allowed });
    this.applyGates();
  }

  setSurfaceActive(active: boolean): void {
    this.surfaceActive = active;
    if (!active) {
      this.audio.disableAll();
      this.audio.remoteAudio.muteAll();
      if (this.state.ptt) this.setState({ ptt: false });
      this.activity.update({ ptt: false, speaking: false });
      this.vad.stop();
      this.vadRunning = false;
      return;
    }
    this.applyGates();
    this.syncVAD();
  }

  async setPrivate(driverKey: string, active: boolean): Promise<void> {
    try {
      await this.rpc.request<ServerIntercomEnvelope>(
        'intercom_private_set', { driverKey, active }, 'intercom_state',
      );
    } catch (error) {
      this.setState({ error: errorMessage(error) });
    }
  }

  enableAudio(): Promise<boolean> {
    this.vad.resume();
    return this.audio.enableAudio();
  }

  getParticipantVolume(participantId: string): number {
    return this.audio.remoteAudio.getParticipantVolume(participantId);
  }

  setParticipantVolume(participantId: string, volume: number): number {
    return this.audio.remoteAudio.setParticipantVolume(participantId, volume);
  }

  close(): void {
    const wasJoined = Boolean(this.joined);
    this.failClosed();
    this.clearMembership();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (this.privateReadyTimer) clearTimeout(this.privateReadyTimer);
    this.privateReadyTimer = null;
    this.adapterUnsubscribe?.();
    this.adapterUnsubscribe = null;
    this.adapterInvalidationUnsubscribe?.();
    this.adapterInvalidationUnsubscribe = null;
    if (wasJoined && isIntercomTransportReady(this.adapter)) {
      void this.rpc.request<ServerIntercomEnvelope>('intercom_leave', {}, 'intercom_left', 2_000).catch(() => {});
    }
    this.rpc.close();
    void this.audio.stop();
    this.listeners.clear();
  }

  private async joinInternal(credentials: JoinCredentials, resumeToken: string): Promise<void> {
    const operation = this.membershipOperation;
    try {
      const response = await this.rpc.request<ServerIntercomEnvelope>(
        'intercom_join',
        {
          groupCode: credentials.groupCode,
          password: credentials.password,
          ...(credentials.chiefCode ? { chiefCode: credentials.chiefCode } : {}),
          ...(resumeToken ? { resumeToken } : {}),
          role: credentials.role,
          displayName: credentials.displayName,
        },
        'intercom_joined',
      );
      if (operation !== this.membershipOperation) return;
      await this.applyJoined(response.payload as IntercomJoinedPayload, credentials);
    } catch (error) {
      if (operation !== this.membershipOperation) return;
      this.setState({ status: isIntercomTransportReady(this.adapter) ? 'ready' : 'unavailable', error: errorMessage(error) });
    }
  }

  private onTransportInvalidated(): void {
    this.adapterReady = false;
    ++this.membershipOperation;
    ++this.mediaOperation;
    this.failClosed();
    this.microphoneLive = false;
    this.currentInputTrack = null;
    void this.audio.stop();
    this.setState({ status: this.joined ? 'reconnecting' : 'unavailable', mediaStatus: 'idle' });
  }

  private async applyJoined(payload: IntercomJoinedPayload, credentials: JoinCredentials): Promise<void> {
    if (!this.adapter || !isIntercomTransportReady(this.adapter)) return;
    this.transportGeneration = this.adapter.generation;
    this.adapterGeneration = this.adapter.generation;
    this.adapterReady = true;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.joined = payload;
    this.credentials = { ...credentials, groupCode: payload.groupCode };
    this.resumeToken = payload.resumeToken;
    this.acknowledgedPrivateRevision = -1;
    this.setState({
      status: 'joined',
      role: credentials.role,
      participantId: payload.participantId,
      groupCode: payload.groupCode,
      chiefCode: payload.chiefCode ?? this.state.chiefCode,
      snapshot: payload.snapshot,
      error: payload.sfuEnabled ? '' : 'Intercom media is not configured on the server.',
    });
    this.activity.start();
    this.activity.update({ busEnabled: this.state.busEnabled, ptt: false, speaking: false });
    this.applyGates();
    if (payload.sfuEnabled) await this.retryMicrophone(this.deviceId);
  }

  private onMessage(raw: ServerIntercomEnvelope): void {
    const message = parseServerIntercomEnvelope(raw);
    if (!message) {
      this.failClosed();
      this.setState({ error: 'Malformed intercom authority message.' });
      return;
    }
    if (message.type === 'intercom_joined') {
      // Correlated joins are applied by their awaiting operation only. A late
      // bridge snapshot must not undo an explicit local Leave either.
      if (message.requestId || !this.acceptUnsolicitedJoin) return;
      const payload = message.payload as IntercomJoinedPayload;
      const self = payload.snapshot.participants.find((participant) => participant.id === payload.participantId);
      const credentials = this.credentials ?? (self ? {
        groupCode: payload.groupCode,
        password: '',
        role: self.role,
        displayName: self.displayName,
      } : null);
      if (credentials) void this.applyJoined(payload, credentials);
      return;
    }
    if (message.type === 'intercom_left') {
      if (message.requestId) return;
      this.failClosed();
      this.clearMembership();
      void this.audio.stop();
      this.setState({ ...INITIAL_STATE, status: isIntercomTransportReady(this.adapter) ? 'ready' : 'unavailable' });
      return;
    }
    if (message.type === 'intercom_error' && !message.requestId) {
      const error = message.payload as IntercomErrorPayload;
      if (error.code === 'broker_rebuild_required') {
        this.scheduleBrokerRebuild(new IntercomRPCError(error.code, error.message, error.retryable));
      }
      if (error.code === 'malformed_authority') this.failClosed(false);
      this.setState({ error: error.message });
      return;
    }
    if (message.type !== 'intercom_state' || !this.joined) return;
    const snapshot = message.payload as IntercomSnapshot;
    if (!isSnapshotNewer(this.state.snapshot, snapshot)) return;
    const topologyChanged = snapshot.topologyRevision !== this.state.snapshot?.topologyRevision;
    const privateBarrier = snapshot.privateSession?.phase === 'preparing'
      && isPrivateReadyRequired(this.state.role!, this.state.participantId, snapshot);
    if (privateBarrier) this.audio.disableAll();
    const self = snapshot.participants.find((participant) => participant.id === this.state.participantId);
    const privateBlocksEngineer = this.state.role === 'engineer'
      && snapshot.privateSession
      && self?.assignmentDriverKey === snapshot.privateSession.driverKey;
    const releasePTT = this.state.ptt && (self?.forcedMuted || privateBlocksEngineer);
    this.setState({ snapshot, ...(releasePTT ? { ptt: false } : {}) });
    if (releasePTT) this.activity.update({ ptt: false });
    this.applyGates();
    this.syncVAD();
    if (privateBarrier
      && this.acknowledgedPrivateRevision !== snapshot.revision) {
      this.tryPrivateReady(snapshot.revision);
    }
    if (topologyChanged) void this.reconcileTopology();
  }

  private async reconcileTopology(): Promise<void> {
    const operation = this.mediaOperation;
    if (this.state.role === 'chief') {
      const signature = this.chiefDriverKeys().join('|');
      if (signature !== this.chiefTargetSignature) {
        await this.rebuildMedia();
        return;
      }
    }
    try {
      await this.audio.reconcileSubscriptions();
      if (operation !== this.mediaOperation) return;
      this.applyGates();
    } catch (error) {
      if (operation !== this.mediaOperation) return;
      if (this.scheduleBrokerRebuild(error)) return;
      this.failClosed(false);
      this.setState({ mediaStatus: 'failed', error: errorMessage(error) });
    }
  }

  private async rebuildMedia(): Promise<void> {
    const operation = ++this.mediaOperation;
    this.failClosed(false);
    await this.audio.stop();
    if (operation !== this.mediaOperation || !this.joined) return;
    this.activity.start();
    this.activity.update({ speaking: false, ptt: false, busEnabled: this.state.busEnabled });
    await this.retryMicrophone(this.deviceId);
  }

  private async startSFU(track: MediaStreamTrack | null, operation: number): Promise<void> {
    if (!this.state.role || !this.joined || operation !== this.mediaOperation) {
      track?.stop();
      return;
    }
    try {
      const targets = this.chiefDriverKeys();
      this.chiefTargetSignature = targets.join('|');
      await this.audio.start(this.state.role, track, targets);
      if (operation !== this.mediaOperation) return;
      if (track) this.startVAD(track);
      this.microphoneLive = Boolean(track);
      this.setState({ mediaStatus: 'connected', microphoneStatus: track ? 'live' : this.state.microphoneStatus });
      this.brokerRebuildAttempted = false;
      this.applyGates();
      this.syncVAD();
    } catch (error) {
      track?.stop();
      if (operation === this.mediaOperation && !this.scheduleBrokerRebuild(error)) {
        this.failClosed(false);
        this.setState({ mediaStatus: 'failed', error: errorMessage(error) });
      }
    }
  }

  private startVAD(track: MediaStreamTrack): void {
    this.currentInputTrack = track;
    this.vadRunning = true;
    this.vad.start(track, (speaking) => this.activity.update({ speaking }));
  }

  private syncVAD(): void {
    const self = this.state.snapshot?.participants.find((participant) => participant.id === this.state.participantId);
    const privateSession = this.state.snapshot?.privateSession;
    const roleBlocked = this.state.role === 'engineer'
      ? Boolean(self?.forcedMuted || (privateSession && self?.assignmentDriverKey === privateSession.driverKey))
      : this.state.role === 'chief' && privateSession?.phase === 'preparing';
    const allowed = this.state.status === 'joined'
      && this.state.mediaStatus === 'connected'
      && this.surfaceActive
      && !this.state.locallyMuted
      && !roleBlocked
      && this.currentInputTrack?.readyState === 'live';
    if (allowed && !this.vadRunning) {
      this.startVAD(this.currentInputTrack!);
    } else if (!allowed && this.vadRunning) {
      this.vad.stop();
      this.vadRunning = false;
      this.activity.update({ speaking: false });
    }
  }

  private applyGates(): void {
    const role = this.state.role;
    const snapshot = this.state.snapshot;
    const authorityFresh = Boolean(
      this.adapter
      && this.surfaceActive
      && isIntercomTransportReady(this.adapter)
      && this.transportGeneration === this.adapter.generation
      && this.joined?.membershipGeneration !== undefined,
    );
    if (!role || !snapshot || !authorityFresh) {
      this.audio.disableAll();
      this.audio.remoteAudio.muteAll();
      return;
    }
    const gates = computeSourceGates(role, this.state.participantId, snapshot, {
      authorityFresh,
      mediaReady: this.state.mediaStatus === 'connected',
      locallyMuted: this.state.locallyMuted,
      busEnabled: this.state.busEnabled,
      ptt: this.state.ptt,
    }, this.chiefDriverKeys());
    this.audio.applySourceGates(gates);
    this.audio.remoteAudio.applySinkGates(role, this.state.participantId, snapshot);
  }

  private chiefDriverKeys(): string[] {
    if (this.state.role !== 'chief') return [];
    return (this.state.snapshot?.participants ?? [])
      .filter((participant) => participant.role === 'driver' && participant.online && participant.driverKey)
      .map((participant) => participant.driverKey!)
      .sort();
  }

  private failClosed(stopActivity = true): void {
    this.audio.disableAll();
    this.audio.remoteAudio.muteAll();
    this.vad.stop();
    this.vadRunning = false;
    if (stopActivity) this.currentInputTrack = null;
    if (stopActivity) this.activity.stop();
    if (this.state.ptt) this.setState({ ptt: false });
  }

  private clearMembership(): void {
    ++this.membershipOperation;
    ++this.mediaOperation;
    this.acceptUnsolicitedJoin = false;
    this.joined = null;
    this.credentials = null;
    this.resumeToken = '';
    this.transportGeneration = -1;
    this.acknowledgedPrivateRevision = -1;
    this.chiefTargetSignature = '';
    this.microphoneLive = false;
    this.brokerRebuildAttempted = false;
    this.currentInputTrack = null;
    this.vadRunning = false;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (this.privateReadyTimer) clearTimeout(this.privateReadyTimer);
    this.privateReadyTimer = null;
  }

  private setState(patch: Partial<IntercomRuntimeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private tryPrivateReady(revision: number): void {
    if (this.acknowledgedPrivateRevision === revision) return;
    if (this.rpc.notify('intercom_private_ready', { revision })) {
      this.acknowledgedPrivateRevision = revision;
      if (this.privateReadyTimer) clearTimeout(this.privateReadyTimer);
      this.privateReadyTimer = null;
      return;
    }
    if (this.privateReadyTimer) return;
    this.privateReadyTimer = setTimeout(() => {
      this.privateReadyTimer = null;
      const current = this.state.snapshot;
      if (current?.privateSession?.phase === 'preparing'
        && this.state.role
        && isPrivateReadyRequired(this.state.role, this.state.participantId, current)) {
        this.tryPrivateReady(current.revision);
      }
    }, 250);
  }

  private scheduleBrokerRebuild(error: unknown): boolean {
    if (!(error instanceof IntercomRPCError) || error.code !== 'broker_rebuild_required') return false;
    this.setState({ error: error.message });
    if (!this.brokerRebuildAttempted && this.joined && isIntercomTransportReady(this.adapter)) {
      this.brokerRebuildAttempted = true;
      void this.rebuildMedia();
    }
    return true;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function intercomVersionSupported(value: unknown): boolean {
  return value === INTERCOM_VERSION;
}
