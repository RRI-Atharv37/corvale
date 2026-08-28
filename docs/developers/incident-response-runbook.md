---
title: Incident Response Runbook
---

## Scope

This is the operator playbook for a live Corvale deployment going wrong — the service is down,
data looks corrupted, or something is silently computing wrong numbers. It covers detecting an
incident, deciding how urgently to react, fixing it, and writing it up afterward.

Corvale is currently run as a **solo-maintained personal/portfolio deployment**, not hosted for
other people's real financial data — so "incident response" here means a one-person on-call
rotation of exactly one person, not a team escalation policy. If you're self-hosting Corvale for
your own use, this same playbook applies to you as the operator. The mechanics of actually
recovering data live in the [Backup & Restore Runbook](./backup-restore-runbook.md); this page
is about the surrounding process — noticing, triaging, communicating, and following up.

## Severity levels

Every incident gets one of three severities. This is also where **Sev-1** — the term this
project's internal launch criteria use for "30 days of public beta with no Sev-1 incident before
General Availability" — is actually defined.

| Severity | Meaning | Examples |
| -------- | ------- | -------- |
| **Sev-1** | Data loss/corruption, wrong money for users, a security breach, or the service is fully down | Balances computing incorrectly for all users; a migration silently drops or corrupts records; an auth/authorization bypass; `GET /health` failing everywhere |
| **Sev-2** | A major feature is broken with no workaround, but the core ledger (transactions, balances, auth) is intact | CSV export always fails; the reports page is blank for everyone; sync stuck for all offline clients |
| **Sev-3** | A minor bug, an edge case, or something with a workaround | One report chart mis-labels a period; a cosmetic layout bug; a single non-critical endpoint erroring for one input shape |

When in doubt, round up. A false-positive Sev-1 costs you an hour of adrenaline; a missed real
one costs data.

## Detecting an incident

Corvale ships the monitoring hooks described in
[Environment Variables → Monitoring](./environment-variables.md#monitoring) — this is what
should actually catch a problem before a user reports one:

- An external uptime monitor polling `GET /health` (process alive) and `GET /ready` (database
  reachable) — this is what should catch a Sev-1 outage first, within minutes.
- Sentry (`SENTRY_DSN`) forwarding unexpected 5xx errors, if configured — catches unhandled
  exceptions and error spikes.
- Structured JSON request logs to stdout/stderr — the first place to look once you know
  *something* is wrong, to work out *what*.
- A user-filed bug report (see [`SUPPORT.md`](https://github.com/RRI-Atharv37/corvale/blob/main/.github/SUPPORT.md))
  — the least reliable channel for a Sev-1 (by definition, if uptime monitoring is configured,
  it should beat a user to noticing the service is down), but often the fastest way to hear about
  a Sev-2/3 that doesn't trip an alert.

## Triage

Before touching anything, spend two minutes establishing the shape of the problem:

1. **Confirm it's real.** Reproduce it, or find it in the logs/Sentry — don't act on a single
   unconfirmed report.
2. **Assign a severity** using the table above.
3. **Check what changed recently** — the last deploy, the last migration run
   (`npm run migrate:*`), any manual database intervention. Most incidents trace back to
   something that changed in the last few hours, not a bug that was always there.
4. **Check blast radius** — one user or all of them? One endpoint or the whole API? This drives
   both the severity call and what "fixed" looks like.

## Responding, by severity

**Sev-1 — stop the bleeding first, root-cause second.** In order of preference:

1. **Roll back the deploy** if the timing lines up with a recent release — this is almost always
   faster and safer than forward-fixing under pressure.
2. **Restore from backup** per the [Backup & Restore Runbook](./backup-restore-runbook.md) if
   data is actually corrupted or lost, restoring into a scratch database first per that runbook's
   own procedure.
3. Only once the bleeding has stopped, investigate root cause with the pressure off.

**Sev-2** — fix on the next reasonable work session; no need to interrupt anything else, but
don't let it sit for days either.

**Sev-3** — normal bug-fix priority, tracked like any other issue.

## Communication

Corvale does not currently host other users' real financial data (see the portfolio-deployment
decision recorded in this repo's planning docs), so there is no user base to page or a status
page to update. If that ever changes — this deployment starts serving other people's real
accounts — add a status-page/notification step here before that happens, not after the first
incident makes it obvious it's missing.

If you're self-hosting Corvale for your own household or team, "communication" just means telling
whoever else uses your deployment what happened and when it'll be back, however you'd normally
reach them.

## Post-incident

For anything Sev-1 or Sev-2, write a short post-mortem once it's resolved — a few lines is
enough:

- What happened, and when.
- What the actual root cause was (not just the symptom).
- What changed (code, config, process) so it can't happen the same way again.

Keep it wherever you already track project history for this deployment (a `CHANGELOG.md` entry,
a project-tracking doc, or a note attached to the GitHub issue) — the format matters less than
actually writing it down before the details fade.

## Related pages

- [Backup & Restore Runbook](./backup-restore-runbook.md) — the actual data-recovery procedure
- [Environment Variables → Monitoring](./environment-variables.md#monitoring) — health checks,
  Sentry, and structured logging setup
- [`SECURITY.md`](https://github.com/RRI-Atharv37/corvale/blob/main/.github/SECURITY.md) — for a
  security vulnerability specifically, which follows its own (private, faster) reporting process
  instead of this one
