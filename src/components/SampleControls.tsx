import { MouseEvent } from "react";
import { RollingBuffer } from "../audio/rollingBuffer";
import { Station } from "../types";
import { CassetteSprite } from "../assets/pixel-sprites";

type Props = {
  rb: RollingBuffer | null;
  station: Station | null;
  clipsDir: string | null;
  bufferSeconds: number;
  onBufferSecondsChange: (n: number) => void;
  onPickDir: () => void;
  onSample: (seconds: number, fromEvent?: { clientX: number; clientY: number }) => void;
};

export default function SampleControls({
  rb,
  station,
  clipsDir,
  bufferSeconds,
  onBufferSecondsChange,
  onPickDir,
  onSample,
}: Props) {
  const sample = (seconds: number, ev: MouseEvent<HTMLButtonElement>) => {
    onSample(seconds, { clientX: ev.clientX, clientY: ev.clientY });
  };

  return (
    <div className="panel p-3 flex items-center gap-3 relative overflow-hidden">
      {/* hazy cream bleed from top */}
      <div className="absolute inset-x-0 top-0 h-5 cream-bleed pointer-events-none" />
      <CassetteSprite size={36} />
      <div className="flex flex-col relative">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">sample the last</div>
        <div className="flex items-center gap-1 mt-1">
          {[15, 30, 60].map((n) => (
            <button
              key={n}
              onClick={(e) => sample(n, e)}
              disabled={!rb || !station || n > bufferSeconds}
              className="btn-pixel btn-crema"
              title={n > bufferSeconds ? `buffer is only ${bufferSeconds}s` : `save the last ${n}s`}
            >
              {n}s
            </button>
          ))}
        </div>
      </div>

      <div className="ml-3 flex flex-col relative">
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

      <div className="ml-auto flex flex-col items-end gap-1 relative">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">save to</div>
        <button
          onClick={onPickDir}
          className="btn-pixel max-w-[260px] truncate"
          title={clipsDir || ""}
        >
          {clipsDir ? truncMid(clipsDir, 36) : "choose folder…"}
        </button>
      </div>
    </div>
  );
}

function truncMid(s: string, max: number) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}
