---
title: Desktop App (Tauri)
---

## Overview

The desktop shell lives in `frontend/corvale/src-tauri/` and wraps the existing Vite build with [Tauri v2](https://tauri.app). It reuses the same React app, routes, and local-first SQLite migrations as the browser build - the only new pieces are:

- `src-tauri/src/db.rs` - Rust commands (`db_open`, `db_exec`, `db_select`, `db_set_key`, `db_close`) that implement the same `LocalDb` contract as `frontend/corvale/src/db/SqliteWasmDriver.ts`, backed by `rusqlite` with SQLCipher instead of `@sqlite.org/sqlite-wasm` + OPFS.
- `frontend/corvale/src/db/TauriSqlDriver.ts` - the TypeScript side of that same contract, calling the Rust commands via `invoke()`.
- `src-tauri/src/backup.rs` - native "Save As" / "Open" file dialogs for backup export/import.
- `src-tauri/src/path_safety.rs` - filename validation shared by `db_open` (see [Where the local database lives](#where-the-local-database-lives)).
- `frontend/corvale/src/db/provisionLocalDb.ts` - one-shot local DB provisioning on first sign-in (see [Sign in once, then offline forever](#sign-in-once-then-offline-forever)).
- The auto-updater, configured in `tauri.conf.json`'s `plugins.updater` block.

This page is for building and running the desktop shell itself. For day-to-day frontend/backend development, see [Running Locally](../getting-started/running-locally.md).

## Prerequisites

Unlike the web app, the desktop build compiles native code, so it needs a Rust toolchain and platform build tools in addition to Node.js. Install these once per machine:

1. **Rust** - install via [rustup](https://rustup.rs). Verify with:
   ```
   rustc --version
   cargo --version
   ```
2. **Platform build tools**, per Tauri's [prerequisites guide](https://v2.tauri.app/start/prerequisites/):
   - **Windows** - "Desktop development with C++" workload from Visual Studio Build Tools, plus [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on current Windows 10/11).
   - **macOS** - Xcode Command Line Tools: `xcode-select --install`.
   - **Linux** - `webkit2gtk`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and standard build essentials (package names vary by distro - see the prerequisites guide above).
3. **Node.js dependencies** - from `frontend/corvale/`:
   ```bash
   npm install
   ```

The Rust dependency list (`src-tauri/Cargo.toml`) includes `rusqlite` with the `bundled-sqlcipher-vendored-openssl` feature, which compiles SQLCipher and its own OpenSSL from source rather than linking whatever's on the machine. This means **the first build is slow** (often 10+ minutes) - later builds only recompile what changed.

## First build

All commands run from `frontend/corvale/` (where `package.json`'s `tauri`/`tauri:dev`/`tauri:build` scripts live):

```bash
npm run tauri:dev
```

This starts the Vite dev server in `desktop` mode (`beforeDevCommand` in `tauri.conf.json` runs `npm run dev:desktop`, i.e. `vite --mode desktop`) and opens a native window pointed at it, with hot reload for the React side. Rust changes require restarting `tauri:dev`.

For a production build and installers:

```bash
npm run tauri:build
```

This runs `npm run build:desktop` (`vite build --mode desktop`) first, then compiles the Rust binary and produces platform installers under `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux).

The `desktop` Vite mode is what turns the local-first engine on for the desktop build without affecting the web build - see [Desktop build overrides](./environment-variables.md#desktop-build-overrides). A plain `npm run dev`/`npm run build` never touches `.env.desktop` and keeps `VITE_LOCAL_FIRST=false`.

## Smoke-testing a build

Before shipping, confirm the three things Sprint 13.11 exists to deliver:

1. **The app launches** - `tauri:build`'s installer (or `tauri:dev`) opens a window and the dashboard loads.
2. **`TauriSqlDriver` reads and writes correctly** - sign in, create an account and a transaction, quit, and relaunch. The data should still be there (it's a real file on disk - see below), confirming native SQLite persistence rather than an in-memory fallback.
3. **Native backup export succeeds** - Settings → Backup & restore → Export JSON should open a native OS save dialog, not a browser download.

### Where the local database lives

`db_open` (in `src-tauri/src/db.rs`) resolves the database path via Tauri's app-data directory resolver, not a path supplied by the frontend:

- **Windows** - `%APPDATA%\com.spndr.app\spndr.sqlite3`
- **macOS** - `~/Library/Application Support/com.spndr.app/spndr.sqlite3`
- **Linux** - `~/.local/share/com.spndr.app/spndr.sqlite3`

The frontend does still pass a `filename` (normally the default `spndr.sqlite3`), so
`src-tauri/src/path_safety.rs` validates it before it's joined onto that directory - rejecting
path separators, `..`, drive/UNC markers, and absolute paths - so the resolved file can never
land outside the app-data directory even if the calling frontend code were compromised.

## Content Security Policy

`tauri.conf.json`'s `app.security.csp` ships a strict policy (no `unsafe-eval`, no wildcard
sources, `object-src 'none'`) that Tauri injects into the bundled app at build time - it's
separate from the `<meta>` CSP tag `index.html` carries for the web build. `connect-src` allows
`https:` rather than one pinned origin, since the backend a self-hosted desktop build talks to
isn't known at packaging time, but plain `http://` origins are refused. `ipc:` and
`http://ipc.localhost` are also listed explicitly so `invoke()` calls into the Rust commands
above keep working.

## Sign in once, then offline forever

The first time someone signs in on a desktop install with local-first enabled, the app pulls a
full snapshot of their data from `/sync/bootstrap` and seeds every local table from it in one
transaction (`frontend/corvale/src/db/provisionLocalDb.ts`), rather than waiting for the same data
to trickle in through the incremental pull loop. That, plus the signed offline session grant
(see [Offline session grant](./environment-variables.md#offline-session-grant)), is what lets
the app be used indefinitely afterward with no network at all - the one online sign-in is the
only time it ever needs the internet. Signing in again on an already-provisioned device is a
no-op here; the regular sync engine takes over from there.

## Regenerating icons

App icons under `src-tauri/icons/` are generated from `public/pwa-512.png` (the same source as the PWA icons) via the Tauri CLI, which doesn't require a Rust build:

```bash
npm run tauri:icon
```

Re-run this if `public/pwa-512.png` changes.

## Configuring the auto-updater for a real release

`tauri.conf.json`'s `plugins.updater.pubkey` carries a real minisign public key (D1, SEC-05) - the app refuses to install an update it can't verify against this key. The matching private key is **not** committed; it lives only as a CI secret. To rotate it:

1. **Generate a new signing keypair:**
   ```bash
   npx @tauri-apps/cli signer generate -w ~/.tauri/spndr.key
   ```
   This prints a public key - paste it into `tauri.conf.json`'s `plugins.updater.pubkey`.
2. **Set the private key as an environment variable** before running `tauri:build` locally, so the build signs the release:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/spndr.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"
   ```
   For CI, the same two values go into the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets that `.github/workflows/release.yml` reads.
3. **Update the `endpoints` URL** in the same block if releases move to a different repository.

## Windows code-signing and macOS notarization (D1, SEC-05)

`tauri.conf.json`'s `bundle.windows.signCommand` and `bundle.macOS.signingIdentity`/`hardenedRuntime` are configured, but both still need real, paid-for credentials that only a human can obtain - a Windows OV/EV code-signing certificate and an Apple Developer Program enrollment. Until those exist, builds still succeed; they're just unsigned/ad-hoc-signed rather than trusted by Windows SmartScreen or Gatekeeper.

**Windows** - `bundle.windows.signCommand` runs `src-tauri/scripts/sign-windows.ps1 %1` for every installer file. That script calls `signtool.exe` using a certificate thumbprint from the `WINDOWS_CERTIFICATE_THUMBPRINT` environment variable, and fails loudly if it's unset rather than shipping an unsigned binary silently. In CI, `.github/workflows/release.yml` imports the certificate from two repository secrets before the build step runs:

- `WINDOWS_CERTIFICATE` - the `.pfx` certificate, base64-encoded
- `WINDOWS_CERTIFICATE_PASSWORD` - its export password

**macOS** - `bundle.macOS.signingIdentity` defaults to `"-"` (Tauri's ad-hoc signing pseudo-identity) with `hardenedRuntime: true`. `tauri-action` overrides the signing identity and drives notarization from environment variables when they're present, so no `tauri.conf.json` change is needed once a real identity exists - just add these repository secrets:

- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` - the Developer ID Application certificate, base64-encoded `.p12`, and its password
- `APPLE_SIGNING_IDENTITY` - the identity string from `security find-identity -v -p codesigning`
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` - an Apple ID with an app-specific password, and the team ID, for notarization

## Release process (D8)

Pushing a tag matching `v*.*.*` (e.g. `v0.14.0`) triggers `.github/workflows/release.yml`, which:

1. Extracts the matching `## [X.Y.Z]` section from the repository's root `CHANGELOG.md` for the release notes - rename `## [Unreleased]` to the version being tagged (with a date) before tagging, or the workflow falls back to whatever `[Unreleased]` still contains.
2. Builds installers for Windows, macOS (Apple Silicon and Intel), and Linux, signing each with whatever credentials are configured per the sections above.
3. Publishes a draft GitHub Release with the installers, the updater's `latest.json` (generated by `tauri-action`), and a `checksums-<platform>.sha256.txt` per platform, then combines those into one `checksums.sha256.txt` covering every installer.

The release is left as a **draft** - review the generated notes and attached artifacts, then publish it manually from GitHub. `/download`'s `frontend/corvale/src/data/releaseManifest.ts` still needs its checksums/URLs filled in by hand from the published release until that's wired to read the release automatically.

## Related pages

- [Desktop App Overview](../desktop/overview.md)
- [Running Locally](../getting-started/running-locally.md)
- [Project Structure](./project-structure.md)
- [Environment Variables](./environment-variables.md)
