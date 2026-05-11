// Main-thread interface to the rolling-buffer AudioWorklet.
// Owns the AudioContext, the <audio> element source, and the worklet node.

export type LevelData = { peak: number; rms: number };
export type Snapshot = { sampleRate: number; channels: Float32Array[] };

type SnapshotResolver = (s: Snapshot) => void;

export class RollingBuffer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private sink: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private bufferSeconds: number;
  private snapshotResolvers = new Map<string, SnapshotResolver>();
  private levelListeners = new Set<(d: LevelData) => void>();
  private readyResolvers: Array<() => void> = [];
  private ready = false;

  constructor(bufferSeconds = 60) {
    this.bufferSeconds = bufferSeconds;
  }

  async attach(audioEl: HTMLAudioElement) {
    if (this.audioEl === audioEl && this.ctx) return;
    // If we're swapping element, tear down and recreate
    if (this.audioEl && this.audioEl !== audioEl) {
      await this.destroy();
    }
    this.audioEl = audioEl;
    audioEl.crossOrigin = "anonymous";

    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule("/buffer-worklet.js");

    const node = new AudioWorkletNode(ctx, "rolling-buffer", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { seconds: this.bufferSeconds },
    });

    node.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "ready") {
        this.ready = true;
        this.readyResolvers.splice(0).forEach((r) => r());
      } else if (msg.type === "snapshot") {
        const res = this.snapshotResolvers.get(msg.requestId);
        if (res) {
          this.snapshotResolvers.delete(msg.requestId);
          res({ sampleRate: msg.sampleRate, channels: msg.channels });
        }
      } else if (msg.type === "level") {
        const data = { peak: msg.peak, rms: msg.rms };
        this.levelListeners.forEach((fn) => fn(data));
      }
    };

    const src = ctx.createMediaElementSource(audioEl);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    // Muted sink keeps the worklet's output connected to the graph so
    // process() runs reliably across engines.
    const sink = ctx.createGain();
    sink.gain.value = 0;

    // src -> gain -> [worklet -> muted sink -> destination, analyser, destination]
    src.connect(gain);
    gain.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    gain.connect(analyser);
    gain.connect(ctx.destination);

    this.src = src;
    this.gain = gain;
    this.sink = sink;
    this.node = node;
    this.analyser = analyser;

    await this.waitReady();
  }

  private waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  setBufferSeconds(seconds: number) {
    this.bufferSeconds = seconds;
    this.node?.port.postMessage({ type: "config", seconds });
  }

  clear() {
    this.node?.port.postMessage({ type: "clear" });
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async resume() {
    if (this.ctx && this.ctx.state !== "running") {
      await this.ctx.resume();
    }
  }

  onLevel(fn: (d: LevelData) => void): () => void {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  snapshot(seconds: number): Promise<Snapshot> {
    if (!this.node) return Promise.reject(new Error("not attached"));
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      this.snapshotResolvers.set(requestId, resolve);
      this.node!.port.postMessage({ type: "snapshot", seconds, requestId });
    });
  }

  async destroy() {
    try {
      this.src?.disconnect();
      this.gain?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // ignore
      }
    }
    this.ctx = null;
    this.node = null;
    this.src = null;
    this.gain = null;
    this.sink = null;
    this.analyser = null;
    this.audioEl = null;
    this.ready = false;
  }
}
