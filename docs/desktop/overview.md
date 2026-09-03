---
title: Desktop App Overview
---

## Corvale, without a browser tab

The Corvale desktop app is the same Corvale you use online, packaged as a native application for Windows, macOS, and Linux. It's built with [Tauri](https://tauri.app), which wraps the web app in a small native shell instead of a full browser engine, so it stays lightweight.

The features work the same as the web app - transactions, budgets, savings goals, reports - with a few desktop-specific touches. The biggest one is genuine offline use: unlike the web app, the desktop app keeps a full local copy of your data and works with no connection.

- **Native SQLite storage.** Your local copy of your data is stored in a real SQLite database on disk (encrypted with SQLCipher), rather than in browser storage. The encryption key is unique to that device and kept in your operating system's secure key storage - so the database file on its own is unreadable if it's copied off the machine.
- **A real "Save As" dialog for backups.** Exporting a backup opens your operating system's native file-save window instead of triggering a browser download.
- **Automatic updates.** The app checks for new versions and offers to install them without a manual re-download.

## Installing

Download the installer for your platform from the project's releases page:

- **Windows** - `.msi` or `.exe` installer
- **macOS** - `.dmg` disk image
- **Linux** - `.deb`, `.rpm`, or `.AppImage`

Run the installer and launch Corvale like any other desktop application. The first launch asks you to sign in once while you're online, so it can download your data into the local database. You stay signed in after that - the app keeps your session in your operating system's keychain and refreshes it in the background, so it doesn't ask you to sign in again every time you open it.

## When to use it vs. the web app

Both are fully supported - use whichever fits your workflow. The desktop app is a good fit if you want Corvale to feel like a permanent fixture on your machine (a taskbar/dock icon, its own window) or if you prefer backups to go through a native file picker rather than your browser's downloads folder.

## Related pages

- [Getting the Desktop App](./download.md)
- [Automatic Updates](./auto-updates.md)
- [Backup and Restore Overview](../backup-restore/overview.md)
- [Building the Desktop App](../developers/guides/desktop-app.md)
