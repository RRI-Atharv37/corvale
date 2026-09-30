# Contributing to Corvale

Corvale is built and maintained by one person, and also runs as a hosted service at corvale.app.
It's not actively looking for large contributions or new maintainers, but bug reports, small
bug-fix PRs, and focused improvements are welcome.

Found a security vulnerability? Please don't open an issue or PR for it - see
[SECURITY.md](./SECURITY.md) for private reporting instead. Questions and support requests are
covered in [SUPPORT.md](./SUPPORT.md). Requests about your own data on the hosted service go to
the privacy contact on the [Contact page](../docs/legal/contact.md), not to GitHub.

## What to open a PR for

- **Open a PR directly** for a bug fix, a test, a docs correction, or a small self-contained
  improvement.
- **Open an issue first, and wait for a go-ahead,** for anything larger: a new feature, a change to
  how something behaves, or any change in these areas, which hold users' financial data or gate
  access to it:
  - authentication, sessions, and token handling
  - tenant isolation (the row-level-security layer in `backend/src/core/access/`) and workspace
    access control
  - the sync engine (`backend/src/modules/sync/`, `frontend/corvale/src/platform/sync/`)
  - billing, entitlements, and webhooks (`backend/src/modules/billing/`)
  - the internal operator console and its API (`frontend/admin/`, `backend/src/modules/admin/`)
  - the desktop shell (`frontend/corvale/src-tauri/`)
  - the Content-Security-Policy

  A PR for something that wasn't agreed first may be closed without review.
- **Some changes can't be accepted at all.** Corvale's published
  [Terms](../docs/legal/terms.md), [Privacy Policy](../docs/legal/privacy.md), and
  [financial disclaimer](../docs/legal/financial-disclaimer.md) make promises to users: Corvale is a
  tool, not an adviser; it never holds, moves, or takes custody of funds; it has no connection to
  anyone's bank; and it keeps its privacy, consent, and erasure commitments. A change that would
  break any of them can't be merged. The legal documents themselves
  (`frontend/corvale/src/legal/`, `docs/legal/`) are versioned, and users are asked to accept new
  versions of the Terms and Privacy Policy, so changes to them are maintainer-only.

## Project layout

One repository, several independent npm packages. There is no root `package.json` and no workspace
linking - run commands from inside each directory, not the repo root:

- `backend/` - TypeScript/Express/MongoDB API
- `frontend/corvale/` - React/Vite/Tailwind app: web, installable PWA, and the Tauri desktop shell
  in `src-tauri/`
- `shared/` - money, balance, budget, forecast, and CSV-import math. Not a package: the backend and
  the frontend both include it directly and import it as `@shared/*`
- `docs/` - VitePress documentation site
- `frontend/admin/` - the internal operator console for the hosted service. You will not normally
  need it
- `frontend/pay/` - a static payment-link page with no build step and no dependencies

[Project structure](../docs/developers/guides/project-structure.md) and
[Architecture](../docs/developers/guides/architecture.md) in the docs explain the layers in more
depth.

## Getting set up

You need the Node.js version CI uses (`NODE_VERSION` in
[`.github/workflows/ci.yml`](./workflows/ci.yml)). Running the API locally also needs a MongoDB
instance. The test suites do not: they start an in-memory MongoDB (`mongodb-memory-server`, which
downloads a MongoDB binary the first time it runs). The desktop app additionally needs a Rust
toolchain.

**Backend** (`backend/`): copy `backend/.env.example` to `backend/.env`. Five variables are
required - `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRY`, `CLIENT_URL`, and `OFFLINE_GRANT_PRIVATE_KEY` -
and the server refuses to start while `JWT_SECRET` or the offline-grant key is still the
placeholder. The example file shows how to generate real values, and
[`docs/developers/guides/environment-variables.md`](../docs/developers/guides/environment-variables.md)
has the full list.

**Frontend** (`frontend/corvale/`): copy `frontend/corvale/.env.example` to
`frontend/corvale/.env` (`VITE_API_URL`, defaults to `http://localhost:5000/api/v1`). Working on
offline mode also needs `VITE_OFFLINE_GRANT_PUBLIC_KEY` to match the backend's key - see the
environment variables guide.

```bash
# backend/
npm run dev          # dev server on :5000
npm run lint         # eslint (layer boundaries and controller/service rules, see below)
npx tsc --noEmit     # type-check
npm test             # full test suite (vitest + supertest, in-memory MongoDB)

# frontend/corvale/
npm run dev          # Vite dev server on :5173
npm run tauri:dev    # desktop app only - needs a Rust toolchain installed, see src-tauri/
npm run lint         # eslint
npx tsc --noEmit     # type-check
npm test
npm run build

# docs/
npm run dev          # VitePress dev server on :5174
npm run build
```

To run one backend or frontend test file, or tests by name:

```bash
npx vitest run path/to/file.test.ts
npx vitest run -t "test name substring"
```

## Before opening a PR

Open PRs against `release`, the default branch. CI runs on every pull request. Match what it runs
for the package(s) you touched (see [`.github/workflows/ci.yml`](./workflows/ci.yml)):

