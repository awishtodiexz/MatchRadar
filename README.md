# MatchRadar 1.0.0

MatchRadar is a dark, compact Windows football widget built with Tauri 2, Rust and React. It follows Premier League scores and fixtures, keeps a local cache, and can stay in the system tray. The browser development view uses clearly marked sample data; the desktop app defaults to ESPN data.

**Status:** This repository is an implementation in progress, not a verified 1.0 release. Windows CI built an NSIS installer and passed the automated checks on commit `98b37df`; the installer and desktop integration have not yet been tested interactively. See limitations below.

## Requirements

To run the packaged app, use 64-bit Windows 10/11 and WebView2. Building from source also requires Node.js and npm, Rust (stable), and Microsoft C++ build tools. Follow the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

## Install and test the CI build

1. Sign in to GitHub with access to this private repository. Open the [successful Windows run](https://github.com/awishtodiexz/MatchRadar/actions/runs/40518537386) and download **matchradar-windows-installer** from its Artifacts section. Artifacts expire; choose a later successful Windows run if it is no longer available.
2. Extract the ZIP and run `MatchRadar_1.0.0_x64-setup.exe`. Follow the installer prompts and launch MatchRadar. This build has not been tested interactively; Windows may show a reputation prompt for an unsigned installer.
3. Check the dark panel against light and dark wallpapers, and at 100%, 125%, and 150% display scaling. Check text, badges, scrolling, keyboard focus, resizing, dragging, and reduced motion. Use Settings → App → Demo data for an offline visual check; verify the footer says **DEMO DATA**.
4. Hide the widget and restore it from the tray; open Settings from the tray and quit explicitly. Restart and check favorites, appearance, window position and size. Test launch at sign-in and single-instance behavior.
5. With demo mode disabled, check live fixtures and refresh, then disconnect the network and confirm cached data and the offline indicator. Check kickoff reminders, start alerts, goal alerts and the test notification with Windows notification permissions enabled. These behaviors are not verified by the CI build.
6. Test sleep/resume, a disconnected monitor, and uninstalling the app. Record any failures before considering the application ready for release.

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

- CI compiled the native app and produced an installer, but installation, notifications, tray, startup, display scaling and multi-monitor restoration require interactive Windows verification.
- ESPN's unofficial responses can change. Single-day and monthly responses were observed on 28 October 2026; verify live updates and fixture coverage in the packaged app.
- Match events and statistics are not integrated. Demo fixtures are static, and demo notification transitions are not simulated.
- Window off-screen recovery, sleep/resume detection, and HTTP-date `Retry-After` are not implemented. Notification deduplication and score correction handling need further validation.
- No release performance measurements or visual screenshots are available. Do not infer performance claims from the design.

See [architecture](docs/ARCHITECTURE.md), [provider notes](docs/DATA_PROVIDER.md), and [roadmap](docs/ROADMAP.md).
