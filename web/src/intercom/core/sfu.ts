import { RemoteAudioRegistry } from './audioRegistry';
import { publicationKey, type RemoteTrackRoute, type SourceGates } from './gates';
import type {
  IntercomEnvelope,
  IntercomPublishedTrack,
  IntercomRole,
  IntercomSessionDescription,
  IntercomSubscribedTrack,
  IntercomTrackClass,
  ServerIntercomEnvelope,
} from './protocol';
import { IntercomRPCClient } from './transport';

interface PublicationSpec {
  class: IntercomTrackClass;
  targetDriverKey?: string;
}

interface LocalPublication extends PublicationSpec {
  key: string;
  clone: MediaStreamTrack;
  sender: RTCRtpSender;
  transceiver: RTCRtpTransceiver;
}

export interface SFUAudioStateListener {
  (state: 'idle' | 'connecting' | 'connected' | 'failed', error?: string): void;
}

export function publicationSpecsForRole(role: IntercomRole, chiefDriverKeys: string[]): PublicationSpec[] {
  switch (role) {
    case 'driver':
      return [{ class: 'driver_engineer' }, { class: 'driver_chief' }];
    case 'engineer':
      return [{ class: 'engineer_bus' }, { class: 'driver_radio' }];
    case 'chief':
      return [
        { class: 'engineer_bus' },
        ...chiefDriverKeys.map((targetDriverKey) => ({ class: 'chief_private' as const, targetDriverKey })),
      ];
  }
}

export function cloneDisabledTrack(source: MediaStreamTrack): MediaStreamTrack {
  const clone = source.clone();
  clone.enabled = false;
  return clone;
}

export function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 5_000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('SFU ICE gathering timed out.')), timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function descriptionOf(value: RTCSessionDescription | RTCSessionDescriptionInit | null): IntercomSessionDescription {
  if (!value?.sdp || (value.type !== 'offer' && value.type !== 'answer')) throw new Error('Missing local SFU description.');
  return { type: value.type, sdp: value.sdp };
}

function responsePayload<T>(message: ServerIntercomEnvelope): T {
  return message.payload as T;
}

export interface AuthoritativeRemoteTrackBinding {
  route: IntercomSubscribedTrack;
  track: MediaStreamTrack;
}

export class AuthoritativeRemoteTrackBinder {
  private routesByMID = new Map<string, IntercomSubscribedTrack>();
  private pendingByMID = new Map<string, MediaStreamTrack>();
  private delivered = new Map<string, MediaStreamTrack>();
  private observed = new WeakSet<MediaStreamTrack>();

  receive(mid: string | null, track: MediaStreamTrack): AuthoritativeRemoteTrackBinding | null {
    if (!mid || track.readyState !== 'live') return null;
    this.pendingByMID.set(mid, track);
    if (!this.observed.has(track)) {
      this.observed.add(track);
      track.addEventListener('ended', () => {
        for (const [pendingMID, pendingTrack] of this.pendingByMID) {
          if (pendingTrack === track) this.pendingByMID.delete(pendingMID);
        }
        for (const [trackKey, deliveredTrack] of this.delivered) {
          if (deliveredTrack === track) this.delivered.delete(trackKey);
        }
      }, { once: true });
    }
    return this.bind(mid, track);
  }

  setRoutes(routes: IntercomSubscribedTrack[]): AuthoritativeRemoteTrackBinding[] {
    const previous = this.routesByMID;
    const next = new Map(routes.map((route) => [route.mid, route]));
    this.routesByMID = next;
    for (const route of previous.values()) {
      if (next.get(route.mid)?.trackKey !== route.trackKey) this.delivered.delete(route.trackKey);
    }
    for (const trackKey of [...this.delivered.keys()]) {
      if (!routes.some((route) => route.trackKey === trackKey)) this.delivered.delete(trackKey);
    }
    const bindings: AuthoritativeRemoteTrackBinding[] = [];
    for (const [mid, route] of next) {
      const previousRoute = previous.get(mid);
      if (previousRoute && previousRoute.trackKey !== route.trackKey) {
        this.pendingByMID.delete(mid);
        continue;
      }
      const track = this.pendingByMID.get(mid);
      if (!track || track.readyState !== 'live') continue;
      const binding = this.bind(mid, track);
      if (binding) bindings.push(binding);
    }
    for (const mid of previous.keys()) {
      if (!next.has(mid)) this.pendingByMID.delete(mid);
    }
    return bindings;
  }

  clear(): void {
    this.routesByMID.clear();
    this.pendingByMID.clear();
    this.delivered.clear();
    this.observed = new WeakSet<MediaStreamTrack>();
  }

  private bind(mid: string, track: MediaStreamTrack): AuthoritativeRemoteTrackBinding | null {
    const route = this.routesByMID.get(mid);
    if (!route || this.delivered.get(route.trackKey) === track) return null;
    this.delivered.set(route.trackKey, track);
    return { route, track };
  }
}

