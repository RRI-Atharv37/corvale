---
title: Project Structure
---

## Repository layout

```
spndr/
├── backend/                  API server
│   ├── app.ts                Express app factory and route mounting
│   ├── server.ts             Entry point - connects DB and listens
│   ├── config/
│   │   └── db.ts             MongoDB connection
│   ├── controllers/          Request handlers
│   │   ├── authController.ts
│   │   ├── incomeController.ts
│   │   ├── expenseController.ts
│   │   ├── accountController.ts
│   │   ├── saverController.ts
│   │   └── pushoverController.ts
│   ├── models/               Mongoose schemas
│   │   ├── User.ts
│   │   ├── Income.ts
│   │   ├── Expense.ts
│   │   ├── Account.ts
│   │   ├── Saver.ts
│   │   └── Pushover.ts
│   ├── routes/               Express routers
│   ├── middleware/           Auth, errors, rate limiting
│   ├── utils/                Balance engine, shared helpers
│   └── tests/                Vitest integration and unit tests
├── frontend/spndr/           React SPA
│   ├── src/
│   │   ├── App.tsx           Route definitions
│   │   ├── main.tsx          Entry point
│   │   ├── pages/            Page components
│   │   │   ├── auth/         Login, Signup
│   │   │   └── Dashboard/    Home, Income, Expense, Accounts, Saver, Pushover
│   │   ├── components/       Layouts, UI, forms, inputs
│   │   ├── context/          UserContext (auth state)
│   │   ├── hooks/            useUser, useAsyncData
│   │   ├── routes/           ProtectedRoute
│   │   ├── types/            TypeScript API types
│   │   └── utils/            Axios, API paths, formatting
│   └── public/               Static assets
└── docs/                     This documentation site (VitePress)
```

## Backend conventions

- Controllers use `express-async-handler` for async error propagation
- Application errors throw `CustomError` with HTTP status codes
- Error messages are centralized in `utils/errorMessages.ts`
- User-owned resources are scoped by `userId` with ownership validation
- Responses use `handleResponses()` for consistent `{ success, data }` shape

## Frontend conventions

- Pages fetch data with the `useAsyncData` hook
- API calls go through a shared Axios instance with JWT interceptor
- Protected routes wrap the dashboard layout via `ProtectedRoute`
- UI states (loading, error, empty) use shared components: `AsyncContent`, `LoadingState`, `ErrorState`, `EmptyState`

## Data models

| Model | Collection | One per user? |
|-------|------------|---------------|
| User | users | - |
| Income | incomes | Many |
| Expense | expenses | Many |
| Account | accounts | Many |
| Saver | savers | One (unique index on userId) |
| Pushover | pushovers | Many (history records) |

## Balance engine

The core balance logic lives in `backend/utils/balanceUtils.ts`:

- `computeUserBalances(userId)` - full balance summary
- `computeAccountTotals(userId)` - account aggregation
- `roundMoney(amount)` - two-decimal rounding

This engine powers the saver details endpoint, which the dashboard and saver pages consume.

## Related pages

- [Developer Overview](./overview.md)
- [API Overview](./api-overview.md)
