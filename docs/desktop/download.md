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
- A download button once a build for that platform is published
- A SHA-256 checksum you can use to verify your download

Below the platform cards, a **highlights** section lists what the current desktop release adds
over the web app - things like encrypted local storage and offline sign-in.

## No download link yet

The download page currently shows **Coming soon** on every platform card - no build has been
published yet. In the meantime, the download page links out to the project's releases page, where
you can watch for the first build to land.

## About the "unknown publisher" warning

spndr is a personal/portfolio project rather than a commercially distributed product, so its
installers aren't digitally signed by a Windows or Apple certificate. That means your operating
system shows a warning the first time you run one:

- **Windows** shows "Windows protected your PC." Click **More info**, then **Run anyway**.
- **macOS** says the app "cannot be opened because the developer cannot be verified." Right-click
  (or Control-click) the app, choose **Open**, then confirm in the dialog that appears.

This warning is expected for software that isn't code-signed - it doesn't mean anything is wrong
with the download. Each release publishes a SHA-256 checksum alongside the installer so you can
independently confirm the file you downloaded matches what spndr actually released, if you'd like
extra reassurance before running it.

## Related pages

- [Desktop App Overview](./overview.md)
- [Automatic Updates](./auto-updates.md)
- [Building the Desktop App](../developers/desktop-app.md)
