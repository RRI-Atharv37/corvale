---
title: Desktop App Overview
---

## spndr, without a browser tab

The spndr desktop app is the same spndr you use online, packaged as a native application for Windows, macOS, and Linux. It's built with [Tauri](https://tauri.app), which wraps the web app in a small native shell instead of a full browser engine, so it stays lightweight.

Everything works the same as the web app - transactions, budgets, savings goals, reports, and offline local-first storage - with a few desktop-specific touches:

- **Native SQLite storage.** Your local, offline copy of your data is stored in a real SQLite database on disk (encrypted with SQLCipher), rather than in browser storage.
- **A real "Save As" dialog for backups.** Exporting a backup opens your operating system's native file-save window instead of triggering a browser download.
- **Automatic updates.** The app checks for new versions and offers to install them without a manual re-download.

## Installing

Download the installer for your platform from the project's releases page:

- **Windows** - `.msi` or `.exe` installer
- **macOS** - `.dmg` disk image
- **Linux** - `.deb`, `.rpm`, or `.AppImage`

Run the installer and launch spndr like any other desktop application. The first launch walks you through the same sign-in and PIN setup as the web app.

## When to use it vs. the web app

Both are fully supported - use whichever fits your workflow. The desktop app is a good fit if you want spndr to feel like a permanent fixture on your machine (a taskbar/dock icon, its own window) or if you prefer backups to go through a native file picker rather than your browser's downloads folder.

## Related pages

- [Getting the Desktop App](./download.md)
- [Automatic Updates](./auto-updates.md)
- [Backup and Restore Overview](../backup-restore/overview.md)
- [Building the Desktop App](../developers/desktop-app.md)
