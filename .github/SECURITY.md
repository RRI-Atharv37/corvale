# Security Policy

Corvale handles personal financial data - transaction history, account balances, and receipt
images. If you have found a vulnerability, please report it privately using the process below.

## Supported versions

Security fixes are made against the **latest release** and deployed to the hosted service at
corvale.app. Older versions are not patched. That includes every release before v1.0.0, which were
published as "spndr" under the Apache-2.0 licence.

The latest release is on the [Releases page](https://github.com/RRI-Atharv37/corvale/releases/latest),
and the desktop app's built-in updater reads from it. If you run your own instance, run the latest
release and update when an advisory is published.

## Reporting a vulnerability

**Please do not open a public GitHub issue, discussion, or pull request for a security
vulnerability.** Publicly disclosing an unpatched issue puts every user at risk.

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab, then
**Report a vulnerability** ([direct link](https://github.com/RRI-Atharv37/corvale/security/advisories/new)).
This opens a private draft security advisory visible only to the maintainer - nothing is public
until a fix ships and the advisory is published.

If you cannot use GitHub's private reporting (for example, you have no GitHub account), email
**security@corvale.app** instead. The same policy applies. Email is not end-to-end encrypted, so
keep the first message to a description of the problem and leave out working exploit code and
anyone's personal data - we will say what else we need.

### What to include

To help triage and fix the issue quickly, please include:

- Steps to reproduce, as specific as possible, and a proof of concept if you have one
- Where it is: the API route, page or component, and the version (release number or commit),
  and whether you tested the hosted service, the desktop app (with your OS), or a self-hosted
  instance
- The potential impact: what an attacker could do and whose data could be exposed
- Your assessment of severity, if you have one
- Whether you plan to publish your own write-up, and how you would like to be credited

## Scope

This policy covers the code in this repository and the hosted service built from it.

**In scope:**
- The hosted service at corvale.app and its API at api.corvale.app
- The backend API (`backend/`) - authentication, session and token handling (JWT access tokens,
  rotating refresh tokens), authorization and tenant isolation (row-level security, workspace
  roles), the sync API, billing and payment-webhook handling, the operator (admin) API, and file
  handling (receipt upload, backup restore, bank-file import)
- The web app and installable PWA (`frontend/corvale/`), including its Content-Security-Policy,
  service worker, and how it stores data in the browser
- The Tauri desktop app (`frontend/corvale/src-tauri/`) - the local database and its encryption,
  the auto-updater and its signature check, and the installers and their checksums
- The other apps in this repository: the operator console (`frontend/admin/`) and the
  payment-link page (`frontend/pay/`)
- The build and release pipeline (`.github/workflows/`) - anything that would let someone else's
  code into a release
- The default configuration this repository ships for self-hosting (`docker-compose.yml`,
  `Caddyfile`, the Dockerfiles, the `.env.example` files), where following the
  [deployment guide](../docs/developers/guides/deployment.md) leaves an instance insecure

**Out of scope:**
- Denial of service, volumetric traffic, or rate-limit exhaustion against shared infrastructure
- Social engineering targeting the maintainer or users
- Attacks requiring physical access to a user's device
- Vulnerabilities that exist only in an unpatched third-party dependency and aren't reachable
  through Corvale's own shipped code
- Reports generated purely from automated scanners without a demonstrated, concrete impact
- The third-party services Corvale relies on (payment provider, CAPTCHA, email delivery, error
  tracking, hosting, GitHub). Report those to the vendor
- Someone else's self-hosted instance. Its configuration and data are its operator's
  responsibility. A flaw in Corvale's own code that affects self-hosters is in scope
- Known limitation: the Windows and macOS installers are not currently signed with an
  operating-system-trusted code-signing certificate, so SmartScreen and Gatekeeper warnings are
  expected. Update packages are signed, and each release publishes SHA-256 checksums. A way to
  tamper with either of those is in scope

## Testing in good faith

- Use accounts you create yourself. Don't access, change, or delete another person's data. If you
  reach someone else's data by accident, stop, don't keep or share it, and tell us.
- Don't degrade the service for other users: no load testing and no high-volume automated
  scanning.
- Use the features that send email (such as signup verification and password reset) only with
  addresses you control.
- Don't test payment or checkout flows with real payment details.
- No social engineering, phishing, or physical attacks.
- Keep the details private until the advisory is published (see below).

## What to expect

This project is maintained by a single developer, so there's no guaranteed SLA - but reports are
taken seriously, read on a best-effort basis, and handled ahead of everything else in the issue
tracker. Once a report is triaged, you'll be kept updated on the fix timeline directly in the
advisory thread (or by email, if that is how you reported).

## How fixes are disclosed

1. The report stays private. The fix is developed in the private advisory and confirmed with you,
   if you are willing to test it.
2. The fix ships in a new release, and the hosted service is updated.
3. The advisory is published **7 days after the fixed release is available**. It names the
   affected and fixed versions and credits you, and a CVE is requested through GitHub for issues
   that warrant one. The 7 days give people running their own instance time to update before the
   advisory describes the flaw. If a vulnerability is being actively exploited, the advisory may
   be published sooner.

Please allow a reasonable window - around 90 days is the general norm for coordinated disclosure -
for a fix to ship before any public write-up. If a fix is going to take longer, that will be
communicated in the advisory thread. Once the advisory is published you are free to publish your
own write-up.

## Safe harbor

Good-faith security research conducted under this policy - reporting privately, not accessing or
modifying data beyond what's needed to demonstrate the issue, and not disrupting the service for
other users - is covered by the security-research allowance in the acceptable-use section of the
[Terms of Service](../docs/legal/terms.md). It will not be treated as unauthorized access, and it
will not be met with legal action or account suspension.

This applies to systems Corvale operates. It cannot authorize testing against third-party services,
which have their own rules. If you are unsure whether something is covered, ask first.

## Credit

If you'd like to be credited for a report once it's resolved and disclosed, let us know in your
report and we're happy to include it in the published advisory. Corvale has no bug bounty programme
and cannot offer payment for reports.

## Security practices in this repository

- GitHub private vulnerability reporting, secret scanning, and push protection are enabled.
- Dependabot opens weekly update pull requests for npm, Cargo, and GitHub Actions dependencies.
- Every pull request runs `npm audit` (failing on high severity for the backend and web app,
  critical for the docs site) and `cargo audit` on the desktop app's Rust dependencies.
- GitHub Actions are pinned to commit SHAs, and workflows default to a read-only token.
- Releases are built from version tags by a workflow and created as drafts, with signed updater
  packages and published SHA-256 checksums.

For what the hosted service collects about you and the controls that protect it, see the
[Privacy Policy](../docs/legal/privacy.md). For anything about your own data, use the route on the
[Contact page](../docs/legal/contact.md) rather than this one.
