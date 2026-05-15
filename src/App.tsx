import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import StationList from "./components/StationList";
import Player from "./components/Player";
import SampleControls from "./components/SampleControls";
import ClipLibrary from "./components/ClipLibrary";
import { recommendedStations, searchStations, trackClick } from "./api/radioBrowser";
import type { FilterState, Settings, Station } from "./types";
import { loadSettings, saveSettings } from "./lib/settings";
import { invoke, isTauri, listen } from "./lib/tauri";
import { RollingBuffer } from "./audio/rollingBuffer";
import { MugSprite } from "./assets/pixel-sprites";

type View = "all" | "favorites" | "library";

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [filter, setFilter] = useState<FilterState>({ query: "", country: "", language: "", tag: "" });
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<Station | null>(null);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [view, setView] = useState<View>("all");
  const [clipsRefresh, setClipsRefresh] = useState(0);
  const [clipCount, setClipCount] = useState(0);
  const [rb, setRb] = useState<RollingBuffer | null>(null);
  const [splash, setSplash] = useState<{ id: number; x: number; y: number } | null>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    (async () => {
      if (!(await isTauri())) return;
      try {
        const port = await invoke<number>("get_proxy_port");
        setProxyPort(port);
      } catch {
        setProxyPort(null);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (settings.clipsDir) return;
      if (!(await isTauri())) return;
      try {
        const dir = await invoke<string>("default_clips_dir");
        await invoke("ensure_dir", { path: dir });
        setSettings((s) => ({ ...s, clipsDir: dir }));
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      if (!(await isTauri())) return;
      try {
        unlisten = await listen<{ title: string }>("current-track", (e) => {
          setCurrentTrack(e.payload?.title || null);
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    setCurrentTrack(null);
  }, [current?.stationuuid]);

  useEffect(() => {
    (async () => {
      if (!settings.clipsDir || !(await isTauri())) {
        setClipCount(0);
        return;
      }
      try {
        const n = await invoke<number>("count_clips", { dir: settings.clipsDir });
        setClipCount(n);
      } catch {
        setClipCount(0);
      }
    })();
  }, [settings.clipsDir, clipsRefresh]);

  useEffect(() => {
    setLoading(true);
    recommendedStations(80)
      .then((rows) => setStations(rows))
      .catch(() => setStations([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (view !== "all") return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const isEmpty = !filter.query && !filter.country && !filter.language && !filter.tag;
    if (isEmpty) {
      setLoading(true);
      recommendedStations(80)
        .then((rows) => setStations(rows))
        .catch(() => setStations([]))
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    searchTimer.current = window.setTimeout(() => {
      searchStations({
        name: filter.query || undefined,
        country: filter.country || undefined,
        language: filter.language || undefined,
        tag: filter.tag || undefined,
        limit: 80,
        order: "votes",
        reverse: true,
      })
        .then((rows) => setStations(rows))
        .catch(() => setStations([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [filter, view]);

  const favoritesSet = useMemo(() => new Set(settings.favorites), [settings.favorites]);
  const visibleStations = useMemo(() => {
    if (view === "favorites") return stations.filter((s) => favoritesSet.has(s.stationuuid));
    return stations;
  }, [stations, view, favoritesSet]);

  const selectStation = useCallback((s: Station) => {
    setCurrent(s);
    trackClick(s.stationuuid);
  }, []);

  const toggleFav = useCallback((s: Station) => {
    setSettings((cur) => {
      const next = new Set(cur.favorites);
      if (next.has(s.stationuuid)) next.delete(s.stationuuid);
      else next.add(s.stationuuid);
      return { ...cur, favorites: Array.from(next) };
    });
  }, []);

  const pickDir = useCallback(async () => {
    if (!(await isTauri())) return;
    try {
      const chosen = await invoke<string | null>("pick_clips_dir");
      if (chosen) {
        await invoke("ensure_dir", { path: chosen });
        setSettings((s) => ({ ...s, clipsDir: chosen }));
      }
    } catch {
      // user cancelled
    }
  }, []);


  const triggerSplash = useCallback((ev?: { clientX: number; clientY: number }) => {
    const id = Date.now() + Math.random();
    setSplash({
      id,
      x: ev?.clientX ?? window.innerWidth / 2,
      y: ev?.clientY ?? window.innerHeight / 2,
    });
    window.setTimeout(() => {
      setSplash((s) => (s && s.id === id ? null : s));
    }, 900);
  }, []);

  const sampleLast = useCallback(
    async (seconds: number, fromEvent?: { clientX: number; clientY: number }) => {
      if (!rb || !current) return;
      if (!settings.clipsDir) {
        pickDir();
        return;
      }
      try {
        const snap = await rb.snapshot(seconds);
        if (snap.channels[0].length === 0) return;
        const { encodeWav } = await import("./audio/wavEncoder");
        const wav = encodeWav(snap.channels, snap.sampleRate);
        await invoke("save_clip", {
          args: {
            dir: settings.clipsDir,
            stationName: current.name,
            trackTitle: currentTrack || "",
            durationSec: snap.channels[0].length / snap.sampleRate,
            bytes: Array.from(wav),
          },
        });
        triggerSplash(fromEvent);
        setClipsRefresh((n) => n + 1);
      } catch (e) {
        console.error("sample failed", e);
      }
    },
    [rb, current, currentTrack, settings.clipsDir, pickDir, triggerSplash]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (e.key === " ") {
        e.preventDefault();
        const audio = document.querySelector("audio");
        if (audio) {
          if (audio.paused) audio.play().catch(() => {});
          else audio.pause();
        }
      } else if (e.key === "[") {
        e.preventDefault();
        sampleLast(30);
      } else if (e.key === "]") {
        e.preventDefault();
        sampleLast(60);
      } else if (e.key.toLowerCase() === "l") {
        setView("library");
      } else if (e.key.toLowerCase() === "f") {
        setView("favorites");
      } else if (e.key === "Escape") {
        setView("all");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sampleLast]);

  return (
    <div className="h-screen w-screen flex flex-col pour-bg relative overflow-hidden">
      <div className="haze pointer-events-none absolute inset-0 opacity-60" />

      <header className="relative px-4 py-2 flex items-center gap-3 border-b border-roast-900 z-10">
        <MugSprite size={24} />
        <div className="font-display text-cream-100 text-lg leading-none">Glo</div>
        <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400 leading-none">
          · pour something good
        </div>
        <div className="ml-auto">
          <SearchBox
            value={filter.query}
            onChange={(q) => {
              setFilter((f) => ({ ...f, query: q }));
              setView("all");
            }}
          />
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative z-10">
        <Sidebar
          filter={filter}
          onChange={setFilter}
          onShowAll={() => setView("all")}
          onShowFavorites={() => setView("favorites")}
          onShowLibrary={() => setView("library")}
          view={view}
          clipCount={clipCount}
          favoriteCount={settings.favorites.length}
        />

        <main className="flex-1 flex flex-col min-w-0 p-3 gap-3">
          <Player
            station={current}
            proxyPort={proxyPort}
            volume={settings.volume}
            currentTrack={currentTrack}
            onVolumeChange={(v) => setSettings((s) => ({ ...s, volume: v }))}
            onBufferReady={setRb}
          />

          <SampleControls
            rb={rb}
            station={current}
            clipsDir={settings.clipsDir}
            onPickDir={pickDir}
            onSample={(seconds, ev) => sampleLast(seconds, ev)}
          />

          <section className="flex-1 panel p-3 flex flex-col min-h-0 relative">
            <div className="absolute inset-x-0 top-0 h-6 cream-bleed pointer-events-none" />
            <div className="flex items-center gap-2 mb-2 relative">
              <div className="font-pixel text-xs uppercase tracking-widest text-cream-200">
                {view === "library" ? "clip library" : view === "favorites" ? "favorites" : "stations"}
              </div>
              <div className="font-mono text-[10px] text-cream-400">
                {view !== "library" ? `${visibleStations.length} stations` : `${clipCount} clips`}
              </div>
              <div className="ml-auto font-mono text-[10px] text-cream-400">
                <kbd className="px-1 bg-roast-800 border border-roast-900">space</kbd> play/pause ·{" "}
                <kbd className="px-1 bg-roast-800 border border-roast-900">[</kbd> save 30s ·{" "}
                <kbd className="px-1 bg-roast-800 border border-roast-900">]</kbd> save 60s ·{" "}
                <kbd className="px-1 bg-roast-800 border border-roast-900">l</kbd> library
              </div>
            </div>

            {view === "library" ? (
              <ClipLibrary
                clipsDir={settings.clipsDir}
                refreshKey={clipsRefresh}
                onPickDir={pickDir}
                onChanged={() => setClipsRefresh((n) => n + 1)}
              />
            ) : (
              <StationList
                stations={visibleStations}
                current={current}
                loading={loading}
                favorites={favoritesSet}
                onSelect={selectStation}
                onToggleFavorite={toggleFav}
              />
            )}
          </section>
        </main>
      </div>

      <div className="relative z-10 h-2 bg-gradient-to-t from-roast-700 via-roast-800/60 to-transparent" />

      {splash && (
        <div
          key={splash.id}
          className="pointer-events-none fixed z-50"
          style={{ left: splash.x - 40, top: splash.y - 40 }}
        >
          <div className="splash splash-1" />
          <div className="splash splash-2" />
          <div className="splash-drop" />
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        className="input-pixel w-72 pl-7"
        placeholder="search stations…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-pixel text-xs text-cream-400">/</span>
    </div>
  );
}
