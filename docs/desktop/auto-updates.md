---
title: Automatic Updates
---

## How updates work

The desktop app checks for a new version each time it starts. If one is available, a prompt appears at the bottom of the window showing the new version number.

1. Click **Install & Restart**.
2. spndr downloads the update, verifies it's a genuine, signed spndr release, and installs it.
3. The app restarts automatically on the new version.

You can keep working and click the prompt later - it doesn't interrupt what you're doing, and dismissing it just hides the prompt until the next launch.

## Why the verification step matters

Every update is cryptographically signed before release. The app only installs an update if that signature checks out, which prevents a tampered or corrupted download from ever being installed automatically.

## Related pages

- [Desktop App Overview](./overview.md)
- [Getting the Desktop App](./download.md)
- [Building the Desktop App](../developers/desktop-app.md)
