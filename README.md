# Radio Sampler

> init, basic idea is to scan radio from all over the globe and generate loops that i find tasteful.

A desktop radio app with a **rolling 60s buffer** — when something cool plays, hit `[` or `]` and you keep the last 30 s / 60 s as a WAV. Coffee-pour pixel aesthetic (Animal-Well-ish — modern type, pixel-perfect sprites).

## Stack
- **Tauri 2** (Rust backend + webview frontend)
- **Frontend**: React + TypeScript + Vite + Tailwind
- **Audio**: Web Audio API with a custom AudioWorklet circular buffer
- **Stations**: [radio-browser.info](https://api.radio-browser.info/) (free, no key)

## How the rolling buffer works
1. The HTML `<audio>` element plays the proxied radio stream.
2. An `AudioContext` taps the audio graph via `createMediaElementSource()`.
3. A custom AudioWorklet (`public/buffer-worklet.js`) keeps a circular Float32 stereo buffer of the last N seconds at the `AudioContext`'s sample rate.
4. On `[` or `]`, the worklet posts a contiguous slice back to the main thread.
5. The main thread encodes it as 16-bit PCM WAV and Rust writes it to your chosen folder.

## CORS / stream proxy
Most radio streams reject browser CORS. The Rust side spawns a Hyper server on a random localhost port that fetches the upstream stream with `reqwest` and pipes it back with permissive CORS. The webview points the `<audio>` element at `http://127.0.0.1:<port>/stream?url=<encoded>`.

## Layout
```
radio-sampler/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs              # entry, state, command registry
│   │   ├── main.rs
│   │   ├── stream_proxy.rs     # Hyper-based CORS-bypass stream proxy
│   │   └── commands.rs         # save_clip, list_clips, pick dir, etc.
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   └── Cargo.toml
├── public/
│   └── buffer-worklet.js       # AudioWorklet circular buffer
├── src/
│   ├── api/radioBrowser.ts     # radio-browser.info client w/ mirror failover
│   ├── audio/
│   │   ├── rollingBuffer.ts    # main-thread interface to the worklet
│   │   └── wavEncoder.ts       # Float32 → PCM16 WAV
│   ├── components/
│   │   ├── Player.tsx
│   │   ├── StationList.tsx
│   │   ├── SampleControls.tsx
│   │   ├── ClipLibrary.tsx
│   │   └── Sidebar.tsx
│   ├── assets/pixel-sprites.tsx
│   ├── lib/{tauri.ts, settings.ts}
│   ├── App.tsx
│   └── main.tsx
└── package.json
```

## Run

```bash
npm install
npm run tauri dev
```

Release bundle:
```bash
npm run tauri build
```

## Keyboard
- `Space` — play/pause
- `[` — save last 30 s
- `]` — save last 60 s
- `l` — clip library
- `f` — favorites
- `Esc` — back to all stations

## Aesthetic notes
- Palette: espresso → cream gradient (`#0f0a07` → `#f4e8d0`) with crema-orange (`#d97f3c`) accents
- Inter for body, Pixelify Sans for headers, JetBrains Mono for metadata
- Pixel sprites only on the player (mug, vinyl, cassette, signal bars, heart)
- Cream-into-coffee dithered bleed at panel tops, scanlines on the player

## Notes / known limitations
- Placeholder icons live in `src-tauri/icons/` — swap them before shipping.
- WAVs are saved at the `AudioContext`'s sample rate (typically 48 kHz), not the stream's bitrate.
- The proxy runs on `127.0.0.1` only and blocks obvious-local upstreams to prevent SSRF.

## Out of scope (MVP)
- MP3 encoding (WAV only)
- Accounts / cloud sync
- Mobile builds