- **backend/** changes: `npm run lint`, `npx tsc --noEmit`, and `npm test` pass.
- **frontend/corvale/** changes: `npm run lint`, `npx tsc --noEmit`, `npm test`, and
  `npm run build` all pass.
- **docs/** changes: `npm run build` succeeds (this is the meaningful check for a VitePress
  content site - it catches broken links and bad frontmatter).
- **Dependency changes** (`package-lock.json`, `Cargo.lock`): CI also runs `npm audit` (failing
  on high severity for the backend and web app, critical for docs) and `cargo audit` on the
  desktop crate.
- **frontend/admin/** and **frontend/pay/** changes: CI does not run these yet, so run them
  yourself - `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` in
  `frontend/admin/`, and `npm test` in `frontend/pay/`.

Keep PRs small and focused - one fix or one small feature per PR. Explain the *why* in the
description, not just the *what*, and link the issue it closes. Use the PR template's checklist as a
guide. If your change is visible to users, add a line under `## [Unreleased]` in
[CHANGELOG.md](../CHANGELOG.md); release notes are generated from it. Reviews are best-effort - there
is no response-time guarantee.

Never commit secrets, `.env` files, or credentials. Secret scanning and push protection are on for
this repository.

## What the code expects

The codebase enforces most of these itself, through ESLint and tests, so a PR that breaks one
fails CI:

- **Tests come with the change.** Add or update tests next to the code, in the package's
  `__tests__/` folders. A bug fix should include a test that fails without the fix.
- **Tenant isolation is not optional.** Every new model and query is scoped by `userId` (or
  `workspaceId`) from the first line. The row-level-security plugin throws on an unscoped query, and
  a new schema with a `userId` applies it. Don't reach for the `RLS_BYPASS` query option to make
  something work.
- **Money is integer minor units,** and the math lives in `shared/src` so the backend and the
  frontend's local engine (`frontend/corvale/src/domain/`) stay identical. Change it there once,
  not in two places.
- **Backend layering.** `core/` never imports from `infra/`, `http/`, or `modules/`; `infra/` never
  imports from `http/` or `modules/`; and modules never import the app shell (`app.ts`,
  `routes.ts`). Within a module, controllers run no Mongoose queries and no minor-unit money math
  (that belongs in the `*.service.ts` or a domain file), and services never touch Express. `npm run lint` and `backend/tests/system/architecture.test.ts` check this. The list of
  legacy controllers in `backend/eslint.config.mjs` may only shrink.
- **Frontend layering.** `ui/`, `lib/`, `domain/`, `platform/`, `features/`, and `app/` have
  one-way import rules enforced by `npm run lint`. New pages fetch through `useAsyncData` (or
  `usePaginatedList`) with the `ui/` async-state components, and API paths go in
  `src/lib/apiPaths.ts`. Backend error strings go in `core/errors/errorMessages.ts`.
- **Local database changes are new migrations** under `frontend/corvale/src/platform/db/migrations/`.
  Never edit one that has already shipped.
- **Don't weaken security to make something work.** That means auth, input validation, tenancy
  scoping, and the CSP. Don't hand-edit the CSP meta tag for one build target; the Vite plugins in
  `vite.config.ts` widen it per build, and `src-tauri/tauri.conf.json` carries the matching policy.
- **Comment sparingly** - only where something needs a genuine explanation - and match the style of
  the code around it.
- **Docs move with behaviour.** If you change what a feature does, update its page under `docs/`,
  and the matching page under `docs/developers/api/` if you change an endpoint.

### Dependencies

Adding a dependency needs a reason in the PR description. Its licence has to be compatible with
this project's [licensing model](#licensing-of-contributions): dependencies under the GPL or AGPL
can't be accepted, because they would stop the combined work from being offered under other
terms. Please don't open version-bump PRs by hand - Dependabot does that weekly.

## Licensing of contributions

Corvale is licensed under the **GNU AGPL v3.0** (`AGPL-3.0-or-later`) - see [LICENSE](../LICENSE).

**By submitting a pull request, you agree to the following.** Please don't open a PR if you
are not able to agree to all three:

1. **Your contribution is licensed under `AGPL-3.0-or-later`**, the same licence as the
   project (inbound = outbound).
2. **You grant the project maintainer a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable licence** to use, reproduce, modify, publish, sublicense and distribute your
   contribution, **including the right to relicense it under different terms** - among them
   proprietary or commercial terms. You retain full copyright in your contribution and remain
   free to use it however you like elsewhere.
3. **You have the right to grant this.** The contribution is your own original work, or you
   have permission to submit it (for example, from an employer who would otherwise own it).

**Why point 2 exists.** The project may be offered under a commercial licence alongside the
AGPL, and app-store distribution requires accepting terms that copyleft alone doesn't permit.
Both depend on a single party holding the rights to the whole codebase. Without this grant, a
merged contribution would permanently block those options for the code it touches. This is the
same arrangement used by dual-licensed projects such as Qt and MySQL.

This is a lightweight contributor agreement, not legal advice. If your employer has an open
source contribution policy, follow it.

## Reporting bugs / requesting features

Please use the issue templates rather than a blank issue - they ask for the details needed
to actually act on a report (repro steps, environment, expected vs. actual behavior). Search
existing issues first.

Corvale holds financial data, so redact it before you post: no real account numbers, balances,
receipts, tokens, or `.env` values in an issue, a log, or a screenshot. Made-up figures that
reproduce the problem are just as useful.
