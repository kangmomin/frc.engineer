import { shouldMuteRemoteRoute, type RemoteTrackRoute } from './gates';
import type { IntercomRole, IntercomSnapshot } from './protocol';

interface RemoteAudioEntry {
  element: HTMLAudioElement;
  track: MediaStreamTrack;
  route: RemoteTrackRoute;
}

interface SinkGateContext {
  role: IntercomRole;
  participantId: string;
  snapshot: IntercomSnapshot;
}

export class RemoteAudioRegistry {
  private entries = new Map<string, RemoteAudioEntry>();
  private participantVolumes = new Map<string, number>();
  private gateContext: SinkGateContext | null = null;
  private unlocked = false;
  private automaticAudibleAttempted = false;
  private blocked = false;
  private playbackFailureRevision = 0;
  private changeListener: ((blocked: boolean) => void) | null = null;

  onAutoplayChange(listener: ((blocked: boolean) => void) | null): void {
    this.changeListener = listener;
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  getParticipantVolume(participantId: string): number {
    return this.participantVolumes.get(participantId) ?? 1;
  }

  setParticipantVolume(participantId: string, volume: number): number {
    const current = this.getParticipantVolume(participantId);
    const normalized = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : current;
    if (normalized === 1) this.participantVolumes.delete(participantId);
    else this.participantVolumes.set(participantId, normalized);
    for (const entry of this.entries.values()) {
      if (entry.route.participantId === participantId) entry.element.volume = normalized;
    }
    return normalized;
  }

  attach(route: RemoteTrackRoute, track: MediaStreamTrack): void {
    this.remove(route.trackKey);
    const element = document.createElement('audio');
    element.autoplay = true;
    element.muted = true;
    element.volume = this.getParticipantVolume(route.participantId);
    element.setAttribute('playsinline', '');
    element.dataset.intercomTrackKey = route.trackKey;
    element.style.display = 'none';
    element.srcObject = new MediaStream([track]);
    document.body.appendChild(element);
    this.entries.set(route.trackKey, { element, track, route });
    track.addEventListener('ended', () => {
      if (this.entries.get(route.trackKey)?.track === track) this.remove(route.trackKey);
    }, { once: true });
    const muted = !this.gateContext || shouldMuteRemoteRoute(
      this.gateContext.role,
      this.gateContext.participantId,
      this.gateContext.snapshot,
      route,
    );
    element.muted = muted;
    if (muted) this.startMutedPlayback(element);
    else if (this.unlocked || !this.automaticAudibleAttempted) {
      this.automaticAudibleAttempted = true;
      void this.playAudible([element]);
    } else this.setBlocked(true);
  }

  remove(trackKey: string): void {
    const entry = this.entries.get(trackKey);
    if (!entry) return;
    this.entries.delete(trackKey);
    entry.element.pause();
    entry.element.srcObject = null;
    entry.element.remove();
  }

  has(trackKey: string, track: MediaStreamTrack): boolean {
    return this.entries.get(trackKey)?.track === track;
  }

  applySinkGates(role: IntercomRole, participantId: string, snapshot: IntercomSnapshot | null): void {
    if (!snapshot) {
      this.muteAll();
      return;
    }
    this.gateContext = { role, participantId, snapshot };
    const newlyAudible: HTMLAudioElement[] = [];
    for (const entry of this.entries.values()) {
      const muted = shouldMuteRemoteRoute(role, participantId, snapshot, entry.route);
      const wasMuted = entry.element.muted;
      entry.element.muted = muted;
      if (wasMuted && !muted) newlyAudible.push(entry.element);
    }
    if (newlyAudible.length) {
      this.automaticAudibleAttempted = true;
      void this.playAudible(newlyAudible);
    }
  }

  muteAll(): void {
    this.gateContext = null;
    for (const entry of this.entries.values()) entry.element.muted = true;
  }

  enableAudio(): Promise<boolean> {
    const current = [...this.entries.values()].map(({ element }) => element);
    return this.playElements(current, false);
  }

  clear(): void {
    for (const trackKey of [...this.entries.keys()]) this.remove(trackKey);
    this.gateContext = null;
    this.unlocked = false;
    this.automaticAudibleAttempted = false;
    this.setBlocked(false);
  }

  private startMutedPlayback(element: HTMLAudioElement): void {
    void element.play().catch(() => {});
  }

  private playAudible(elements: HTMLAudioElement[]): Promise<boolean> {
    return this.playElements(elements, true);
  }

  private async playElements(elements: HTMLAudioElement[], requireAudible: boolean): Promise<boolean> {
    if (!elements.length || (requireAudible && !this.gateContext)) return false;
    const failureRevision = this.playbackFailureRevision;
    const results = await Promise.all(elements.map(async (element) => {
      try {
        await element.play();
        return true;
      } catch {
        return false;
      }
    }));
    const currentElements = new Set([...this.entries.values()].map(({ element }) => element));
    if (!this.gateContext
      || elements.some((element) => !currentElements.has(element) || (requireAudible && element.muted))) {
      return false;
    }
    const success = results.every(Boolean);
    if (!success) {
      ++this.playbackFailureRevision;
      this.unlocked = false;
      this.setBlocked(true);
      return false;
    }
    if (failureRevision !== this.playbackFailureRevision) return false;
    this.unlocked = true;
    this.setBlocked(false);
    return true;
  }

  private setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.changeListener?.(blocked);
  }
}
