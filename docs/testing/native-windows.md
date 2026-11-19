# Native Windows acceptance (F3)

- **Date:** 2026-11-19 (UTC).
- **Base commit tested:** `94f309c48fd29af821f85853257ec5ab0b1c324d` (main).
- **Host:** Windows Server 2022 VM; one 1600×1200 virtual display, 100% / 96 DPI initially.
- **WebView2:** 131.0.2903.86.
- **Installer:** release NSIS `MatchRadar_1.0.0_x64-setup.exe`, built with MSVC 2022 / Rust; initial build 160.93 seconds, 3,964,259 bytes.
- **Ticker fix tested:** base plus the uncommitted frontend patch subsequently isolated on `devin/1795084735-ticker-restore`. Rebuilt and silently upgraded the same 1.0.0 installer; Rust release compilation 27.40 seconds. These fix results are not claims about main.

## Automated versus native checks

Automated: `cargo test --locked` **182 passed**, Clippy `--locked --all-targets -- -D warnings` passed; frontend `npm.cmd test` **294 passed / 32 files**, lint, format check, TypeScript/Vite build passed with the ticker patch. The PowerShell 5.1 idle sampler enumerated the installed process and WebView2 descendants, sampled counters and produced CSV/summary output. These checks do not establish visual correctness.

Native checks below were performed on the **installed executable**, using desktop interaction plus PowerShell/Win32 measurements (not browser preview). Tray Quit/relaunch and notification clicks were exercised manually. Hidden-soak transition used native WM_CLOSE and checked that the window hid. Installation and upgrades used NSIS silent mode.

## Checklist

Evidence images are compressed full-desktop captures; related checks share representative screenshots.

| Item                                                      | Result             | Evidence                                                                                 | Notes                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent installation                                       | PASS               | [Installed widget](native-windows/01-installed-data.jpg)                                 | Exit 0. Installed at `%LOCALAPPDATA%\MatchRadar\matchradar.exe`; Start Menu `%APPDATA%\Microsoft\Windows\Start Menu\Programs\MatchRadar.lnk`; uninstall entry HKCU `Software\Microsoft\Windows\CurrentVersion\Uninstall\MatchRadar`.           |
| Native ESPN data                                          | PASS               | [Fixtures](native-windows/01-installed-data.jpg)                                         | Upcoming fixtures and crests loaded, not demo data.                                                                                                                                                                                            |
| Tray show/hide, Settings, Quit; X close-to-tray           | PASS               | [Tray menu](native-windows/02-tray-menu.jpg)                                             | Single/double click and menu exercised. X preserved the process; tray Quit reduced process count to 0.                                                                                                                                         |
| Single instance, visible and hidden                       | PASS               | [Restored existing instance](native-windows/12-single-instance-hidden-restored.jpg)      | Second launch exited 0; one process remained and foreground PID matched it in both cases.                                                                                                                                                      |
| Ctrl+Shift+M                                              | PASS               | [Representative visible state](native-windows/12-single-instance-hidden-restored.jpg)    | Shortcut hid/restored the widget; screenshot is shared, not direct proof of the keystroke.                                                                                                                                                     |
| Test notification banner and installed identity           | PASS               | [Live toast](native-windows/15-toast-banner.jpg)                                         | MatchRadar name/icon, identity `com.matchradar.widget`, not PowerShell.                                                                                                                                                                        |
| Action Center retention; live versus archived click       | PASS               | [Action Center](native-windows/16-action-center.jpg)                                     | Live banner click restored the hidden widget. Archived click did not; documented Windows plugin limitation, not treated as a defect.                                                                                                           |
| Notifications disabled                                    | PASS               | [Requested, not delivered](native-windows/19-notifications-disabled-requested.jpg)       | Identity registry `Enabled=0` suppressed banner; UI still said requested. Restored `Enabled=1`.                                                                                                                                                |
| Focus Assist alarms-only                                  | PASS               | [Representative notification UI](native-windows/19-notifications-disabled-requested.jpg) | Focus Assist was available; alarms-only suppressed the banner. Restored Off. Image does not show the Focus Assist setting.                                                                                                                     |
| Real match alert                                          | NOT TESTABLE ON VM | —                                                                                        | No fixture within the reminder window at test time; no fabricated fixture or clock change.                                                                                                                                                     |
| Window position, size and compact layout restoration      | PASS               | [Compact restored](native-windows/24-compact-restored.jpg)                               | Moved/resized, Quit/relaunched; position and compact mode restored visually. Complete paired numeric before/after cache record was not retained.                                                                                               |
| Ticker restoration on main                                | FAIL               | [Original mismatch](native-windows/23-ticker-restore-failure.jpg)                        | Full UI reopened inside ticker-height window. See defect below.                                                                                                                                                                                |
| Ticker restoration with separate fix                      | PASS               | [Ticker restored](native-windows/30-ticker-restored.jpg)                                 | Relaunch: client 420×112 at 96 DPI, matching ticker UI. Expand: 390×700; second full-mode Quit/relaunch: 390×700, unclipped.                                                                                                                   |
| Off-screen saved position                                 | PASS               | [Recovered](native-windows/29-offscreen-recovered-dpi-restored.jpg)                      | While quit, set `main.x=5000` in window cache; relaunch recovered into work area, outer rect (52,52)–(620,1042).                                                                                                                               |
| Autostart registration and simulated sign-in              | PASS               | [Startup settings](native-windows/25-autostart-settings.jpg)                             | HKLM Run value `MatchRadar`: `C:\Users\Administrator\AppData\Local\MatchRadar\matchradar.exe --hidden`. With Start hidden enabled, exact command started tray-only, no window. Restored disabled; HKLM/HKCU values absent, Start hidden false. |
| Real sign-out/sign-in                                     | NOT TESTABLE ON VM | —                                                                                        | Would disrupt session; no sign-out or reboot performed.                                                                                                                                                                                        |
| Live 100%→125%, drag-full-windows off                     | FAIL               | [Clipped](native-windows/33-dpi-125-drag-off.jpg)                                        | Controlled repro on new install. Tao 0.37.2 branch; physical measurements below.                                                                                                                                                               |
| Live 100%→125%, drag-full-windows on                      | PASS               | [Unclipped](native-windows/35-dpi-125-drag-on.jpg)                                       | Relaunched after enabling setting; same-monitor comparison. No DPI fix applied.                                                                                                                                                                |
| Mixed-DPI, physical monitor detach/reattach, sleep/resume | NOT TESTABLE ON VM | —                                                                                        | One virtual display; physical display/power-cycle scenarios not exercised.                                                                                                                                                                     |

