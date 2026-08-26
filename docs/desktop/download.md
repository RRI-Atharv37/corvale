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

- The system requirements for running spndr there
- A download button for the recommended installer format on that platform (`.msi` on Windows,
  an Apple Silicon `.dmg` on macOS, `.deb` on Linux), along with its file size
- A SHA-256 checksum you can use to verify your download
- A **see all formats** toggle that reveals the other installer formats built for that platform,
  each with its own download link, file size, and checksum

## Choosing a format

Every desktop build ships more than one installer per platform, since not everyone wants the same
packaging:

- **Windows** - `.msi` is the recommended installer; a plain `.exe` is also available
- **macOS** - the Apple Silicon `.dmg` is recommended for current Macs; an Intel `.dmg` is
  available for older hardware
- **Linux** - `.deb` is the recommended package; `.rpm` and a portable `.AppImage` are also
  available

If you're not sure which one you need, the recommended download is the right choice for almost
everyone. Open **see all formats** on your platform's card only if you specifically need one of
the alternatives.

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
