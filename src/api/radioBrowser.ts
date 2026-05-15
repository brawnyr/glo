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

// Each bucket is fetched independently then round-robin merged so the top of
// the feed always shows genre variety instead of one tag dominating.
const TASTE_BUCKETS: { bucket: string; tags: string[] }[] = [
  { bucket: "trap", tags: ["trap", "hip hop", "rap", "drill"] },
  { bucket: "heavy", tags: ["metal", "heavy metal", "hard rock", "stoner rock", "doom metal"] },
  { bucket: "jazz", tags: ["jazz", "smooth jazz", "bebop", "jazz fusion"] },
  { bucket: "classic", tags: ["classic rock", "psychedelic rock", "blues rock", "60s", "70s"] },
  { bucket: "blues", tags: ["blues"] },
  { bucket: "electronic", tags: ["electronic", "house", "techno", "drum and bass", "edm", "ambient"] },
  { bucket: "lofi", tags: ["lofi", "lo-fi", "chillhop", "chillout"] },
  { bucket: "soul", tags: ["soul", "funk", "rnb", "neo soul", "motown"] },
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

async function searchByTag(base: string, tag: string, limit: number): Promise<Station[]> {
  const body = new URLSearchParams();
  body.set("tag", tag);
  body.set("hidebroken", "true");
  body.set("limit", String(limit));
  body.set("order", "votes");
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

export async function recommendedStations(limit = 80): Promise<Station[]> {
  const base = await pickMirror();
  const perTag = 25;

  const bucketResults = await Promise.all(
    TASTE_BUCKETS.map(async (b) => {
      const pools = await Promise.all(b.tags.map((t) => searchByTag(base, t, perTag)));
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
      merged.sort(
        (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0)
      );
      return merged;
    })
  );

  const picked = new Set<string>();
  const out: Station[] = [];
  let added = true;
  let idx = 0;
  while (added && out.length < limit) {
    added = false;
    for (const bucket of bucketResults) {
      const next = bucket[idx];
      if (!next) continue;
      if (picked.has(next.stationuuid)) continue;
      picked.add(next.stationuuid);
      out.push(next);
      added = true;
      if (out.length >= limit) break;
    }
    idx++;
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
