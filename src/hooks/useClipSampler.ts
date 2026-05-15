import { useCallback } from "react";
import { RollingBuffer } from "../audio/rollingBuffer";
import { invoke } from "../lib/tauri";
import type { Station } from "../types";

export type ClipSamplerParams = {
  rb: RollingBuffer | null;
  station: Station | null;
  currentTrack: string | null;
  clipsDir: string | null;
  // Called when there is no clipsDir set — caller decides how to prompt.
  onMissingDir?: () => void;
  // Called after a successful save. Receives the click coords from the
  // triggering event (if any) so the caller can position a splash effect.
  onClipSaved?: (fromEvent?: { clientX: number; clientY: number }) => void;
};

export type ClipSampler = {
  sample: (seconds: number, fromEvent?: { clientX: number; clientY: number }) => Promise<void>;
};

export function useClipSampler({
  rb,
  station,
  currentTrack,
  clipsDir,
  onMissingDir,
  onClipSaved,
}: ClipSamplerParams): ClipSampler {
  const sample = useCallback(
    async (seconds: number, fromEvent?: { clientX: number; clientY: number }) => {
      if (!rb || !station) return;
      if (!clipsDir) {
        onMissingDir?.();
        return;
      }
      try {
        const snap = await rb.snapshot(seconds);
        if (snap.channels[0].length === 0) return;
        const { encodeWav } = await import("../audio/wavEncoder");
        const wav = encodeWav(snap.channels, snap.sampleRate);
        await invoke("save_clip", {
          args: {
            dir: clipsDir,
            stationName: station.name,
            trackTitle: currentTrack || "",
            durationSec: snap.channels[0].length / snap.sampleRate,
            bytes: Array.from(wav),
          },
        });
        onClipSaved?.(fromEvent);
      } catch (e) {
        console.error("sample failed", e);
      }
    },
    [rb, station, currentTrack, clipsDir, onMissingDir, onClipSaved]
  );

  return { sample };
}
