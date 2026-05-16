import { MouseEvent } from "react";
import { RollingBuffer } from "../audio/rollingBuffer";
import { Station } from "../types";
import { CassetteSprite } from "../assets/pixel-sprites";

type Props = {
  rb: RollingBuffer | null;
  station: Station | null;
  onSample: (seconds: number, fromEvent?: { clientX: number; clientY: number }) => void;
};

export default function SampleControls({ rb, station, onSample }: Props) {
  const sample = (seconds: number, ev: MouseEvent<HTMLButtonElement>) => {
    onSample(seconds, { clientX: ev.clientX, clientY: ev.clientY });
  };

  return (
    <div className="panel p-3 flex items-center gap-3 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-5 cream-bleed pointer-events-none" />
      <CassetteSprite size={36} />
      <div className="flex flex-col relative">
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">sample the last</div>
        <div className="flex items-center gap-1 mt-1">
          {[15, 30, 60].map((n) => (
            <button
              key={n}
              onClick={(e) => sample(n, e)}
              disabled={!rb || !station}
              className="btn-pixel btn-crema"
              title={`save the last ${n}s`}
            >
              {n}s
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
