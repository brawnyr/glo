import { useEffect, useRef } from "react";
import { Station } from "../types";
import { HeartSprite, SignalSprite } from "../assets/pixel-sprites";

type Props = {
  stations: Station[];
  current: Station | null;
  loading: boolean;
  favorites: Set<string>;
  onSelect: (s: Station) => void;
  onToggleFavorite: (s: Station) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
};

export default function StationList({
  stations,
  current,
  loading,
  favorites,
  onSelect,
  onToggleFavorite,
  onLoadMore,
  hasMore,
  loadingMore,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: root ?? null, rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onLoadMore, hasMore, stations.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-cream-300 font-pixel">
        <span className="caret">brewing</span>
      </div>
    );
  }
  if (stations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-cream-400 font-pixel">
        no stations — pour a different filter
      </div>
    );
  }
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {stations.map((s) => {
          const isPlaying = current?.stationuuid === s.stationuuid;
          const isFav = favorites.has(s.stationuuid);
          const tags = s.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 3);
          return (
            <li
              key={s.stationuuid}
              onClick={() => onSelect(s)}
              className={`group relative cursor-pointer panel p-3 flex items-start gap-3 transition-transform hover:-translate-y-0.5 ${
                isPlaying ? "ring-2 ring-crema-500" : ""
              }`}
            >
              <Favicon src={s.favicon} alt={s.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-display text-cream-100 text-base truncate">{s.name.trim() || "Untitled"}</div>
                  {isPlaying && (
                    <span className="font-pixel text-[10px] uppercase tracking-widest text-crema-400 animate-pulse-slow">
                      on air
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-xs text-cream-400 truncate">
                  {s.country || "—"}
                  {s.bitrate ? ` · ${s.bitrate}kbps` : ""}
                  {s.codec ? ` · ${s.codec.toLowerCase()}` : ""}
                </div>
                {tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <span key={t} className="px-1 py-0 text-[10px] font-mono text-cream-300 bg-roast-700 border border-roast-900">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(s);
                  }}
                  title={isFav ? "remove favorite" : "favorite"}
                  className="hover:scale-110 transition-transform"
                >
                  <HeartSprite filled={isFav} size={14} />
                </button>
                <SignalSprite size={12} level={signalLevel(s)} />
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div ref={sentinelRef} className="py-4 text-center text-cream-400 font-pixel text-xs">
          {loadingMore ? <span className="caret">brewing more</span> : ""}
        </div>
      )}
    </div>
  );
}

function signalLevel(s: Station): 0 | 1 | 2 | 3 | 4 {
  if (!s.lastcheckok) return 1;
  if (s.bitrate >= 192) return 4;
  if (s.bitrate >= 128) return 3;
  if (s.bitrate >= 64) return 2;
  return 1;
}

function Favicon({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="w-10 h-10 shrink-0 bg-roast-800 border-2 border-roast-900 flex items-center justify-center overflow-hidden">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-contain"
          style={{ imageRendering: "auto" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <span className="font-pixel text-[10px] text-cream-400">{alt.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}
