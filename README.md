# Glo

> Listen to radio from around the world. If you hear something you want to keep, retroactively record the last 30 or 60 seconds.

A desktop radio app with a **rolling 60s buffer** — when something cool plays, hit `[` or `]` and you keep the last 30 s / 60 s as a WAV.

## Install

Grab a build for your OS from the [latest release](https://github.com/brawnyr/glo/releases/latest):

- **Windows** — `.msi` installer
- **macOS** — `.dmg` (Apple Silicon and Intel builds available)
- **Linux** — `.AppImage` or `.deb`

> Glo is currently unsigned. On first launch:
> - **Windows** will show a SmartScreen warning — click *More info → Run anyway*.
> - **macOS** will say the app "can't be opened" — right-click the app and choose *Open* the first time.

On first launch, Glo asks you to pick an existing folder where your clips should live. You can change it later via the picker in the clip library view.

## Use

- `Space` — play/pause
- `[` — save last 30 s
- `]` — save last 60 s
- `l` — clip library
- `f` — favorites
- `Esc` — back to all stations

Search, filter by country / language / genre, and the landing feed shuffles itself across genres each launch so you discover something different.

---

## Build from source

### Prerequisites

| | Windows | macOS | Linux |
|---|---|---|---|
| Node.js 20+ | ✓ | ✓ | ✓ |
| Rust (stable, via [rustup](https://rustup.rs)) | ✓ | ✓ | ✓ |
| Platform | WebView2 (preinstalled on Win11) | Xcode Command Line Tools | `webkit2gtk-4.1`, `libappindicator3`, `librsvg2`, `patchelf` |

On Ubuntu/Debian:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Run

```bash
git clone https://github.com/brawnyr/glo.git
cd glo
npm install
npm run tauri:dev
```

### Bundle

```bash
npm run tauri:build
```

Installers land in `src-tauri/target/release/bundle/`.

---

## How it works

### Rolling buffer
1. The HTML `<audio>` element plays the proxied radio stream.
2. An `AudioContext` taps the audio graph via `createMediaElementSource()`.
3. A custom AudioWorklet (`public/buffer-worklet.js`) keeps a circular Float32 stereo buffer of the last N seconds at the `AudioContext`'s sample rate.
4. On `[` or `]`, the worklet posts a contiguous slice back to the main thread.
5. The main thread encodes it as 16-bit PCM WAV and Rust writes it to your chosen folder.

### CORS / stream proxy
Most radio streams reject browser CORS. The Rust side spawns a Hyper server on a random localhost port that fetches the upstream stream with `reqwest` and pipes it back with permissive CORS. The webview points the `<audio>` element at `http://127.0.0.1:<port>/stream?url=<encoded>`.

### Stack
- **Tauri 2** (Rust backend + system webview)
- **Frontend**: React + TypeScript + Vite + Tailwind
- **Audio**: Web Audio API with a custom AudioWorklet circular buffer
- **Stations**: [radio-browser.info](https://api.radio-browser.info/) (free, no key)

### Layout
```
glo/
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
│   ├── components/             # Player, StationList, Sidebar, ClipLibrary, …
│   ├── hooks/useClipSampler.ts
│   ├── lib/{tauri.ts, settings.ts}
│   └── App.tsx
└── package.json
```

## Network & privacy

Glo makes outbound HTTPS calls to these endpoints only:

- **`*.api.radio-browser.info`** — to search stations, fetch the country/language/genre lists, and pick a working mirror at startup. When you start playing a station, Glo also pings `/json/url/{uuid}` so radio-browser's popularity ranking reflects your play. No account, no identifiers — just the station UUID.
- **The station's stream URL itself** — proxied through the local Rust process. Whatever host is behind the station you picked sees a streaming request from your IP.

There is no telemetry, analytics, crash reporting, or update-check phoning home. Everything else (favorites, clips, settings) is stored locally.

## License

[MIT](./LICENSE)
