import { useEffect, useState } from "react";
import { Clip } from "../types";
import { invoke } from "../lib/tauri";
import { CassetteSprite, TrashSprite } from "../assets/pixel-sprites";

type Props = {
  clipsDir: string | null;
  refreshKey: number;
  onPickDir: () => void;
  onChanged: () => void;
};

type RawClip = {
  fileName: string;
  path: string;
  stationName: string;
  durationSec: number;
  createdAt: number;
  sizeBytes: number;
};

export default function ClipLibrary({ clipsDir, refreshKey, onPickDir, onChanged }: Props) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!clipsDir) return;
    setErr(null);
    invoke<RawClip[]>("list_clips", { dir: clipsDir })
      .then((rows) => setClips(rows as Clip[]))
      .catch((e) => {
        setClips([]);
        setErr(String((e as Error)?.message || e));
      });
  }, [clipsDir, refreshKey]);

  const remove = async (c: Clip) => {
    if (!confirm(`delete ${c.fileName}?`)) return;
    try {
      await invoke("delete_clip", { path: c.path });
      setClips((cs) => cs.filter((x) => x.path !== c.path));
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
  };

  if (!clipsDir) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-cream-300">
        <CassetteSprite size={64} />
        <div className="font-display text-lg">no clips folder yet</div>
        <div className="font-mono text-xs text-cream-400 max-w-md text-center">
          choose where your samples should live and they'll appear here.
        </div>
        <button onClick={onPickDir} className="btn-pixel btn-crema mt-2">choose folder</button>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-cream-300">
        <CassetteSprite size={48} />
        <div className="font-display text-lg">no clips saved yet</div>
        <div className="font-mono text-xs text-cream-400">
          press <kbd className="px-1 py-0 bg-roast-700 border border-roast-900">[</kbd> to save the last 30s while playing.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {err && (
        <div className="mb-2 px-2 py-1 font-mono text-xs text-crema-400 border border-crema-700 bg-roast-900">
          {err}
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {clips.map((c) => (
          <li key={c.path} className="panel p-3 flex items-center gap-3">
            <CassetteSprite size={28} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-cream-100 truncate">{c.stationName}</div>
              <div className="font-mono text-xs text-cream-400 truncate">
                {new Date(c.createdAt).toLocaleString()} · {Math.round(c.durationSec)}s · {fmtSize(c.sizeBytes)}
              </div>
              <div className="font-mono text-[10px] text-cream-400/60 truncate">{c.fileName}</div>
            </div>
            <button
              onClick={() => remove(c)}
              className="btn-del"
              title="delete file"
              aria-label="delete clip"
            >
              <TrashSprite size={18} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtSize(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
