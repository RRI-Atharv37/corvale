# Contributing to Corvale

Corvale is a solo-maintained personal/portfolio project. It's not actively looking for large
contributions or new maintainers, but bug reports, small bug-fix PRs, and focused
improvements are welcome.

Found a security vulnerability? Please don't open an issue or PR for it — see
[SECURITY.md](./SECURITY.md) for private reporting instead.

## Project layout

Three separate npm workspaces, each with its own `package.json` and `node_modules` — run
commands from inside each directory, not the repo root:

- `backend/` — TypeScript/Express/MongoDB API
- `frontend/corvale/` — React/Vite/Tailwind app (web + Tauri desktop)
- `docs/` — VitePress documentation site

## Getting set up

**Backend** (`backend/`) needs a `backend/.env` — see
`docs/developers/guides/environment-variables.md` for the full list; `MONGO_URI`, `JWT_SECRET`,
`JWT_EXPIRY`, and `CLIENT_URL` are required.

**Frontend** (`frontend/corvale/`) needs a `frontend/corvale/.env` copied from `.env.example`
(`VITE_API_URL`, defaults to `http://localhost:5000/api/v1`).

```bash
# backend/
npm run dev          # dev server on :5000
npm test             # full test suite (vitest + supertest, in-memory MongoDB)
npx tsc --noEmit     # type-check

# frontend/corvale/
npm run tauri:dev    # desktop app only — needs a Rust toolchain installed, see src-tauri/
npm run dev          # Vite dev server on :5173
npm run lint         # eslint
npm test
npx tsc --noEmit
npm run build

# docs/
npm run dev          # VitePress dev server on :5174
npm run build
```

## Before opening a PR

Match whatever CI actually runs for the workspace(s) you touched (see
[`.github/workflows/ci.yml`](./workflows/ci.yml)):

- **backend/** changes: `npx tsc --noEmit` and `npm test` pass. (There's no backend lint
  config yet, so nothing to run there.)
- **frontend/corvale/** changes: `npm run lint`, `npx tsc --noEmit`, `npm test`, and
  `npm run build` all pass.
- **docs/** changes: `npm run build` succeeds (this is the meaningful check for a
  VitePress content site — it catches broken links and bad frontmatter).

Keep PRs small and focused — one fix or one small feature per PR. Explain the *why* in the
description, not just the *what*. Use the PR template's checklist as a guide.

## Licensing of contributions

Corvale is licensed under the **GNU AGPL v3.0** (`AGPL-3.0-or-later`) — see [LICENSE](../LICENSE).

**By submitting a pull request, you agree to the following.** Please don't open a PR if you
are not able to agree to all three:

1. **Your contribution is licensed under `AGPL-3.0-or-later`**, the same licence as the
   project (inbound = outbound).
2. **You grant the project maintainer a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable licence** to use, reproduce, modify, publish, sublicense and distribute your
   contribution, **including the right to relicense it under different terms** — among them
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

Please use the issue templates rather than a blank issue — they ask for the details needed
to actually act on a report (repro steps, environment, expected vs. actual behavior).
