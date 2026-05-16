import { useEffect, useMemo, useState } from "react";
import { listCountries, listLanguages, listTopTags } from "../api/radioBrowser";
import type { FilterState } from "../types";

type Props = {
  filter: FilterState;
  onChange: (next: FilterState) => void;
  onShowFavorites: () => void;
  onShowLibrary: () => void;
  onShowAll: () => void;
  view: "all" | "favorites" | "library";
  clipCount: number;
  favoriteCount: number;
};

export default function Sidebar({
  filter,
  onChange,
  onShowFavorites,
  onShowLibrary,
  onShowAll,
  view,
  clipCount,
  favoriteCount,
}: Props) {
  const [countries, setCountries] = useState<{ name: string; stationcount: number }[]>([]);
  const [languages, setLanguages] = useState<{ name: string; stationcount: number }[]>([]);
  const [tags, setTags] = useState<{ name: string; stationcount: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCountries(), listLanguages(), listTopTags(200)])
      .then(([c, l, t]) => {
        if (cancelled) return;
        setCountries(c.filter((x) => x.stationcount > 20).sort((a, b) => b.stationcount - a.stationcount));
        setLanguages(l.filter((x) => x.stationcount > 20).sort((a, b) => b.stationcount - a.stationcount));
        setTags(t.sort((a, b) => b.stationcount - a.stationcount));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [tagFocused, setTagFocused] = useState(false);
  const tagSuggestions = useMemo(() => {
    const q = filter.tag.toLowerCase().trim();
    if (!q) return tags.slice(0, 14);
    return tags.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 14);
  }, [filter.tag, tags]);

  return (
    <aside className="w-64 shrink-0 panel m-3 mr-0 p-4 flex flex-col gap-4 overflow-y-auto">
      <div>
        <div className="font-pixel text-xs uppercase tracking-widest text-cream-300 mb-2">Browse</div>
        <div className="flex flex-col gap-1">
          <NavBtn active={view === "all"} onClick={onShowAll}>
            <span>All stations</span>
          </NavBtn>
          <NavBtn active={view === "favorites"} onClick={onShowFavorites}>
            <span>Favorites</span>
            {favoriteCount > 0 && <Pill>{favoriteCount}</Pill>}
          </NavBtn>
          <NavBtn active={view === "library"} onClick={onShowLibrary}>
            <span>Clip library</span>
            {clipCount > 0 && <Pill>{clipCount}</Pill>}
          </NavBtn>
        </div>
      </div>

      <div>
        <div className="font-pixel text-xs uppercase tracking-widest text-cream-300 mb-2">Country</div>
        <select
          className="input-pixel w-full"
          value={filter.country}
          onChange={(e) => onChange({ ...filter, country: e.target.value })}
        >
          <option value="">Anywhere</option>
          {countries.slice(0, 60).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.stationcount})
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="font-pixel text-xs uppercase tracking-widest text-cream-300 mb-2">Language</div>
        <select
          className="input-pixel w-full"
          value={filter.language}
          onChange={(e) => onChange({ ...filter, language: e.target.value })}
        >
          <option value="">Any</option>
          {languages.slice(0, 50).map((l) => (
            <option key={l.name} value={l.name}>
              {l.name} ({l.stationcount})
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="font-pixel text-xs uppercase tracking-widest text-cream-300 mb-2">Genre</div>
        <div className="relative">
          <input
            className="input-pixel w-full pr-7"
            placeholder="search genres…"
            value={filter.tag}
            onChange={(e) => onChange({ ...filter, tag: e.target.value })}
            onFocus={() => setTagFocused(true)}
            onBlur={() => window.setTimeout(() => setTagFocused(false), 120)}
          />
          {filter.tag && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange({ ...filter, tag: "" })}
              className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 font-mono text-xs text-cream-400 hover:text-cream-200"
              title="clear genre"
            >
              ×
            </button>
          )}
          {tagFocused && tagSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-roast-800 border border-roast-900 shadow-lg max-h-72 overflow-y-auto">
              {tagSuggestions.map((t) => (
                <button
                  key={t.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ ...filter, tag: t.name });
                    setTagFocused(false);
                  }}
                  className="w-full text-left px-2 py-1 hover:bg-roast-700 flex items-center justify-between gap-2 font-mono text-xs"
                >
                  <span className="text-cream-200 truncate">{t.name}</span>
                  <span className="text-cream-400 text-[10px] tabular-nums shrink-0">{t.stationcount}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between text-left px-2 py-1.5 font-pixel text-sm uppercase tracking-wider transition-colors ${
        active
          ? "bg-roast-700 text-cream-100 border-l-2 border-crema-500"
          : "text-cream-300 hover:text-cream-100 border-l-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 px-1.5 py-0 text-[10px] font-mono text-roast-900 bg-cream-300 border border-roast-900 leading-tight">
      {children}
    </span>
  );
}

