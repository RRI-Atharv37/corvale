---
title: Project Structure
---

## Repository layout

Corvale is one repository with four independent packages. There is no root `package.json` and no
workspace linking - every `npm` command runs from inside the package it belongs to.

```
corvale/
├── backend/                 Express + MongoDB API server
├── frontend/corvale/        React + Vite app (web, PWA, and Tauri desktop shell)
├── shared/                  Framework-agnostic money and forecast math
├── docs/                    This documentation site (VitePress)
└── .github/                 CI workflows and issue templates
```

- `backend/` and `frontend/corvale/` each have their own `package.json` and `node_modules`.
- `shared/` is **not** a published package. Both `backend/tsconfig.json` and
  `frontend/corvale/tsconfig.json` include `../shared/src` directly, so the same money math runs on
  the server and in the browser without being copied.
- `docs/` is a standalone VitePress project with its own `package.json`.

## Path aliases

Neither package uses long relative import chains. Imports resolve through aliases defined in each
`tsconfig.json` (and mirrored in the Vite and Vitest config on the frontend).

| Alias | Resolves to | Used by |
|-------|-------------|---------|
| `@shared/*` | `shared/src/*` | backend and frontend |
| `@core/*` `@infra/*` `@http/*` `@modules/*` | `backend/src/*` | backend |
| `@migrations/*` | `backend/src/migrations/*` | backend migration scripts and their tests |
| `@tests/*` | `backend/tests/*` | backend test suites reaching the shared harness |
| `@/*` `@ui/*` `@lib/*` `@features/*` `@platform/*` `@domain/*` | `frontend/corvale/src/*` | frontend |

Within a module or feature, imports stay relative and short (`./transaction.model`). Aliases are for
crossing a boundary.

## Backend

The backend is organized by **feature module**, not by technical role. Everything one feature needs -
its model, routes, controller, service, and domain helpers - sits in one folder under
`src/modules/`.

```
backend/
├── src/
│   ├── server.ts             Process entry: connect DB, start listening
│   ├── http/
│   │   ├── app.ts            createApp() - the middleware chain
│   │   ├── routes.ts         The single mount table over every module
│   │   ├── health.routes.ts  Liveness and readiness endpoints
│   │   └── middleware/       auth, errors, rate limiting, request logging, body sanitizing
│   ├── core/                 Framework-agnostic primitives shared by two or more modules
│   │   ├── access/           Row-level security plugin, ownership checks, workspace helpers
│   │   ├── auth/             getUserId() from the request context
│   │   ├── db/               ObjectId parsing, aggregation helpers, optimistic concurrency
│   │   ├── errors/           CustomError, centralized error message strings
│   │   ├── http/             handleResponses(), shape validation, multipart limits
│   │   ├── money/            Minor-unit conversion, currency parsing, account wire format
│   │   ├── query/            Safe search-regex construction
│   │   ├── softDelete/       Soft-delete plugin and tombstone helpers
│   │   ├── storage/          Receipt MIME-type allowlist
│   │   └── time/             Timezone helpers
│   ├── infra/                The only place with network, filesystem, or third-party clients
│   │   ├── db/               MongoDB connection
│   │   ├── mail/             Mail service, templates, dev-log transport
│   │   ├── storage/          Receipt storage driver, file-signature sniffing
│   │   ├── security/         ClamAV virus scan, hCaptcha verification
│   │   ├── observability/    Logger, error tracking
│   │   ├── rateLimit/        Mongo-backed rate-limit store
│   │   └── config/           Env validation, CORS allowlist, graceful shutdown, refresh cookie
│   ├── migrations/           One-shot data-migration logic (no CLI argument parsing)
│   └── modules/              29 feature modules - see the table below
│       └── transactions/
│           ├── index.ts             The module's public surface
│           ├── transaction.model.ts
│           ├── transaction.routes.ts
│           ├── transaction.controller.ts
│           ├── transaction.service.ts
│           ├── transactionUtils.ts  Pure domain helpers
│           ├── export.ts
│           └── __tests__/
├── tests/                    Shared harness plus cross-module and repo-config suites
│   ├── setup.mts  helpers.ts  fixtures/  tsconfig.json
│   └── system/              Suites no single module owns (API hardening, NoSQL-injection,
│                            shared-domain parity, container and CI-workflow checks, the
│                            architecture guard)
└── scripts/                 CLI wrappers - argument parsing plus a call into src/migrations
```

