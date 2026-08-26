# Contributing to spndr

spndr is a solo-maintained personal/portfolio project. It's not actively looking for large
contributions or new maintainers, but bug reports, small bug-fix PRs, and focused
improvements are welcome.

Found a security vulnerability? Please don't open an issue or PR for it — see
[SECURITY.md](./SECURITY.md) for private reporting instead.

## Project layout

Three separate npm workspaces, each with its own `package.json` and `node_modules` — run
commands from inside each directory, not the repo root:

- `backend/` — TypeScript/Express/MongoDB API
- `frontend/spndr/` — React/Vite/Tailwind app (web + Tauri desktop)
- `docs/` — VitePress documentation site

## Getting set up

**Backend** (`backend/`) needs a `backend/.env` — see
`docs/developers/environment-variables.md` for the full list; `MONGO_URI`, `JWT_SECRET`,
`JWT_EXPIRY`, and `CLIENT_URL` are required.

**Frontend** (`frontend/spndr/`) needs a `frontend/spndr/.env` copied from `.env.example`
(`VITE_API_URL`, defaults to `http://localhost:5000/api/v1`).

```bash
# backend/
npm run dev          # dev server on :5000
npm test             # full test suite (vitest + supertest, in-memory MongoDB)
npx tsc --noEmit     # type-check

# frontend/spndr/
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
- **frontend/spndr/** changes: `npm run lint`, `npx tsc --noEmit`, `npm test`, and
  `npm run build` all pass.
- **docs/** changes: `npm run build` succeeds (this is the meaningful check for a
  VitePress content site — it catches broken links and bad frontmatter).

Keep PRs small and focused — one fix or one small feature per PR. Explain the *why* in the
description, not just the *what*. Use the PR template's checklist as a guide.

## Reporting bugs / requesting features

Please use the issue templates rather than a blank issue — they ask for the details needed
to actually act on a report (repro steps, environment, expected vs. actual behavior).