export class SFUAudioController {
  readonly remoteAudio = new RemoteAudioRegistry();
  private pc: RTCPeerConnection | null = null;
  private sessionHandle = '';
  private rawTrack: MediaStreamTrack | null = null;
  private publications: LocalPublication[] = [];
  private remoteRoutes = new Map<string, IntercomSubscribedTrack>();
  private readonly remoteBinder = new AuthoritativeRemoteTrackBinder();
  private operation = Promise.resolve();
  private lifecycle = 0;
  private listener: SFUAudioStateListener | null = null;

  constructor(private readonly rpc: IntercomRPCClient) {}

  onStateChange(listener: SFUAudioStateListener | null): void {
    this.listener = listener;
  }

  start(role: IntercomRole, rawTrack: MediaStreamTrack | null, chiefDriverKeys: string[]): Promise<void> {
    const lifecycle = ++this.lifecycle;
    return this.serialize(async () => {
      if (lifecycle !== this.lifecycle) {
        rawTrack?.stop();
        return;
      }
      await this.stopInternal(false);
      if (lifecycle !== this.lifecycle) {
        rawTrack?.stop();
        return;
      }
      this.listener?.('connecting');
      this.rawTrack = rawTrack;
      try {
        const session = await this.rpc.request<ServerIntercomEnvelope>(
          'intercom_sfu_session_new', {}, 'intercom_sfu_session',
        );
        if (lifecycle !== this.lifecycle) throw new Error('Stale SFU start.');
        this.sessionHandle = responsePayload<{ sessionHandle: string }>(session).sessionHandle;
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
        this.pc = pc;
        pc.ontrack = (event) => {
          if (this.pc !== pc) return;
          const binding = this.remoteBinder.receive(event.transceiver.mid, event.track);
          if (binding) this.attachRemote(binding);
        };
        pc.addEventListener('connectionstatechange', () => {
          if (this.pc !== pc) return;
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            this.disableAll();
            this.listener?.('failed', 'Intercom media connection failed.');
          }
        });
        const specs = rawTrack ? publicationSpecsForRole(role, chiefDriverKeys) : [];
        for (const spec of specs) {
          const clone = cloneDisabledTrack(rawTrack!);
          const transceiver = pc.addTransceiver(clone, { direction: 'sendonly' });
          this.publications.push({
            ...spec,
            key: publicationKey(spec.class, spec.targetDriverKey),
            clone,
            sender: transceiver.sender,
            transceiver,
          });
        }
        if (this.publications.length) await this.publish(lifecycle);
        await this.reconcileInternal(lifecycle);
        if (lifecycle !== this.lifecycle) throw new Error('Stale SFU start.');
        this.listener?.('connected');
      } catch (error) {
        if (lifecycle !== this.lifecycle) {
          rawTrack?.stop();
          return;
        }
        await this.stopInternal(false);
        this.listener?.('failed', error instanceof Error ? error.message : 'Intercom media failed.');
        throw error;
      }
    });
  }

  reconcileSubscriptions(): Promise<void> {
    const lifecycle = this.lifecycle;
    return this.serialize(() => this.reconcileInternal(lifecycle));
  }

  replaceInput(nextRawTrack: MediaStreamTrack): Promise<void> {
    const lifecycle = this.lifecycle;
    return this.serialize(async () => {
      if (lifecycle !== this.lifecycle) {
        nextRawTrack.stop();
        return;
      }
      const replacements = this.publications.map((publication) => {
        const clone = cloneDisabledTrack(nextRawTrack);
        return { publication, clone };
      });
      try {
        await Promise.all(replacements.map(({ publication, clone }) => publication.sender.replaceTrack(clone)));
      } catch (error) {
        for (const { clone } of replacements) clone.stop();
        nextRawTrack.stop();
        throw error;
      }
      if (lifecycle !== this.lifecycle) {
        for (const { clone } of replacements) clone.stop();
        nextRawTrack.stop();
        return;
      }
      const previousRaw = this.rawTrack;
      for (const { publication, clone } of replacements) {
        publication.clone.stop();
        publication.clone = clone;
      }
      this.rawTrack = nextRawTrack;
      previousRaw?.stop();
    });
  }

  applySourceGates(gates: SourceGates): void {
    for (const publication of this.publications) publication.clone.enabled = gates[publication.key] === true;
  }

  disableAll(): void {
    for (const publication of this.publications) publication.clone.enabled = false;
  }

  enableAudio(): Promise<boolean> {
    return this.remoteAudio.enableAudio();
  }

  stop(): Promise<void> {
    ++this.lifecycle;
    // Teardown must run now, even if an earlier SFU RPC is still awaiting ACK.
    return this.stopInternal(true);
  }

  private async publish(lifecycle: number): Promise<void> {
    const pc = this.requirePC(lifecycle);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGatheringComplete(pc);
    const tracks = this.publications.map((publication) => {
      const mid = publication.transceiver.mid;
      if (mid === null) throw new Error('SFU publication has no media id.');
      return { mid, class: publication.class, ...(publication.targetDriverKey ? { targetDriverKey: publication.targetDriverKey } : {}) };
    });
    const response = await this.rpc.request<ServerIntercomEnvelope>(
      'intercom_sfu_publish',
      { sessionHandle: this.sessionHandle, sessionDescription: descriptionOf(pc.localDescription), tracks },
      'intercom_sfu_published',
    );
    const payload = responsePayload<{
      sessionDescription?: IntercomSessionDescription;
      requiresImmediateRenegotiation: boolean;
      tracks: IntercomPublishedTrack[];
    }>(response);
    if (payload.requiresImmediateRenegotiation && !payload.sessionDescription) {
      throw new Error('SFU publish requires a missing renegotiation description.');
    }
    if (payload.sessionDescription) await this.applyBrokerDescription(pc, payload.sessionDescription, lifecycle);
  }

  private async reconcileInternal(lifecycle: number): Promise<void> {
    if (!this.sessionHandle) return;
    const pc = this.requirePC(lifecycle);
    const response = await this.rpc.request<ServerIntercomEnvelope>(
      'intercom_sfu_subscribe', { sessionHandle: this.sessionHandle }, 'intercom_sfu_subscribed',
    );
    this.requirePC(lifecycle);
    const payload = responsePayload<{
      sessionDescription?: IntercomSessionDescription;
      requiresImmediateRenegotiation: boolean;
      tracks: IntercomSubscribedTrack[];
      removedTrackKeys: string[];
    }>(response);
    if (payload.requiresImmediateRenegotiation && !payload.sessionDescription) {
      throw new Error('SFU subscription requires a missing renegotiation description.');
    }
    const currentKeys = new Set(payload.tracks.map((track) => track.trackKey));
    for (const trackKey of payload.removedTrackKeys) {
      this.remoteRoutes.delete(trackKey);
      this.remoteAudio.remove(trackKey);
    }
    for (const existing of [...this.remoteRoutes.keys()]) {
      if (!currentKeys.has(existing)) {
        this.remoteRoutes.delete(existing);
        this.remoteAudio.remove(existing);
      }
    }
    for (const route of payload.tracks) this.remoteRoutes.set(route.trackKey, route);
    const pendingBindings = this.remoteBinder.setRoutes(payload.tracks);
    for (const binding of pendingBindings) this.attachRemote(binding);
    if (payload.sessionDescription) await this.applyBrokerDescription(pc, payload.sessionDescription, lifecycle);
    for (const route of payload.tracks) {
      const transceiver = pc.getTransceivers().find((candidate) => candidate.mid === route.mid);
      const track = transceiver?.receiver.track;
      if (!track) continue;
      const binding = this.remoteBinder.receive(route.mid, track);
      if (binding) this.attachRemote(binding);
    }
  }

  private async applyBrokerDescription(
    pc: RTCPeerConnection,
    description: IntercomSessionDescription,
    lifecycle: number,
  ): Promise<void> {
    this.requirePC(lifecycle);
    await pc.setRemoteDescription(description);
    if (description.type !== 'offer') return;
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIceGatheringComplete(pc);
    await this.rpc.request<ServerIntercomEnvelope>(
      'intercom_sfu_renegotiate',
      { sessionHandle: this.sessionHandle, sessionDescription: descriptionOf(pc.localDescription) },
      'intercom_sfu_renegotiated',
    );
  }

  private requirePC(lifecycle: number): RTCPeerConnection {
    if (lifecycle !== this.lifecycle || !this.pc || !this.sessionHandle) throw new Error('Stale SFU session.');
    return this.pc;
  }

  private async stopInternal(notifyServer: boolean): Promise<void> {
    const sessionHandle = this.sessionHandle;
    this.sessionHandle = '';
    this.disableAll();
    for (const publication of this.publications) publication.clone.stop();
    this.publications = [];
    this.rawTrack?.stop();
    this.rawTrack = null;
    const pc = this.pc;
    this.pc = null;
    pc?.close();
    this.remoteRoutes.clear();
    this.remoteBinder.clear();
    this.remoteAudio.clear();
    this.listener?.('idle');
    if (notifyServer && sessionHandle) {
      try {
        await this.rpc.request<ServerIntercomEnvelope>(
          'intercom_sfu_close', { sessionHandle }, 'intercom_sfu_closed', 3_000,
        );
      } catch {
        // Signaling loss and superseding sessions make close best-effort.
      }
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private attachRemote({ route, track }: AuthoritativeRemoteTrackBinding): void {
    if (!this.remoteAudio.has(route.trackKey, track)) this.remoteAudio.attach(route as RemoteTrackRoute, track);
  }
}

export function isSFUClientEnvelope(message: IntercomEnvelope): boolean {
  return message.type.startsWith('intercom_sfu_');
}
