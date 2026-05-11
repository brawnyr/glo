import { Settings } from "../types";

const KEY = "radio-sampler:settings";

const DEFAULTS: Settings = {
  clipsDir: null,
  favorites: [],
  bufferSeconds: 60,
  volume: 0.85,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore quota
  }
}
