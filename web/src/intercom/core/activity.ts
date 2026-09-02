export interface IntercomActivityState {
  speaking: boolean;
  ptt: boolean;
  busEnabled: boolean;
}

export class ActivityLease {
  private current: IntercomActivityState = { speaking: false, ptt: false, busEnabled: true };
  private lastSent: IntercomActivityState | null = null;
  private lastSentAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly send: (state: IntercomActivityState) => void) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(true), 750);
  }

  update(next: Partial<IntercomActivityState>): void {
    this.current = { ...this.current, ...next };
    this.flush(false);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current.speaking || this.current.ptt) {
      this.current = { ...this.current, speaking: false, ptt: false };
      this.send(this.current);
    }
    this.lastSent = null;
  }

  private flush(leaseRefresh: boolean): void {
    const now = Date.now();
    const changed = !this.lastSent
      || this.current.speaking !== this.lastSent.speaking
      || this.current.ptt !== this.lastSent.ptt
      || this.current.busEnabled !== this.lastSent.busEnabled;
    if (!changed && !(leaseRefresh && (this.current.speaking || this.current.ptt))) return;
    if (now - this.lastSentAt < 250) return;
    this.lastSentAt = now;
    this.lastSent = { ...this.current };
    this.send(this.current);
  }
}

export class VoiceActivityDetector {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame = 0;
  private speaking = false;
  private aboveSince = 0;
  private belowSince = 0;

  start(track: MediaStreamTrack, onChange: (speaking: boolean) => void): void {
    this.stop();
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    void context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    this.context = context;
    this.analyser = analyser;
    this.source = context.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (this.analyser !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      if (rms >= 0.035) {
        this.belowSince = 0;
        if (!this.aboveSince) this.aboveSince = now;
        if (!this.speaking && now - this.aboveSince >= 80) {
          this.speaking = true;
          onChange(true);
        }
      } else {
        this.aboveSince = 0;
        if (!this.belowSince) this.belowSince = now;
        if (this.speaking && now - this.belowSince >= 280) {
          this.speaking = false;
          onChange(false);
        }
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    if (this.context) void this.context.close();
    this.context = null;
    this.speaking = false;
    this.aboveSince = 0;
    this.belowSince = 0;
  }

  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  }
}
