# MatchRadar 1.0.0

MatchRadar is a compact Windows football widget, dark by default with an optional light theme, built with Tauri 2, Rust and React. It follows Premier League scores and fixtures, keeps a local cache, and can stay in the system tray. The browser development view uses clearly marked sample data; the desktop app defaults to ESPN data.

**Status:** This repository is an implementation in progress, not a verified 1.0 release. Earlier Windows installers built successfully, and the user has tested installation, launch, and fixture display. The revised window controls, themes, compact sizing, and settings behavior need a fresh packaged Windows check; automated tests and browser rendering do not verify those OS integrations. See limitations below.

## Requirements

To run the packaged app, use 64-bit Windows 10/11 and WebView2. Building from source also requires Node.js and npm, Rust (stable), and Microsoft C++ build tools. Follow the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

## Install and test the CI build

1. Sign in to GitHub with access to this private repository. Open [Windows validation runs](https://github.com/awishtodiexz/MatchRadar/actions/workflows/windows.yml), select a successful run for the intended PR #1 commit, and download **matchradar-windows-installer** from Artifacts. Check the commit SHA; an older successful build does not include newer fixes. Artifacts expire.
2. Quit any running MatchRadar instance from its tray menu, extract the ZIP, and run `MatchRadar_1.0.0_x64-setup.exe`. Launch the updated app. Windows may show a reputation prompt for this unsigned installer. No public release is required.
3. Click minus: the widget should minimize and restore through its taskbar button. Click X: it should hide and restore through the tray's Show / Hide action. Check that a second launch restores the existing window, and Quit exits the process.
4. Use the footer Settings button. Verify pin and eye toggle Always on top and Following only, respectively, and stay synchronized with Settings. Change favorites, restart, and confirm persistence; older saved favorites should still refer to the clubs originally selected.
5. In Appearance, test Dark and Light at 70% and 100% opacity against contrasting wallpapers. Inspect home, Teams, and match details at 390px and 320px width and 100%, 125%, and 150% scaling. Text should remain opaque, only content should scroll, and the footer should remain visible. Check keyboard focus and reduced motion.
6. Resize the expanded widget, enable Compact view, then disable it: the smaller window should restore the previous expanded dimensions. Restart while compact and repeat. Changing theme, opacity, pin, or filters should not trigger a data refresh or change the last-updated time; a scheduled refresh may occur independently.
7. Check Fulham and West Ham crests in Teams even without current fixtures. With demo mode disabled, verify fixtures and Refresh, then disconnect the network and confirm cached data and the offline indicator. Use the explicitly labeled Demo data mode for repeatable layout checks only.
8. Test notifications with Windows permissions enabled, autostart, sleep/resume, monitor disconnection, and uninstall. Record failures before considering the application ready for release. See [runtime validation notes](docs/VALIDATION.md) for the evidence boundary.

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

- Earlier installers launched and displayed fixtures in user testing. The revised native controls, compact restoration, notifications, startup, display scaling, and multi-monitor restoration need packaged Windows verification.
- ESPN's unofficial responses can change. Single-day and monthly responses were observed on 28 October 2026; verify live updates and fixture coverage in the packaged app.
- Match events and statistics are not integrated. Demo fixtures are static, and demo notification transitions are not simulated.
- Window off-screen recovery, sleep/resume detection, and HTTP-date `Retry-After` are not implemented. Notification deduplication and score correction handling need further validation.
- No release performance measurements are available. Browser layout checks are not evidence of native window behavior or memory/CPU performance.

See [architecture](docs/ARCHITECTURE.md), [provider notes](docs/DATA_PROVIDER.md), and [roadmap](docs/ROADMAP.md).
