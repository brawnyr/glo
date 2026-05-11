import { useEffect, useRef, useState } from "react";
import { Station } from "../types";
import { LevelData, RollingBuffer } from "../audio/rollingBuffer";
import { MugSprite, PauseSprite, PlaySprite, VinylSprite } from "../assets/pixel-sprites";

type Status = "idle" | "loading" | "playing" | "paused" | "error";

type Props = {
  station: Station | null;
  proxyPort: number | null;
  volume: number;
  bufferSeconds: number;
  currentTrack: string | null;
  onVolumeChange: (v: number) => void;
  onBufferReady: (rb: RollingBuffer) => void;
};

export default function Player({
  station,
  proxyPort,
  volume,
  bufferSeconds,
  currentTrack,
  onVolumeChange,
  onBufferReady,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rbRef = useRef<RollingBuffer | null>(null);
  const haloCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelData>({ peak: 0, rms: 0, filled: 0, capacity: 0 });
  const [elapsed, setElapsed] = useState(0);

  const streamUrl =
    station && proxyPort
      ? `http://127.0.0.1:${proxyPort}/stream?url=${encodeURIComponent(station.url_resolved || station.url)}`
      : null;

  // Attach worklet
  useEffect(() => {
    if (!audioRef.current) return;
    let cancelled = false;
    let unsubLevel: (() => void) | null = null;
    const rb = new RollingBuffer(bufferSeconds);
    rb.attach(audioRef.current)
      .then(() => {
        if (cancelled) return;
        rb.setVolume(volume);
        rbRef.current = rb;
        unsubLevel = rb.onLevel(setLevel);
        onBufferReady(rb);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`audio init failed: ${String(e?.message || e)}`);
      });
    return () => {
      cancelled = true;
      if (unsubLevel) unsubLevel();
      rb.destroy();
      if (rbRef.current === rb) rbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rbRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    rbRef.current?.setBufferSeconds(bufferSeconds);
  }, [bufferSeconds]);

  // Load + play on station change
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (!streamUrl) {
      audio.removeAttribute("src");
      audio.load();
      setStatus("idle");
      return;
    }
    audio.src = streamUrl;
    setStatus("loading");
    setElapsed(0);
    rbRef.current?.clear();
    rbRef.current?.resume();
    audio.play().catch((e) => {
      setStatus("error");
      setError(String(e?.message || e));
    });
  }, [streamUrl]);

  useEffect(() => {
    if (status !== "playing") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Audio-reactive halo: pulls FFT bins from the AnalyserNode and paints a
  // soft cream-into-coffee bloom around the vinyl.
  useEffect(() => {
    const canvas = haloCanvasRef.current;
    const rb = rbRef.current;
    if (!canvas || !rb) return;
    const analyser = rb.getAnalyser();
    if (!analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let smoothed = 0;

    const render = () => {
      raf = requestAnimationFrame(render);
      analyser.getByteFrequencyData(bins);
      // Average lower half of the spectrum (where radio energy lives).
      let sum = 0;
      const range = Math.floor(bins.length * 0.6);
      for (let i = 0; i < range; i++) sum += bins[i];
      const avg = sum / range / 255; // 0..1
      smoothed += (avg - smoothed) * 0.18;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.36;
      const radius = base + smoothed * base * 0.55;

      // crema glow
      const g = ctx.createRadialGradient(cx, cy, base * 0.4, cx, cy, radius);
      g.addColorStop(0, `rgba(232, 149, 86, ${0.05 + smoothed * 0.55})`);
      g.addColorStop(0.55, `rgba(217, 127, 60, ${0.04 + smoothed * 0.25})`);
      g.addColorStop(1, "rgba(217, 127, 60, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // ring of frequency bars (8 spokes) for a coffee-swirl feel
      const spokes = 24;
      for (let i = 0; i < spokes; i++) {
        const bin = bins[Math.floor((i / spokes) * range)] / 255;
        const a = (i / spokes) * Math.PI * 2;
        const r1 = base * 0.9;
        const r2 = base * 0.9 + bin * base * 0.7;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(244, 232, 208, ${0.08 + bin * 0.35})`;
        ctx.lineWidth = 1.2;
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // Re-run when the rb identity changes (i.e. once attached)
  }, [status, level.capacity]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    if (audio.paused) {
      await rbRef.current?.resume();
      try {
        await audio.play();
      } catch (e) {
        setStatus("error");
        setError(String((e as Error).message));
      }
    } else {
      audio.pause();
    }
  };

  const fillFrac = level.capacity > 0 ? Math.min(1, level.filled / level.capacity) : 0;
  const capSec = bufferSeconds;
  const fillSec = capSec * fillFrac;

  return (
    <div className={`relative panel p-4 overflow-hidden ${status === "playing" ? "now-playing-glow" : ""}`}>
      {/* hazy cream bleed from the top of the panel */}
      <div className="absolute inset-x-0 top-0 h-8 cream-bleed pointer-events-none" />
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        preload="none"
        onPlay={() => setStatus("playing")}
        onPause={() => setStatus("paused")}
        onWaiting={() => setStatus("loading")}
        onError={() => {
          setStatus("error");
          setError("stream error — try another station or reconnect");
        }}
        onPlaying={() => setStatus("playing")}
      />
      <div className="relative flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          {/* audio-reactive halo */}
          <canvas
            ref={haloCanvasRef}
            width={192}
            height={192}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ filter: "blur(0.5px)" }}
          />
          <div className="relative w-full h-full flex items-center justify-center">
            <VinylSprite size={72} spinning={status === "playing"} />
          </div>
          <div className="absolute -bottom-1 -right-1">
            <MugSprite size={26} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-pixel text-[10px] uppercase tracking-widest text-crema-400 flex items-center gap-2">
            {statusLabel(status)}
            {status === "playing" && <span className="inline-block w-1 h-1 bg-signal-500 animate-pulse" />}
          </div>
          <div className="font-display text-xl text-cream-100 truncate mt-0.5">
            {station ? station.name.trim() || "Untitled station" : "— nothing pouring yet —"}
          </div>
          <div className="font-mono text-xs truncate min-h-[1.1em]">
            {currentTrack ? (
              <span className="text-cream-200">♪ {currentTrack}</span>
            ) : station ? (
              <span className="text-cream-400">
                {station.country || "—"}
                {station.codec ? ` · ${station.codec.toLowerCase()}` : ""}
                {station.bitrate ? ` · ${station.bitrate}kbps` : ""}
              </span>
            ) : (
              <span className="text-cream-400">pick a station from the list to start brewing</span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <LevelMeter level={level} />
            <div className="font-mono text-xs text-cream-300 tabular-nums">{fmt(elapsed)}</div>
            <BufferFill fillSec={fillSec} capSec={capSec} fillFrac={fillFrac} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!station}
            className={`w-14 h-14 flex items-center justify-center border-2 border-roast-950 ${
              status === "playing" ? "bg-crema-500 text-roast-900" : "bg-roast-700 text-cream-100"
            }`}
            title={status === "playing" ? "pause (space)" : "play (space)"}
          >
            {status === "playing" ? <PauseSprite size={28} /> : <PlaySprite size={28} />}
          </button>
          <div className="flex flex-col items-end gap-1">
            <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">vol</div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="accent-crema-500 w-24"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="relative mt-3 px-2 py-1 font-mono text-xs text-crema-400 border border-crema-700 bg-roast-900">
          {error}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: Status): string {
  switch (s) {
    case "idle":
      return "idle";
    case "loading":
      return "brewing…";
    case "playing":
      return "on air";
    case "paused":
      return "paused";
    case "error":
      return "error";
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function LevelMeter({ level }: { level: LevelData }) {
  const lit = Math.round(Math.min(1, level.rms * 2.2) * 10);
  const peakLit = Math.round(Math.min(1, level.peak) * 10);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => {
        const isLit = i < lit;
        const isPeak = i === peakLit - 1;
        const color = i < 6 ? "bg-signal-500" : i < 8 ? "bg-cream-300" : "bg-crema-500";
        return <span key={i} className={`w-1.5 h-3 ${isLit || isPeak ? color : "bg-roast-700"}`} />;
      })}
    </div>
  );
}

function BufferFill({ fillSec, capSec, fillFrac }: { fillSec: number; capSec: number; fillFrac: number }) {
  const segs = 18;
  const lit = Math.round(fillFrac * segs);
  return (
    <div className="flex items-center gap-2 ml-auto" title={`buffer: ${Math.floor(fillSec)} / ${Math.floor(capSec)} s`}>
      <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">buf</span>
      <div className="flex gap-px">
        {Array.from({ length: segs }).map((_, i) => (
          <span
            key={i}
            className={`w-1 h-2.5 ${i < lit ? (fillFrac >= 1 ? "bg-cream-200" : "bg-crema-500") : "bg-roast-700"}`}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] text-cream-300 tabular-nums">
        {Math.floor(fillSec)}/{Math.floor(capSec)}s
      </span>
    </div>
  );
}
