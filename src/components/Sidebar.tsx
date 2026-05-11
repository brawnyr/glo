import { useEffect, useState } from "react";
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
    Promise.all([listCountries(), listLanguages(), listTopTags(60)])
      .then(([c, l, t]) => {
        if (cancelled) return;
        setCountries(c.filter((x) => x.stationcount > 20).sort((a, b) => b.stationcount - a.stationcount));
        setLanguages(l.filter((x) => x.stationcount > 20).sort((a, b) => b.stationcount - a.stationcount));
        setTags(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
        <div className="flex flex-wrap gap-1">
          <TagChip active={filter.tag === ""} onClick={() => onChange({ ...filter, tag: "" })}>
            any
          </TagChip>
          {tags.slice(0, 30).map((t) => (
            <TagChip key={t.name} active={filter.tag === t.name} onClick={() => onChange({ ...filter, tag: t.name })}>
              {t.name}
            </TagChip>
          ))}
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

function TagChip({
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
      className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${
        active
          ? "bg-crema-500 text-roast-900 border-roast-900"
          : "bg-roast-800 text-cream-300 border-roast-900 hover:bg-roast-700"
      }`}
    >
      {children}
    </button>
  );
}
