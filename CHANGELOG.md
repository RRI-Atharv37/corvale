# Changelog

All notable changes to Corvale are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are tagged `vMAJOR.MINOR.PATCH`
in git and published via `.github/workflows/release.yml` (TODO.md D8).

Releases before this file existed are recorded only as git tags with no changelog entries — see
[TODO.completed.md](./TODO.completed.md) for what shipped in each phase.

Before tagging a release, rename `## [Unreleased]` below to `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`
and start a fresh `## [Unreleased]` section above it — the release workflow extracts the section
matching the pushed tag for the GitHub Release body.

## [Unreleased]

### Fixed

- **CSV import: locale-formatted dates and amounts read wrong.** The mapping step gains a **Date
  format** control (auto / year-first / month-first / day-first) and a slash-or-dot date that
  isn't a real calendar date is now a per-row error instead of being rolled forward to another
  month or year (`25/12/2026` was becoming 12 Jan 2028). Amounts are parsed regardless of the
  currency symbol or code around them (`€`, `£`, `₹`, `¥`, `INR …`), and the decimal separator is
  inferred, so a European `1.234,56` reads as `1234.56` rather than `1.23456` and Indian `1,00,000`
  grouping is handled. The preview step shows every parsed row before anything is saved.
- **Sync: account balances always sent in major units.** The `/sync` bootstrap, pull, and
  push-conflict responses now normalize `Account` opening/current balances to major-unit decimals,
  matching the REST `/accounts` contract, regardless of whether the account row has been converted
  to integer minor-unit storage. Without this, running the `migrate:account-balances` migration on
  a deployment with desktop/offline clients would have made every synced balance display 100x too
  large.
- **Desktop app: duplicate password-reveal / clear buttons.** WebView2 (Edge/Chromium) draws its
  own `::-ms-reveal` / `::-ms-clear` controls next to the app's own show/hide toggle. They are now
  suppressed globally in `index.css`; the web build (Chrome) never rendered them.
- **Desktop app: external links did nothing.** The header "Docs" link, the landing-page GitHub
  link, and the `/download` installer links silently no-opped inside the Tauri webview, which
  blocks `target="_blank"` navigation. External links now go through a shared `<ExternalLink>`
  component that hands the URL to the operating system's default browser via `tauri-plugin-opener`
  on desktop, and stays an ordinary new-tab anchor on the web.

## [1.0.2] - 2026-08-30

### Fixed

- **Desktop app: local store and sync were dead ("Failed to load local data", "Sync failed").**
  index.html's `<meta>` CSP is enforced alongside the CSP Tauri injects from `tauri.conf.json`
  (a page under two policies gets their intersection), and the meta policy — written for the web
  build — omitted `ipc: http://ipc.localhost` from `connect-src`, so every Tauri `invoke()` was
  blocked and `TauriSqlDriver` could never open the local SQLite database. The `desktop` Vite
  mode now widens the meta CSP to admit Tauri IPC, `'wasm-unsafe-eval'` (for the sqlite-wasm
  fallback driver), and `blob:` in `img-src` (receipt thumbnails render from object URLs);
  `tauri.conf.json`'s own CSP carries the same widenings. Web builds are unchanged.

## [1.0.1] - 2026-08-30

### Fixed

- **Desktop app could not reach the server.** The Tauri installer is built in CI, where the
  git-ignored `frontend/corvale/.env` does not exist, so `VITE_API_URL` fell back to its
  `http://localhost:5000` default and every install failed at sign-in with "Network Error" /
  "You're offline". The hosted backend URL (`https://api.corvale.app`), its origin, the docs URL,
  and the offline-grant public key now live in `.env.desktop` — the one env file the desktop
  build always reads (D4).

## [1.0.0] - 2026-08-29

Gate G3 (Production/GA) closed 2026-08-27; this is the first tagged release. Beyond the G3 work it
also carries the v1.0.0 go-live operational track — transactional email with a hard
email-verification gate, production hosting, and desktop/download update UX — and a second
full-project security audit (`SEC-27`–`SEC-37`, all fixed). The app is publishable and
advertisable per the launch-gate ladder.

### Added

- Full name and IANA timezone preference in Settings, wired to `User.timezone` (TODO.md X5)
- Transaction duplicate button, per-rule "generate drafts", and a Posted/Draft status filter on
  `/transactions` (TODO.md X4)
- Documented support process (`.github/SUPPORT.md`) and an incident-response runbook
  (`docs/developers/incident-response-runbook.md`) defining Sev-1/Sev-2/Sev-3 (TODO.md L14)
