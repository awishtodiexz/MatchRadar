# Releasing MatchRadar

Releases are built and published by hand from a Windows machine with `scripts/release-local.ps1`. There is no CI publishing, code-signing setup or auto-updater.

## Prerequisites

- Node.js 22, stable Rust (MSVC) and Visual Studio Build Tools with the "Desktop development with C++" workload, as for `scripts/build-local.ps1`.
- The GitHub CLI (`gh`), signed in with permission to create releases.
- The version bumped in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (`node scripts/check-version.mjs` must pass), committed on `main` and pushed.

## Procedure

1. On a clean, up-to-date `main`, build and check: `powershell -ExecutionPolicy Bypass -File scripts/build-local.ps1`. Without `-SkipTests` on a clean tree it writes `src-tauri/target/release/bundle/nsis/verified-commit` with the commit and installer SHA-256.
2. Dry run: `powershell -ExecutionPolicy Bypass -File scripts/release-local.ps1 -SkipBuild`. It publishes nothing, prints the trust checks below and exits 1 if any fails.
3. Review the output. Every check must be `PASS`, and the `Signature` line must say what you expect.
4. Publish: rerun with `-SkipBuild -Publish`. It repeats all checks, refuses to publish if any fails, confirms `origin/main` equals HEAD and that the tag does not exist on `origin`, re-hashes the staged copy and creates the release and tag `v<version>` at HEAD with `gh release create`.
5. Download the asset from the release page and confirm its SHA-256 matches the notes.

## Trust checks

| Check                     | Passes when                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Checksum                  | The installer's SHA-256 and HEAD match the `verified-commit` stamp from a tested build.        |
| Clean tree                | `git status --porcelain` is empty.                                                             |
| Branch                    | The current branch is `main`.                                                                  |
| Tag matches version       | The tag is `v` plus the `package.json` version.                                                |
| Tag is new                | The tag does not exist yet; it is created at HEAD. Existing tags are never replaced.           |
| Installer newer than HEAD | The installer was written after the HEAD commit time.                                          |
| Authenticode              | `Get-AuthenticodeSignature` reports `Valid` or `NotSigned`. Any other state blocks publishing. |

## Signing status

MatchRadar installers are currently unsigned. The script reads the installer's real Authenticode state and never claims a signature it does not have:

- `NotSigned`: the output says `NOT SIGNED` and the release notes state that the installer is unsigned and that SmartScreen may warn.
- `Valid`: the output and notes name the signing certificate's subject.
- Anything else (for example `HashMismatch`): the signature is present but broken, and publishing is refused.

To run the checks against another file, such as a stand-in, pass `-InstallerPath <file>`. This works only without `-Publish`.
