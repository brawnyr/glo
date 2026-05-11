import type { Station } from "../types";

// radio-browser.info has multiple mirror servers. Pick one at startup
// and stick with it (recommended pattern from their docs).
const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

let chosen: string | null = null;

async function pickMirror(): Promise<string> {
  if (chosen) return chosen;
  // Try each mirror in a randomized order
  const shuffled = [...MIRRORS].sort(() => Math.random() - 0.5);
  for (const base of shuffled) {
    try {
      const r = await fetch(`${base}/json/stats`, { method: "GET" });
      if (r.ok) {
        chosen = base;
        return base;
      }
    } catch {
      // try next
    }
  }
  // fallback — let the call fail visibly
  chosen = MIRRORS[0];
  return chosen;
}

const HEADERS = {
  "User-Agent": "RadioSampler/0.1",
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

export async function topStations(limit = 60): Promise<Station[]> {
  const base = await pickMirror();
  const r = await fetch(`${base}/json/stations/topvote/${limit}`, {
    headers: HEADERS,
  });
  if (!r.ok) throw new Error(`topvote ${r.status}`);
  return (await r.json()) as Station[];
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

/** Ping radio-browser to let them know a station was clicked (non-fatal). */
export async function trackClick(uuid: string): Promise<void> {
  try {
    const base = await pickMirror();
    await fetch(`${base}/json/url/${uuid}`, { headers: HEADERS });
  } catch {
    // ignore — analytics ping only
  }
}
