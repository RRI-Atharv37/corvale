---
title: Getting the Desktop App
---

## Where to download it

Every spndr account has a **Get the desktop app** link in Settings that takes you to the in-app
`/download` page. You can also reach it directly, whether or not you're signed in.

The page detects the operating system you're browsing from and marks it **Recommended for your
device**, so you don't have to guess which installer is yours. Cards for the other two platforms
sit alongside it if you're downloading for a different machine.

## What's on the page

Each platform's card shows:

- The installer format for that platform (`.msi`/`.exe` on Windows, `.dmg` on macOS, `.deb`/`.rpm`/`.AppImage`
  on Linux)
- The system requirements for running spndr there
- A download button once a signed build for that platform is published

Below the platform cards, a **highlights** section lists what the current desktop release adds
over the web app - things like encrypted local storage and offline sign-in.

## Signed builds are still on the way

spndr's desktop installers aren't code-signed and notarized yet, so the download page currently
shows **Coming soon** on every platform card instead of a working download link. Once signed
builds start shipping, the same cards will switch to real download links along with a published
SHA-256 checksum for each installer, so you can verify a download matches what spndr actually
released before you run it.

In the meantime, the download page links out to the project's releases page, where you can watch
for the first signed build to land.

## Related pages

- [Desktop App Overview](./overview.md)
- [Automatic Updates](./auto-updates.md)
- [Building the Desktop App](../developers/desktop-app.md)
