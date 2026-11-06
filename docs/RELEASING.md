# Releasing

MatchRadar releases use a **locally built** NSIS installer as the downloadable asset. GitHub Actions validates pushes and tags, but its artifact is not used for the release asset unless explicitly chosen.

## Versioning

`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` must agree. The Settings screen reads the version from `package.json`.

```powershell
npm run check:version
```

The check also runs in `npm run verify:fast`, `scripts/build-local.ps1` and the Windows workflow. Bump all three files together (and refresh `src-tauri/Cargo.lock` by building) before tagging.

## Local release

1. Update `CHANGELOG.md` and the version in the three files; run `npm run check:version`.
2. Commit and push `main` normally.
3. Build and review:

   ```powershell
   .\scripts\release-local.ps1
   ```

   This runs the full local build (`scripts/build-local.ps1`), prints the installer path, size and SHA-256, and stops before publishing.

4. Publish the locally built asset (requires a clean tree, an unused tag and `gh` auth):

   ```powershell
   .\scripts\release-local.ps1 -SkipBuild -Publish
   ```

5. Verify the release page and download the asset once to confirm its SHA-256. Attach the checksum to release notes.

The script never force-pushes, merges, or builds through Actions. Creating a tag still triggers the automatic workflow; that run is validation/packaging only and does not replace the local asset.

## Before public distribution

These are product/legal decisions, not code steps:

- Sign the installer and review SmartScreen reputation.
- Choose a software license and review ESPN/crest/data redistribution rights.
- Complete the packaged Windows checklist in `VALIDATION.md` (notifications, tray, autostart, DPI, sleep/resume, monitor changes).
- Decide repository visibility and whether the private release becomes public.
