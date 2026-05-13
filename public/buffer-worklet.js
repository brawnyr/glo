// Rolling-buffer AudioWorklet processor.
// Maintains a fixed 60s circular buffer of stereo PCM at the current
// AudioContext sample rate. On request, posts a contiguous copy of the
// last `seconds` of audio back to the main thread.
//
// Messages in:
//   { type: "snapshot", seconds: number, requestId: string }
//   { type: "clear" }
// Messages out:
//   { type: "ready", sampleRate, bufferFrames }
//   { type: "snapshot", requestId, sampleRate, channels: Float32Array[] }
//   { type: "level", peak: number, rms: number }   // ~10/s

class RollingBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const seconds = (options && options.processorOptions && options.processorOptions.seconds) || 60;
    this.numChannels = 2;
    this.capacity = Math.ceil(sampleRate * seconds);
    this.buffers = [
      new Float32Array(this.capacity),
      new Float32Array(this.capacity),
    ];
    this.writeIdx = 0;
    this.filled = 0; // frames filled so far (capped at capacity)
    this.levelCounter = 0;
    this.levelPeak = 0;
    this.levelSumSq = 0;
    this.levelFrames = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);
    this.port.postMessage({
      type: "ready",
      sampleRate,
      bufferFrames: this.capacity,
    });
  }

  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "clear") {
      this.filled = 0;
      this.writeIdx = 0;
      for (let c = 0; c < this.numChannels; c++) {
        this.buffers[c].fill(0);
      }
    } else if (msg.type === "snapshot") {
      const seconds = Math.max(0.5, msg.seconds || 30);
      const frames = Math.min(Math.floor(sampleRate * seconds), this.filled);
      if (frames <= 0) {
        this.port.postMessage({
          type: "snapshot",
          requestId: msg.requestId,
          sampleRate,
          channels: [new Float32Array(0), new Float32Array(0)],
        });
        return;
      }
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      // The most-recent sample is at (writeIdx - 1). Walk back `frames`.
      const startReadIdx = (this.writeIdx - frames + this.capacity) % this.capacity;
      for (let c = 0; c < this.numChannels; c++) {
        for (let i = 0; i < frames; i++) {
          channels[c][i] = this.buffers[c][(startReadIdx + i) % this.capacity];
        }
      }
      this.port.postMessage({
        type: "snapshot",
        requestId: msg.requestId,
        sampleRate,
        channels,
      });
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const l = input[0];
    const r = input.length > 1 ? input[1] : input[0];
    if (!l) return true;

    const frames = l.length;
    let widx = this.writeIdx;
    const cap = this.capacity;
    const b0 = this.buffers[0];
    const b1 = this.buffers[1];

    let peak = this.levelPeak;
    let sumSq = this.levelSumSq;

    for (let i = 0; i < frames; i++) {
      const lv = l[i];
      const rv = r[i];
      b0[widx] = lv;
      b1[widx] = rv;
      widx++;
      if (widx >= cap) widx = 0;
      const a = lv > 0 ? lv : -lv;
      if (a > peak) peak = a;
      sumSq += lv * lv;
    }

    this.writeIdx = widx;
    this.filled = Math.min(cap, this.filled + frames);
    this.levelPeak = peak;
    this.levelSumSq = sumSq;
    this.levelFrames += frames;
    this.levelCounter += frames;

    // Emit level + fill roughly every 100ms
    if (this.levelCounter >= sampleRate / 10) {
      const rms = Math.sqrt(this.levelSumSq / Math.max(1, this.levelFrames));
      this.port.postMessage({
        type: "level",
        peak: this.levelPeak,
        rms,
        filled: this.filled,
        capacity: this.capacity,
      });
      this.levelCounter = 0;
      this.levelPeak = 0;
      this.levelSumSq = 0;
      this.levelFrames = 0;
    }

    return true;
  }
}

registerProcessor("rolling-buffer", RollingBufferProcessor);