Unit tests for a module live in that module's `__tests__/` folder. Unit tests for `core/` and
`infra/` co-locate the same way. Only genuinely cross-cutting suites stay in `tests/`.

### The layer contract

Each layer may import only from the layers below it. This is enforced by ESLint import zones and by
`tests/system/architecture.test.ts`. The table below is a summary; the full contract, including what
each layer must **never** contain and how the boundaries are enforced, is on the
[Architecture &amp; Layering Contract](./architecture.md) page.

| Layer | Holds | May import |
|-------|-------|-----------|
| `*.routes.ts` | Path table and middleware wiring | own controller, `@http/middleware` |
| `*.controller.ts` | HTTP boundary: read `req`, shape-validate, call a service | own service, `@core` |
| `*.service.ts` | Orchestration, transactions, cross-model writes | own model, other modules' `index.ts`, `@core`, `@infra` |
| `*.model.ts` | Schema, indexes, plugin registration | `@core` |
| module domain files | Pure functions over plain objects | `@core`, `@shared` |
| `core/` | Primitives used by two or more modules | `@shared` only |
| `infra/` | Network, filesystem, and third-party clients | `@core` |
| `shared/` | Pure, isomorphic finance functions | nothing |

Rule of thumb: if it talks to something outside the process it is `infra/`; if it is a pure
function two or more modules need it is `core/`; if only one module needs it, it lives in that
module.

### Modules

Every module mounts at a fixed route base under `/api/v1`. The base is part of the public API and
does not change.

| Module | Route base | Module | Route base |
|--------|-----------|--------|-----------|
| `accounts` | `/accounts` | `onboarding` | `/onboarding` |
| `auth` | `/auth` | `receipts` | `/receipts` |
| `backup` | `/backup` | `reconciliation` | `/reconciliation-sessions` |
| `budgets` | `/budgets` | `recurring` | `/recurring-rules` |
| `calendar` | `/calendar` | `reports` | `/dashboard/reports` |
| `categories` | `/categories` | `savers` | `/saver`, `/pushover` |
| `categorization-rules` | `/categorization-rules` | `savings-goals` | `/savings-goals` |
| `dashboard` | `/dashboard` | `subscriptions` | `/subscriptions` |
| `debts` | `/debts` | `sync` | `/sync` |
| `desktop` | `/desktop` | `tags` | `/tags` |
| `exchange-rates` | `/exchange-rates` | `transaction-templates` | `/transaction-templates` |
| `forecast` | `/forecast` | `transactions` | `/transactions` |
| `import` | `/imports` | `users` | under `/auth` |
| `legacy` | `/income`, `/expense` | `workspaces` | `/workspaces` |
| `notifications` | `/notifications` | | |

`legacy` holds the deprecated Income and Expense models and routes. `users` composes onto the
`/auth` base alongside `auth`. Workspace membership helpers live in `core/access/` rather than the
`workspaces` module because nearly every module consumes them.

### Backend conventions

- Controllers use `express-async-handler` for async error propagation.
- Application errors throw `CustomError(message, statusCode)`, caught centrally by the error
  middleware. Message strings live in `core/errors/errorMessages.ts` - reuse an existing entry
  rather than inlining a new string.
- Every authenticated request runs inside a row-level-security context. Any Mongoose query that
  isn't scoped by `userId` or `workspaceId` throws.
- Responses use `handleResponses()` for the consistent `{ success, data }` shape.

## Frontend

`frontend/corvale/src/` is organized by feature, with a small set of shared layers around the
features.

```
frontend/corvale/src/
├── app/           main.tsx, App.tsx, routes/, providers/ (UserContext, WorkspaceContext),
│                  layouts/, generic data hooks (useAsyncData, usePaginatedList)
├── features/      One folder per feature - a *Page.tsx, its components/, hooks/, api.ts,
│                  types.ts, and __tests__/
│                  accounts, auth, budgets, calendar, categories, dashboard, debts, download,
│                  forecast, import, landing, legal, notifications, onboarding, recurring,
│                  reports, saver, savings-goals, settings, subscriptions, tags, transactions,
│                  workspaces
├── ui/            Design system - AsyncContent, LoadingState, ErrorState, EmptyState, Modal,
│                  plus forms/, inputs/, layouts/. May import lib/ and nothing else.
├── lib/           axiosInstance, apiPaths, apiError, format, currencies, brand, tokenStore,
│                  workspaceScope, localFirstFlag, platformDetect, categoryIcons
├── domain/        Pure local-first computation engines (balances, budget progress, reports,
│                  forecast, transfers), parity-tested against shared/
├── platform/      The local-first runtime - db/, sync/, offline/, pwa/, desktop/
├── legal/         Canonical legal document text (*.md) - see the Legal section of the site
└── test/          Test harness only - setup.ts, test-utils.tsx, fixtures
```

