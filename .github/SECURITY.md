# Security Policy

Corvale takes security seriously, especially given the app handles personal financial data —
transaction history, account balances, and receipt images. If you've found a vulnerability,
please report it responsibly using the process below.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Publicly disclosing
an unpatched issue puts every user at risk.

Instead, use GitHub's private vulnerability reporting for this repository: go to the
**Security** tab → **Report a vulnerability**. This opens a private draft security advisory
visible only to the maintainer — nothing is public until a fix ships and the advisory is
published.

### What to include

To help triage and fix the issue quickly, please include:

- Steps to reproduce, as specific as possible
- The affected component or endpoint (e.g. a specific API route, a frontend page, the desktop
  app)
- The potential impact (what an attacker could do, what data could be exposed)
- Your assessment of severity, if you have one

## Scope

**In scope:**
- The backend API — authentication, authorization, row-level security, workspace access control
- Data encryption — offline/local storage, desktop app database encryption
- The web frontend and the Tauri desktop client
- Session and token handling (JWT, refresh tokens)

**Out of scope:**
- Denial of service / rate-limit exhaustion against shared infrastructure
- Social engineering targeting the maintainer or users
- Attacks requiring physical access to a user's device
- Vulnerabilities that exist only in an unpatched third-party dependency and aren't
  reachable through Corvale's own shipped code
- Reports generated purely from automated scanners without a demonstrated, concrete impact

## What to expect

This project is maintained by a single developer, so there's no guaranteed SLA — but reports
are taken seriously and acknowledged as soon as possible. Once a report is triaged, you'll
be kept updated on the fix timeline directly in the advisory thread.

## Disclosure timeline

Please allow a reasonable window — around 90 days is the general norm for coordinated
disclosure — for a fix to ship before any public write-up or disclosure of the issue. If a fix
is going to take longer, that will be communicated in the advisory.

## Safe harbor

Good-faith security research conducted under this policy — reporting privately, not accessing
or modifying data beyond what's needed to demonstrate the issue, and not disrupting the
service for other users — will not be treated as unauthorized access or met with legal action.

## Credit

If you'd like to be credited for a report once it's resolved and disclosed, let us know in
your report and we're happy to include it in the published advisory.