## Idle soak

Two sequential 30-minute runs on the original installed build: visible 09:32:17–10:02:17 UTC; hidden 10:02:19–10:32:19 UTC. **Thirty minutes is not a long soak** and does not establish absence of leaks.

Memory values are MiB; slope is least-squares MiB/hour. Each memory cell lists start / end / min / max / mean.

| Mode    | Working set                                     | Private bytes                                   | WS / private slope | CPU mean / p95, normalized |
| ------- | ----------------------------------------------- | ----------------------------------------------- | ------------------ | -------------------------- |
| Visible | 324.332 / 191.621 / 186.379 / 324.332 / 194.959 | 115.102 / 121.176 / 114.984 / 121.707 / 118.041 | -61.934 / +11.431  | 0.0000% / 0.0000%          |
| Hidden  | 204.391 / 188.133 / 185.230 / 204.391 / 187.698 | 121.777 / 122.820 / 121.641 / 123.773 / 122.491 | -7.360 / +0.964    | 0.0000% / 0.0000%          |

CPU values are sampled counter deltas, not a claim of literally no execution. Final CPU between a process's last observation and exit cannot be recovered; CSV flags exited processes. Visible run had 68 rows (short endpoint samples), hidden 61. Raw CSVs and summaries are local, ignored under `verification/native/results/`.

## Defects found

### Ticker UI/size mismatch — fixed on separate branch

Repro on main: enter ticker → tray Quit → relaunch. Window-state restores the native short size (`src-tauri/src/main.rs:820`), while `src/App.tsx:70` initializes session-only ticker state to false. Thus full UI renders at ticker height.

Fix branch: `devin/1795084735-ticker-restore`. Small frontend hook persists one localStorage boolean, restores ticker sizing, and falls back to configured 390×700 on expansion after relaunch. Rust snapshot/settings files are untouched. Five focused hook tests; native fixed-path checks passed above.

### Live DPI clipping — not fixed

Repro: full widget at default size, Windows “Show window contents while dragging” **off**, change scaling live from 100% to 125%. Right side clips. Restore 100%, enable that setting via SPI_SETDRAGFULLWINDOWS with broadcast, relaunch, repeat: no clipping.

Measurements use a per-monitor-aware Win32 caller; client/outer dimensions are physical pixels:

| Setting | Before DPI / client / outer | After DPI / client / outer |
| ------- | --------------------------- | -------------------------- |
| Off (0) | 96 / 390×700 / 406×708      | 120 / 372×691 / 390×700    |
| On (1)  | 96 / 390×700 / 406×708      | 120 / 470×866 / 488×875    |

Controlled comparison confirms the setting-dependent Tao 0.37.2 `src/platform_impl/windows/event_loop.rs:1926–1927` WM_DPICHANGED branch: when dragging contents is disabled, it replaces the scaled size with the old physical inner size. The off-case viewport becomes 297.6 logical pixels wide, below `src/styles.css` body min-width 320; overflow is hidden. App's scale-change handler only runs placement/max-size recovery, not logical-size repair. Frontend ticker and Rust compact calls use LogicalSize; physical window-state restoration is a startup operation, not the live trigger.

Restored original drag setting (off), 100% / 96 DPI, full client 390×700. Installed fixed app left running and visible.

## How to rerun

From repo root, initialize MSVC and build in PowerShell:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64"
New-Item -ItemType Directory -Force src-tauri/target/.build-temp | Out-Null
$env:TEMP = "$pwd\src-tauri\target\.build-temp"
$env:TMP = $env:TEMP
npm.cmd run tauri build
```

Tray Quit any running instance before upgrading. Then:

```powershell
Start-Process "src-tauri\target\release\bundle\nsis\MatchRadar_1.0.0_x64-setup.exe" -ArgumentList "/S" -Wait
Start-Process "$env:LOCALAPPDATA\MatchRadar\matchradar.exe"
New-Item -ItemType Directory -Force verification/native/results | Out-Null
# Allow two minutes of warm-up first; keep widget visible and do not interact.
./verification/native/idle-soak.ps1 -DurationMinutes 30 -IntervalSeconds 30 -OutCsv verification/native/results/visible.csv
# Hide with X, then repeat without interacting.
./verification/native/idle-soak.ps1 -DurationMinutes 30 -IntervalSeconds 30 -OutCsv verification/native/results/hidden.csv
```

Sampler requires PowerShell 5.1, no external dependencies, and refuses to overwrite an existing CSV. Repeat native checklist manually on the installed executable. Restore notification/startup/display settings afterward.
