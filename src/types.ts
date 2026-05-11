export type Station = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  homepage: string;
  favicon: string;
  country: string;
  countrycode: string;
  language: string;
  tags: string;
  codec: string;
  bitrate: number;
  votes: number;
  clickcount: number;
  lastcheckok: number;
};

export type Clip = {
  fileName: string;
  path: string;
  stationName: string;
  durationSec: number;
  createdAt: number; // unix ms
  sizeBytes: number;
};

export type Settings = {
  clipsDir: string | null;
  favorites: string[]; // station uuids
  bufferSeconds: number; // 60 default
  volume: number; // 0-1
};

export type FilterState = {
  query: string;
  country: string;
  language: string;
  tag: string;
};
