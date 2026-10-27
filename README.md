# MatchRadar 1.0.0

MatchRadar is a dark, compact Windows football widget built with Tauri 2, Rust and React. It follows Premier League scores and fixtures, keeps a local cache, and can stay in the system tray. The browser development view uses clearly marked sample data; the desktop app defaults to ESPN data.

**Status:** This repository is an implementation in progress, not a verified 1.0 release. The Windows installer and native integration have not been built or tested in the current environment. See limitations below.

## Requirements

Windows 10/11, Node.js and npm, Rust (stable), Microsoft C++ build tools, and WebView2. Follow the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

## Development

```powershell
npm install
npm run tauri dev
```

For the offline browser-only demo run `npm run dev`. The demo does not exercise native functionality.

```powershell
npm run lint
npm test
npm run build
cd src-tauri
cargo test
cd ..
npm run tauri build
```

The last command normally produces an NSIS installer under `src-tauri/target/release/bundle/nsis/`. Do not treat it as verified until it has been installed and tested on Windows.

## Data and privacy

ESPN's public JSON feed is unofficial and undocumented; format, access, rights and availability are not guaranteed. No account, API key, analytics or telemetry is used. Data and preferences are stored in the Tauri application data directory. Team logos, when returned, are loaded from ESPN's CDN; distribution and asset licensing must be reviewed before public release. Fallback badges work without logos.

## Known limitations

- Native compilation, installer, notifications, tray, startup and multi-monitor restoration require Windows verification. The current environment lacks Rust.
- ESPN date-range support could not be verified directly from this environment. The adapter requests the next 14 days; validate actual responses and coverage before relying on it.
- Match events and statistics are not integrated. Demo fixtures are static, and demo notification transitions are not simulated.
- Window off-screen recovery, sleep/resume detection, and HTTP-date `Retry-After` are not implemented. Notification deduplication and score correction handling need further validation.
- No release performance measurements or visual screenshots are available. Do not infer performance claims from the design.

See [architecture](docs/ARCHITECTURE.md), [provider notes](docs/DATA_PROVIDER.md), and [roadmap](docs/ROADMAP.md).
