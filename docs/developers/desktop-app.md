---
title: Desktop App (Tauri)
---

## Overview

The desktop shell lives in `frontend/spndr/src-tauri/` and wraps the existing Vite build with [Tauri v2](https://tauri.app). It reuses the same React app, routes, and local-first SQLite migrations as the browser build - the only new pieces are:

- `src-tauri/src/db.rs` - Rust commands (`db_open`, `db_exec`, `db_select`, `db_set_key`, `db_close`) that implement the same `LocalDb` contract as `frontend/spndr/src/db/SqliteWasmDriver.ts`, backed by `rusqlite` with SQLCipher instead of `@sqlite.org/sqlite-wasm` + OPFS.
- `frontend/spndr/src/db/TauriSqlDriver.ts` - the TypeScript side of that same contract, calling the Rust commands via `invoke()`.
- `src-tauri/src/backup.rs` - native "Save As" / "Open" file dialogs for backup export/import.
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
3. **Node.js dependencies** - from `frontend/spndr/`:
   ```bash
   npm install
   ```

The Rust dependency list (`src-tauri/Cargo.toml`) includes `rusqlite` with the `bundled-sqlcipher-vendored-openssl` feature, which compiles SQLCipher and its own OpenSSL from source rather than linking whatever's on the machine. This means **the first build is slow** (often 10+ minutes) - later builds only recompile what changed.

## First build

All commands run from `frontend/spndr/` (where `package.json`'s `tauri`/`tauri:dev`/`tauri:build` scripts live):

```bash
npm run tauri:dev
```

This starts the Vite dev server (`beforeDevCommand` in `tauri.conf.json`) and opens a native window pointed at it, with hot reload for the React side. Rust changes require restarting `tauri:dev`.

For a production build and installers:

```bash
npm run tauri:build
```

This runs `npm run build` (the Vite production build) first, then compiles the Rust binary and produces platform installers under `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux).

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

## Regenerating icons

App icons under `src-tauri/icons/` are generated from `public/pwa-512.png` (the same source as the PWA icons) via the Tauri CLI, which doesn't require a Rust build:

```bash
npm run tauri:icon
```

Re-run this if `public/pwa-512.png` changes.

## Configuring the auto-updater for a real release

`tauri.conf.json`'s `plugins.updater` block ships with two placeholders that must be replaced before a real release:

1. **Generate a signing keypair:**
   ```bash
   npx @tauri-apps/cli signer generate -w ~/.tauri/spndr.key
   ```
   This prints a public key - paste it into `tauri.conf.json`'s `plugins.updater.pubkey`, replacing `REPLACE_WITH_KEY_FROM_TAURI_SIGNER_GENERATE`.
2. **Set the private key as an environment variable** before running `tauri:build`, so the build signs the release:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/spndr.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"
   ```
3. **Update the `endpoints` URL** in the same block if releases aren't published to the GitHub repository referenced by the placeholder.

`tauri:build` also produces a `latest.json` manifest alongside the installers - upload it together with the installers to whatever the `endpoints` URL points at (a GitHub release matching that URL works with no extra setup, since `tauri:build`'s output format is what the updater plugin expects there).

Keep the private key out of version control - store it as a CI secret for automated releases.

## Related pages

- [Desktop App Overview](../desktop/overview.md)
- [Running Locally](../getting-started/running-locally.md)
- [Project Structure](./project-structure.md)
- [Environment Variables](./environment-variables.md)