- **Opening balance can be dated.** An account's opening balance is now stated "as of" a date
  (`Account.openingBalanceDate`); transactions dated before it are informational only (reports and
  trends) and no longer move the current balance, so importing or back-filling history older than
  the account can't inflate it. Onboarding defaults the date to today; both the opening balance and
  its date are editable after creation, each triggering a balance recompute. An account with no
  date set keeps the previous "count everything" behaviour (TODO.md, Post-GA)
- **Desktop app: manual "Check for updates".** A button in Settings (desktop builds only) shows the
  installed version and checks on demand, with checking / up-to-date / update-available states, on
  top of the existing launch-time auto-update prompt (TODO.md V15)

### Changed

- **Renamed from spndr to Corvale.** The product, the repository contents, the desktop app, and
  the docs site are now "Corvale"; "spndr" collided with an unrelated live finance product. What
  this means in practice:
  - **You'll be signed out once.** Sign back in normally — no data is affected.
  - **Old backups and CSV exports still import.** Restore accepts the previous `spndr-backup.json`
    archive layout, and import still recognizes CSVs exported by older versions (reported as the
    legacy `spndr_export` format).
  - **Desktop users get a second install.** The app identifier changed, so the new version
    installs alongside the old one instead of upgrading it. Launch Corvale once and confirm your
    data is there, then uninstall the old "spndr" app manually. On first launch the desktop app
    copies its local database forward from the old location automatically.
  - **Self-hosters: update your config.** The default MongoDB database name in the examples
    changed from `spndr` to `corvale`, and the default refresh-token cookie name from
    `spndr_refresh` to `corvale_refresh`. Your existing data is still in whatever database your
    `MONGO_URI` currently points at — keep pointing at it, or rename the database deliberately.
    If `REFRESH_TOKEN_COOKIE_NAME` is set explicitly in your environment, the code default does
    not override it.
- **Licence changed from Apache-2.0 to the GNU AGPL v3.0 (`AGPL-3.0-or-later`).** Corvale stays
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
- **Email verification is now a hard gate.** Signing in with an unverified address is refused
  (`EMAIL_NOT_VERIFIED`) and issues no session until the address is confirmed; a fresh signup still
  lands on the in-app verify screen, and a blocked returning user can request a new link from the
  signed-out resend form. Password-reset and verification links now expire after **10 minutes**
  (previously 1 hour and 24 hours) (TODO.md V9)
- **Transactional email** sends through Resend from `no-reply@send.corvale.app`, with SPF, DKIM and
  DMARC published and verified; `SMTP_FROM` / `SMTP_REPLY_TO` defaults updated accordingly
  (TODO.md V9)
- **The web `/download` page is now self-updating.** It reads the published release from the
  backend (`GET /api/v1/desktop/release-manifest`, which proxies the GitHub Releases API and caches
  it) at runtime, instead of a hand-maintained manifest that had to be edited and redeployed for
  every release. The built-in manifest remains only as an offline fallback (TODO.md V16)

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

A second full-project security audit (Audit 2) ran before this release. All **11 findings
(`SEC-27`–`SEC-37`)** are fixed and committed; the cross-tenant / IDOR question the audit was
aimed at came back clean.

- Boot refuses to start with a placeholder or weak `JWT_SECRET` (`SEC-27`)
- Backup restore runs uploaded archives through the same validation/scan pipeline as receipt
  uploads (`SEC-28`)
- Legacy income/expense CSV exports escape spreadsheet formula-injection payloads, including after
  an embedded newline (`SEC-29`)
- Row-level security enforced on `Category`, `Tag`, `CategorizationRule`, `TransactionTemplate` and
  `SyncOperation`, and on the remaining query operations (`distinct`, `estimatedDocumentCount`,
  aggregation, …) (`SEC-30`, `SEC-36`)
- The shipped nginx config emits real security headers (`SEC-31`)
- Account-enumeration hardening, account-deletion completeness, and policy wording (`SEC-32`,
  `SEC-33`)
- Two latent injection / bypass traps removed (`SEC-34`, `SEC-35`)
- The bundled MongoDB service now requires authentication (`SEC-37`)

`SEC-04`/`SEC-06` (Tauri CSP, `db_open` path-traversal hardening) were already fixed in `v0.17.0`'s
cycle; this release corrects an internal tracking error that had continued to list them as open.
Installers still ship without OS-level code signing (`SEC-05`, accepted risk — see
`docs/desktop/download.md`).

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