- Cross-feature imports go through `app/`, `ui/`, `lib/`, `domain/`, or `platform/` - never
  directly into another feature's folder. ESLint import zones enforce this on production code.
- `domain/` mirrors the backend module domain helpers and stays consistent with them.
- `platform/` is a lower layer than `ui/` and `lib/`: the local-first runtime may depend on
  library helpers, not the other way round.

### Frontend conventions

- Pages fetch server data with `useAsyncData` (or `usePaginatedList` for paginated lists), paired
  with the shared `AsyncContent` / `LoadingState` / `ErrorState` / `EmptyState` components.
- When the local-first engine is on, pages read and write a local SQLite database through
  `platform/db/` and a background engine syncs it with the `/sync` API.
- API calls go through the shared Axios instance with its JWT interceptor and automatic token
  refresh. Endpoint paths are centralized in `lib/apiPaths.ts`.
- Protected routes wrap the dashboard layout via `app/routes/ProtectedRoute.tsx`.

## shared/

```
shared/src/     money.ts, balances.ts, budget.ts, savingsGoals.ts, forecast.ts,
                categorization.ts, and related pure finance functions
```

These functions take plain objects and return plain objects - no framework, no I/O, no Node or
browser globals. Change money math here once and both the backend and the frontend pick it up.

## Build output

- `cd backend && npm run build` runs `tsc`, which compiles `backend/` and the top-level `shared/`
  together into one `dist/` tree at the repository root. `npm start` runs
  `dist/backend/src/server.js`.
- `cd frontend/corvale && npm run build` produces static files in `dist/frontend/`. Serve them with
  any static file server that supports SPA fallback routing.

## Data models

| Model | Collection | One per user? |
|-------|------------|---------------|
| User | users | Yes |
| RefreshToken | refreshtokens | Many (TTL index on expiry) |
| Transaction | transactions | Many |
| Category | categories | Many (shared masters plus user sub-categories) |
| Receipt | receipts | Many |
| Account | accounts | Many |
| Budget | budgets | Many |
| SavingsGoal / SavingsGoalContribution | savingsgoals / savingsgoalcontributions | Many |
| RecurringRule | recurringrules | Many |
| CategorizationRule | categorizationrules | Many |
| TransactionTemplate | transactiontemplates | Many |
| Tag | tags | Many |
| Notification | notifications | Many |
| ReconciliationSession | reconciliationsessions | Many |
| SavedReport | savedreports | Many |
| Saver | savers | One (unique index on userId) |
| Pushover | pushovers | Many (history records) |
| Workspace / WorkspaceInvite | workspaces / workspaceinvites | Many (membership-scoped) |
| SyncOperation | syncoperations | Many (idempotent replay log) |
| Income / Expense | incomes / expenses | Many (legacy, deprecated) |

Account balances are stored in **minor units** (integer cents). `shared/src/money.ts` has
`toMinorUnits` and `fromMinorUnits`.

## Balance and domain engines

The pure math lives in `shared/src/` and is consumed by both the backend and the frontend local
engine:

- `shared/src/balances.ts` - account totals, spendable balance, net worth
- `shared/src/budget.ts` - budget progress (posted expenses only; drafts and transfers excluded)
- `shared/src/savingsGoals.ts` - goal contribution math
- `shared/src/forecast.ts` - projected balances

The backend `src/modules/*/…Utils.ts` files are thin Mongoose-aware wrappers around it - for
example the `accounts` module wraps `computeUserBalances`, and
`modules/transactions/transactionUtils.ts` applies account-balance deltas on transaction create,
update, and delete. The frontend `domain/` engines wrap the same functions over the local database.

## Related pages

- [Architecture &amp; Layering Contract](./architecture.md)
- [Developer Overview](./overview.md)
- [API Overview](./api-overview.md)
- [Data Migration](./data-migration.md)
