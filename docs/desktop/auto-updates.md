---
title: Automatic Updates
---

## How updates work

The desktop app checks for a new version each time it starts. If one is available, a prompt appears at the bottom of the window showing the new version number.

1. Click **Install & Restart**.
2. Corvale downloads the update, verifies it's a genuine, signed Corvale release, and installs it.
3. The app restarts automatically on the new version.

You can keep working and click the prompt later - it doesn't interrupt what you're doing, and dismissing it just hides the prompt until the next launch.

## Checking for updates manually

The automatic check only runs at startup, so if you leave the app open for days - or dismissed the prompt earlier - you can check again without restarting.

1. Open **Settings** from the top of the window.
2. Find the **Desktop app** section. It shows the version you're currently running.
3. Click **Check for updates**.

What you see next depends on the result:

- **You're on the latest version** - nothing to do.
- **A new version is available** - a **Install & Restart** button appears. It behaves exactly like the startup prompt: Corvale downloads the update, verifies its signature, installs it, and restarts on the new version.
- **The check couldn't complete** - usually a temporary network problem. Try again in a moment.

This section only appears in the desktop app, not the browser version.

## Why the verification step matters

Every update is cryptographically signed before release. The app only installs an update if that signature checks out, which prevents a tampered or corrupted download from ever being installed automatically.

## Related pages

- [Desktop App Overview](./overview.md)
- [Getting the Desktop App](./download.md)
- [Building the Desktop App](../developers/guides/desktop-app.md)
