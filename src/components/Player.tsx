import { useEffect, useRef, useState } from "react";
import { Station } from "../types";
import { RollingBuffer } from "../audio/rollingBuffer";
import { MugSprite, PauseSprite, PlaySprite, VinylSprite } from "../assets/pixel-sprites";

type Status = "idle" | "loading" | "playing" | "paused" | "error";

type Props = {
  station: Station | null;
  proxyPort: number | null;
  volume: number;
  bufferSeconds: number;
  onVolumeChange: (v: number) => void;
  onBufferReady: (rb: RollingBuffer) => void;
};

export default function Player({ station, proxyPort, volume, bufferSeconds, onVolumeChange, onBufferReady }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rbRef = useRef<RollingBuffer | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState({ peak: 0, rms: 0 });
  const [elapsed, setElapsed] = useState(0);

  // Build proxied stream URL
  const streamUrl = station && proxyPort
    ? `http://127.0.0.1:${proxyPort}/stream?url=${encodeURIComponent(station.url_resolved || station.url)}`
    : null;

  // Attach worklet once we have an audio element
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

  // Push volume changes to the worklet gain
  useEffect(() => {
    rbRef.current?.setVolume(volume);
  }, [volume]);

  // Push buffer length changes
  useEffect(() => {
    rbRef.current?.setBufferSeconds(bufferSeconds);
  }, [bufferSeconds]);

  // Load + play when station changes
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
    // Need user gesture-y context resume; the click that triggered station-select is one
    rbRef.current?.resume();
    audio.play().catch((e) => {
      setStatus("error");
      setError(String(e?.message || e));
    });
  }, [streamUrl]);

  // Elapsed timer (since we started this station)
  useEffect(() => {
    if (status !== "playing") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

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

  return (
    <div className={`relative panel p-4 ${status === "playing" ? "now-playing-glow" : ""}`}>
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
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="relative w-20 h-20 bg-roast-900 border-2 border-roast-950 flex items-center justify-center">
            <VinylSprite size={64} spinning={status === "playing"} />
          </div>
          <div className="absolute -bottom-2 -right-2">
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
          <div className="font-mono text-xs text-cream-400 truncate">
            {station ? (
              <>
                {station.country || "—"}
                {station.codec ? ` · ${station.codec.toLowerCase()}` : ""}
                {station.bitrate ? ` · ${station.bitrate}kbps` : ""}
              </>
            ) : (
              "pick a station from the list to start brewing"
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <LevelMeter level={level} />
            <div className="font-mono text-xs text-cream-300 tabular-nums">
              {fmt(elapsed)}
            </div>
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
        <div className="mt-3 px-2 py-1 font-mono text-xs text-crema-400 border border-crema-700 bg-roast-900">
          {error}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: Status): string {
  switch (s) {
    case "idle": return "idle";
    case "loading": return "brewing…";
    case "playing": return "on air";
    case "paused": return "paused";
    case "error": return "error";
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function LevelMeter({ level }: { level: { peak: number; rms: number } }) {
  // 10 segments, lit based on rms (with peak indicator)
  const lit = Math.round(Math.min(1, level.rms * 2.2) * 10);
  const peakLit = Math.round(Math.min(1, level.peak) * 10);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => {
        const isLit = i < lit;
        const isPeak = i === peakLit - 1;
        const color = i < 6 ? "bg-signal-500" : i < 8 ? "bg-cream-300" : "bg-crema-500";
        return (
          <span
            key={i}
            className={`w-1.5 h-3 ${isLit || isPeak ? color : "bg-roast-700"}`}
          />
        );
      })}
    </div>
  );
}
