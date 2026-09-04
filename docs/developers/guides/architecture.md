---
title: Architecture &amp; Layering Contract
---

## What this page is

Corvale's backend and frontend are both organized into layers, and each layer has a fixed job. This
page is the **placement contract**: for any file, it tells you which layer it belongs in, what that
layer is allowed to import, and what it must never contain.

It is the companion to [Project Structure](./project-structure.md), which shows the directory tree
and the module inventory. Read that page for *where things live*; read this page for *why they live
there and what the rules are*.

The contract is not aspirational. Most of it is enforced by ESLint import zones and a test that
fails the build on a violation - see [How the contract is enforced](#how-the-contract-is-enforced).

## Why the contract exists

The layout it replaced had one `backend/utils/` folder holding 62 files: domain math, infrastructure
adapters, security primitives, and one-shot migration logic all in a single alphabetical list with
no rule separating them. Controllers and routes were flat 1:1 mirrors, so adding one feature touched
five sibling directories plus the app entry point, and none of the new code sat next to the rest of
it.

The fix is to sort every file into a layer with a single responsibility, and to keep it sorted. A
codebase only stays organized if the organization is checked automatically; that is what the
enforcement section below is for.

## The backend layer contract

Each row may import only from the rows below it, plus the shared packages noted. A file that needs
something an upper layer holds is a sign the code is in the wrong layer.

| Layer | Holds | May import | Must never hold |
|-------|-------|-----------|-----------------|
| `*.routes.ts` | The path table and middleware wiring for one module, and nothing else | its own module's controller, `@http/middleware` | Business logic, any Mongoose call |
| `*.controller.ts` | The HTTP boundary: read `req`, shape-validate the input, call a service, hand the result to `handleResponses` | its own service, `@core` | Mongoose queries, money math, cross-model orchestration |
| `*.service.ts` | Orchestration: session and transaction handling, cross-model writes, calling into other modules | its own model, other modules' `index.ts`, `@core`, `@infra` | `req`, `res`, or any Express type |
| `*.model.ts` | The Mongoose schema, its indexes, and plugin registration (`applyRowLevelSecurity`, `applySoftDelete`) | `@core` | Query helpers beyond schema-level statics |
| module domain files (`transactionBalance.ts`, `progress.ts`) | Pure functions over plain objects | `@core`, `@shared` | `req`, `res`, Mongoose, any I/O |
| `core/` | Framework-agnostic primitives that two or more modules need | `@shared` only | Anything from `@modules` or `@infra` |
| `infra/` | The only place with network, filesystem, or third-party clients | `@core` | Anything from `@modules` |
| `shared/` (repo root) | Pure, isomorphic, dependency-free finance functions | nothing | Node builtins, browser globals, any framework |

### Within a module

A module folder holds every layer for one feature: `transaction.model.ts`, `transaction.routes.ts`,
`transaction.controller.ts`, `transaction.service.ts`, its domain helpers, and its `__tests__/`. The
`index.ts` barrel is the module's public surface - it re-exports the model and its
constants and types, and nothing else. Another module imports `@modules/transactions` to get the
`Transaction` model; it must not reach into `@modules/transactions/transaction.service` or any other
internal file.

Imports within a module stay relative and short (`./transaction.model`). An alias import
(`@core/...`, `@modules/...`) is the signal that a boundary is being crossed, which is exactly the
import a reviewer should stop on.

## `core/` versus `infra/`

These two are the pair that keeps blurring. The rule of thumb:

- If it talks to something **outside the process** - a database, an SMTP server, the filesystem, a
  third-party API - it is `infra/`.
- If it is a **pure function that two or more modules** need, it is `core/`.
- If **only one module** needs it, it is not in either - it lives in that module.

`core/` may import `@shared` and nothing else. That constraint is what keeps it reusable and
testable without a running database. When a helper in `core/` turns out to need a live Mongoose
query - as the workspace-membership helpers did - it splits: the pure part (role math, filter
construction, types) stays in `core/`, and the database-aware part moves into the module that owns
the data.

## The frontend layer contract

The frontend is organized by feature, with a small set of shared layers around the features.

| Layer | Holds | May import |
|-------|-------|-----------|
| `app/` | `main.tsx`, `App.tsx`, routing, the context providers, layouts, and the generic data hooks (`useAsyncData`, `usePaginatedList`) | any layer |
| `features/` | One folder per feature: its `*Page.tsx`, `components/`, `hooks/`, `api.ts`, `types.ts`, `__tests__/` | `app/`, `ui/`, `lib/`, `domain/`, `platform/` - never another feature |
| `ui/` | The design system: `AsyncContent`, `LoadingState`, `Modal`, plus `forms/`, `inputs/`, `layouts/` | `lib/` and nothing else |
| `lib/` | Framework-light helpers: `axiosInstance`, `apiPaths`, `format`, `currencies`, `tokenStore`, `workspaceScope` | other `lib/` files |
| `domain/` | The pure local-first computation engines (balances, budget progress, reports, forecast), parity-tested against `shared/` | `@shared`, other `domain/` files |
| `platform/` | The local-first runtime: `db/`, `sync/`, `offline/`, `pwa/`, `desktop/` | `lib/`, `domain/` |
| `legal/` | The canonical legal document text (`*.md`) | nothing |

Two points that are easy to get backwards:

- **A feature never imports another feature.** Anything two features share moves down into `app/`,
  `ui/`, `lib/`, `domain/`, or `platform/`. Cross-feature *type* edges are the one tolerated
  exception (a report type referencing a dashboard type), mirroring the backend's deep
  `@modules/**` type imports.
- **`platform/` is a lower layer than `ui/` and `lib/`.** The local-first runtime may depend on
  library helpers; a library helper may not depend on the runtime.

## How the contract is enforced

Two mechanisms, both written before the relocation began so the structure could not decay back as
it was built.

### ESLint import zones

`backend/eslint.config.mjs` and `frontend/corvale/eslint.config.js` both configure
`import-x/no-restricted-paths` with the boundary zones from the table above:

- backend: `core/` may not import `modules/`, `infra/`, or `http/`; `infra/` may not import
  `modules/` or `http/`; a module may not import the app shell (`http/app.ts`) or the mount table
  (`http/routes.ts`), though `*.routes.ts` importing `@http/middleware` is allowed.
- frontend: `ui/` may not import `features/`, `app/`, `platform/`, or `domain/`; `lib/` may not
  import the app layer; `domain/` may not import `features/`, `app/`, or `ui/`; `platform/` may not
  import `features/` or `app/`.

The zones apply to production code only - test files legitimately reach across boundaries (an
integration test drives several modules) and are exempt. A violation is an ESLint error, and
`npm run lint` runs in CI.

### The architecture test

`backend/tests/system/architecture.test.ts` asserts, on every run of the backend suite:

- every `src/modules/*` folder exposes an `index.ts` and a `*.routes.ts`;
- no file imports another module past its `index.ts`;
- `core/` imports nothing from `modules/` or `infra/`, and `infra/` imports nothing from
  `modules/`;
- every module base path referenced in `http/routes.ts` resolves to a real module directory.

### Enforced by review

The layer *boundaries* above are machine-checked. Two finer-grained rules in the contract are
currently enforced by code review rather than by tooling:

- a controller doing its own Mongoose query or money math instead of calling a service;
- a service taking `req` or `res`.

Tightening the lint zones and the architecture test to cover these is tracked as the final step of
the structural refactor.

## Related pages

- [Project Structure](./project-structure.md) - the directory tree, the alias table, and the
  module inventory
- [Developer Overview](./overview.md)
- [API Overview](./api-overview.md)
