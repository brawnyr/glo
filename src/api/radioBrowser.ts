import type { Station } from "../types";

// radio-browser.info recommends picking a mirror at startup and sticking with it.
const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

let chosen: string | null = null;

async function pickMirror(): Promise<string> {
  if (chosen) return chosen;
  const shuffled = [...MIRRORS].sort(() => Math.random() - 0.5);
  for (const base of shuffled) {
    try {
      const r = await fetch(`${base}/json/stats`);
      if (r.ok) {
        chosen = base;
        return base;
      }
    } catch {
      // try next
    }
  }
  chosen = MIRRORS[0];
  return chosen;
}

const HEADERS = {
  "User-Agent": "Glo/0.1",
  "Content-Type": "application/x-www-form-urlencoded",
};

export type SearchParams = {
  name?: string;
  country?: string;
  countrycode?: string;
  language?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  hidebroken?: boolean;
  order?: "votes" | "clickcount" | "name" | "lastcheckok";
  reverse?: boolean;
};

export async function searchStations(params: SearchParams): Promise<Station[]> {
  const base = await pickMirror();
  const body = new URLSearchParams();
  if (params.name) body.set("name", params.name);
  if (params.country) body.set("country", params.country);
  if (params.countrycode) body.set("countrycode", params.countrycode);
  if (params.language) body.set("language", params.language);
  if (params.tag) body.set("tag", params.tag);
  body.set("limit", String(params.limit ?? 60));
  body.set("offset", String(params.offset ?? 0));
  body.set("hidebroken", String(params.hidebroken ?? true));
  body.set("order", params.order ?? "votes");
  body.set("reverse", String(params.reverse ?? true));

  const r = await fetch(`${base}/json/stations/search`, {
    method: "POST",
    headers: HEADERS,
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`stations/search ${r.status}`);
  return (await r.json()) as Station[];
}

// Buckets are fetched independently then round-robin merged. `weight` sets
// how many slots a bucket gets per cycle — trap and lofi double up because
// the user wants those dominating the top of the feed. `order` lets the
// "newness-skewed" buckets (trap/rap, bass) sort by recent clickcount instead
// of lifetime votes, which surfaces streams people are actively listening to.
type Bucket = {
  bucket: string;
  tags: string[];
  weight?: number;
  order?: "votes" | "clickcount";
};
const TASTE_BUCKETS: Bucket[] = [
  { bucket: "trap", tags: ["trap", "hip hop", "rap", "drill"], weight: 3, order: "clickcount" },
  { bucket: "lofi", tags: ["lofi", "lo-fi", "chillhop", "chillout"], weight: 3 },
  { bucket: "bass", tags: ["dubstep", "bass", "drum and bass", "dnb"], weight: 2, order: "clickcount" },
  { bucket: "classic", tags: ["classic rock", "psychedelic rock", "blues rock", "60s", "70s"], weight: 2 },
  { bucket: "blues", tags: ["blues", "delta blues"], weight: 1 },
  { bucket: "oldies", tags: ["soul", "funk", "rnb", "motown", "oldies"], weight: 1 },
];

// Non-music markers — dropped from the recommended feed.
const BLOCKED_TAG_SUBSTRINGS = [
  "talk", "news", "religious", "religion", "christian", "gospel", "islam", "islamic",
  "quran", "qur'an", "catholic", "bible", "sermon", "preach", "ministry", "spiritual",
  "podcast", "sports", "politics", "weather", "traffic", "evangel",
];
const BLOCKED_NAME_RE =
  /\b(talk|news|qur'?an|gospel|christian|catholic|bible|sermon|ministry|evangel|preach|islam|hadith|allah|jesus)\b/i;

function isMusicStation(s: Station): boolean {
  if (!s.lastcheckok) return false;
  const tags = (s.tags || "").toLowerCase();
  for (const bad of BLOCKED_TAG_SUBSTRINGS) {
    if (tags.includes(bad)) return false;
  }
  if (BLOCKED_NAME_RE.test(s.name || "")) return false;
  return true;
}

async function searchByTag(
  base: string,
  tag: string,
  limit: number,
  offset = 0,
  order: "votes" | "clickcount" = "votes",
): Promise<Station[]> {
  const body = new URLSearchParams();
  body.set("tag", tag);
  body.set("hidebroken", "true");
  body.set("limit", String(limit));
  body.set("offset", String(offset));
  body.set("order", order);
  body.set("reverse", "true");
  try {
    const r = await fetch(`${base}/json/stations/search`, {
      method: "POST",
      headers: HEADERS,
      body: body.toString(),
    });
    if (!r.ok) return [];
    return (await r.json()) as Station[];
  } catch {
    return [];
  }
}

export async function recommendedStations(limit = 80, page = 0): Promise<Station[]> {
  const base = await pickMirror();
  const perTag = 25;
  const tagOffset = page * perTag;
  // Per-call window into each bucket's top stations — keeps quality high
  // (always within top ~6 by votes) while rotating which station lands first.
  const WINDOW_START_MAX = 5;
  const windowStart = page === 0 ? Math.floor(Math.random() * WINDOW_START_MAX) : 0;

  const bucketResults = await Promise.all(
    TASTE_BUCKETS.map(async (b) => {
      const pools = await Promise.all(
        b.tags.map((t) => searchByTag(base, t, perTag, tagOffset, b.order)),
      );
      const seen = new Set<string>();
      const merged: Station[] = [];
      for (const pool of pools) {
        for (const s of pool) {
          if (seen.has(s.stationuuid)) continue;
          if (!isMusicStation(s)) continue;
          seen.add(s.stationuuid);
          merged.push(s);
        }
      }
      const sortKey: "clickcount" | "votes" = b.order === "clickcount" ? "clickcount" : "votes";
      merged.sort(
        (a, b2) =>
          (b2[sortKey] ?? 0) - (a[sortKey] ?? 0) ||
          (b2.bitrate ?? 0) - (a.bitrate ?? 0),
      );
      const trimmed = windowStart > 0 ? merged.slice(windowStart) : merged;
      return { stations: trimmed, weight: b.weight ?? 1 };
    })
  );

  // Shuffle bucket iteration order so the first slots aren't always in
  // fixed source order — but only on page 0; later pages stay stable so
  // pagination doesn't re-jumble what the user already scrolled past.
  if (page === 0) {
    bucketResults.sort(() => Math.random() - 0.5);
  }

  const picked = new Set<string>();
  const out: Station[] = [];
  // Per-bucket read cursors so weighted picks advance independently.
  const cursors = bucketResults.map(() => 0);
  let added = true;
  while (added && out.length < limit) {
    added = false;
    for (let i = 0; i < bucketResults.length; i++) {
      const { stations, weight } = bucketResults[i];
      for (let w = 0; w < weight; w++) {
        // Skip past already-picked stations (dupes across tag pools).
        while (cursors[i] < stations.length && picked.has(stations[cursors[i]].stationuuid)) {
          cursors[i]++;
        }
        if (cursors[i] >= stations.length) break;
        const next = stations[cursors[i]++];
        picked.add(next.stationuuid);
        out.push(next);
        added = true;
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function listCountries(): Promise<{ name: string; stationcount: number }[]> {
  const base = await pickMirror();
  const r = await fetch(`${base}/json/countries`, { headers: HEADERS });
  if (!r.ok) throw new Error(`countries ${r.status}`);
  return r.json();
}

export async function listLanguages(): Promise<{ name: string; stationcount: number }[]> {
  const base = await pickMirror();
  const r = await fetch(`${base}/json/languages`, { headers: HEADERS });
  if (!r.ok) throw new Error(`languages ${r.status}`);
  return r.json();
}

export async function listTopTags(limit = 80): Promise<{ name: string; stationcount: number }[]> {
  const base = await pickMirror();
  const r = await fetch(`${base}/json/tags?order=stationcount&reverse=true&limit=${limit}`, {
    headers: HEADERS,
  });
  if (!r.ok) throw new Error(`tags ${r.status}`);
  return r.json();
}

// Click ping — radio-browser uses these to rank popular stations.
export async function trackClick(uuid: string): Promise<void> {
  try {
    const base = await pickMirror();
    await fetch(`${base}/json/url/${uuid}`, { headers: HEADERS });
  } catch {
    // best-effort
  }
}
