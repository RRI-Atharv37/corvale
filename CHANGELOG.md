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

## [1.0.0] - 2026-08-27

Gate G3 (Production/GA) closes with this release — the app is publishable and advertisable per
the launch-gate ladder.

### Added

- Full name and IANA timezone preference in Settings, wired to `User.timezone` (TODO.md X5)
- Transaction duplicate button, per-rule "generate drafts", and a Posted/Draft status filter on
  `/transactions` (TODO.md X4)
- Documented support process (`.github/SUPPORT.md`) and an incident-response runbook
  (`docs/developers/incident-response-runbook.md`) defining Sev-1/Sev-2/Sev-3 (TODO.md L14)

### Changed

- **Licence changed from Apache-2.0 to the GNU AGPL v3.0 (`AGPL-3.0-or-later`).** spndr stays
  open source — the AGPL is an OSI-approved licence — and **self-hosting is unaffected**: you can
  still run it for free, modify it, and deploy it for yourself or your household. The only new
  obligation is that if you offer a *modified* version to other people over a network, you must
  publish your changes.

  **v1.0.0 is the first release under the AGPL.** Every earlier release — up to and including
  **v0.17.0** — was published under Apache-2.0, and that grant is irrevocable: those versions
  stay usable under Apache-2.0 forever, as does any commit obtained from this repository before
  the relicense.

  *(Mechanics: `LICENSE` replaced with the canonical AGPL v3 text; `license` fields set in all
  three workspace `package.json` files; README badge, docs footer and FAQ updated. Copyright
  ownership verified as 100% beforehand — 124 owner commits, 8 dependabot lockfile bumps. See
  TODO.md M0b and ROADMAP.md § Licensing.)*
- Account balances can now be stored in integer minor units (`Account.balanceUnit`), with a
  flag-gated, idempotent migration (`migrate:account-balances`); every balance read/write path is
  minor-units-aware (TODO.md C5)
- CSV export streams off a database cursor instead of buffering the full file in memory, for large
  date ranges (TODO.md C8)
- Sidebar/nav label for `/reports` is now "Reports & Analytics" (TODO.md X6)
- Recurring due dates now advance in the user's real timezone instead of a hardcoded UTC offset,
  fixing an hour of drift across DST transitions (TODO.md C6, BUG-06)

### Fixed

- A session-ending 401 now clears the signed-in user and redirects to `/login` with a notice,
  instead of leaving the dashboard rendering as a shell of erroring panels (TODO.md X1, BUG-07)
- Signing in now returns to the page you were trying to reach, including its query string, instead
  of always landing on `/dashboard` (TODO.md X2, BUG-04)
- One failing Reports request no longer blanks the entire `/reports` page — the other sections
  still render, with a scoped, retryable error on just the one that failed (TODO.md X3, BUG-05)
- Modal dialogs trap focus and restore it on close; form fields have proper label association;
  the password-visibility toggle is a real keyboard-operable button; filter tabs expose
  `aria-pressed` (TODO.md X7)
- Dashboard charts carry a text-alternative summary and loading states announce themselves to
  assistive tech (TODO.md X8)

### Security

None new this release. `SEC-04`/`SEC-06` (Tauri CSP, `db_open` path-traversal hardening) were
already fixed in `v0.17.0`'s cycle; this release corrects an internal tracking error that had
continued to list them as open.

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
