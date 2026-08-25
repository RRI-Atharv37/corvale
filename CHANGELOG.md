# Changelog

All notable changes to spndr are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are tagged `vMAJOR.MINOR.PATCH`
in git and published via `.github/workflows/release.yml` (TODO.md D8).

Releases before this file existed are recorded only as git tags with no changelog entries — see
[TODO.completed.md](./TODO.completed.md) for what shipped in each phase.

Before tagging a release, rename `## [Unreleased]` below to `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`
and start a fresh `## [Unreleased]` section above it — the release workflow extracts the section
matching the pushed tag for the GitHub Release body.

## [Unreleased]
## [0.17.0] - 2026-08-25

### Added

- Real Tauri updater signing keypair (`plugins.updater.pubkey` in `tauri.conf.json`), replacing
  the committed placeholder (TODO.md D1, SEC-05)
- Windows code-signing (`bundle.windows.signCommand` invoking `src-tauri/scripts/sign-windows.ps1`)
  and macOS notarization configuration (`bundle.macOS.signingIdentity` + `hardenedRuntime`) in
  `tauri.conf.json` (TODO.md D1, SEC-05)
- Tagged-release workflow (`.github/workflows/release.yml`) that builds Windows/macOS/Linux
  installers, publishes SHA-256 checksums, and generates the updater's `latest.json` on GitHub
  Releases (TODO.md D8)

### Known limitations

- Installers are not OS-level code-signed: no Windows OV/EV certificate, no Apple Developer
  notarization. Decided 2026-08-25 as accepted risk for a portfolio/personal deployment rather
  than pursued — see `docs/desktop/download.md` for what the resulting "unknown publisher"
  warning looks like and how to get past it. `bundle.windows.signCommand` and
  `bundle.macOS.signingIdentity` pick up real credentials automatically if they're ever added as
  CI secrets (`docs/developers/desktop-app.md`), with no further code change needed.
