import { useState } from "react";
import { RollingBuffer } from "../audio/rollingBuffer";
import { encodeWav } from "../audio/wavEncoder";
import { invoke } from "../lib/tauri";
import { Station } from "../types";
import { CassetteSprite } from "../assets/pixel-sprites";

type Props = {
  rb: RollingBuffer | null;
  station: Station | null;
  clipsDir: string | null;
  bufferSeconds: number;
  onBufferSecondsChange: (n: number) => void;
  onPickDir: () => void;
  onSaved: () => void;
};

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; name: string } | { kind: "error"; msg: string };

export default function SampleControls({
  rb,
  station,
  clipsDir,
  bufferSeconds,
  onBufferSecondsChange,
  onPickDir,
  onSaved,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const sample = async (seconds: number) => {
    if (!rb || !station) return;
    if (!clipsDir) {
      onPickDir();
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const snap = await rb.snapshot(seconds);
      if (snap.channels[0].length === 0) {
        setStatus({ kind: "error", msg: "buffer empty — let it brew a few seconds first" });
        return;
      }
      const wav = encodeWav(snap.channels, snap.sampleRate);
      const result = await invoke<{ fileName: string }>("save_clip", {
        args: {
          dir: clipsDir,
          stationName: station.name,
          durationSec: snap.channels[0].length / snap.sampleRate,
          bytes: Array.from(wav),
        },
      });
      setStatus({ kind: "saved", name: result.fileName });
      onSaved();
      setTimeout(() => setStatus({ kind: "idle" }), 2400);
    } catch (e) {
      setStatus({ kind: "error", msg: String((e as Error).message || e) });
    }
  };

  return (
    <div className="panel p-3 flex items-center gap-3">
      <CassetteSprite size={36} />
      <div className="flex flex-col">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">sample the last</div>
        <div className="flex items-center gap-1 mt-1">
          {[15, 30, 60].map((n) => (
            <button
              key={n}
              onClick={() => sample(n)}
              disabled={!rb || !station || n > bufferSeconds || status.kind === "saving"}
              className="btn-pixel btn-crema"
            >
              {n}s
            </button>
          ))}
        </div>
      </div>

      <div className="ml-3 flex flex-col">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">buffer size</div>
        <div className="flex items-center gap-1 mt-1">
          {[30, 60, 90, 120].map((n) => (
            <button
              key={n}
              onClick={() => onBufferSecondsChange(n)}
              className={`btn-pixel ${bufferSeconds === n ? "ring-2 ring-crema-500" : ""}`}
            >
              {n}s
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex flex-col items-end gap-1">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">save to</div>
        <button onClick={onPickDir} className="btn-pixel max-w-[260px] truncate" title={clipsDir || ""}>
          {clipsDir ? truncMid(clipsDir, 36) : "choose folder…"}
        </button>
      </div>

      {status.kind === "saving" && (
        <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-300 ml-2 caret">saving</span>
      )}
      {status.kind === "saved" && (
        <span className="font-pixel text-[10px] uppercase tracking-widest text-signal-500 ml-2 truncate max-w-[200px]">
          saved · {status.name}
        </span>
      )}
      {status.kind === "error" && (
        <span className="font-mono text-[10px] text-crema-400 ml-2 max-w-[260px] truncate" title={status.msg}>
          {status.msg}
        </span>
      )}
    </div>
  );
}

function truncMid(s: string, max: number) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}
