---
title: Project Structure
---

## Repository layout

```
corvale/
├── backend/                  API server
│   ├── app.ts                Express app factory and route mounting
│   ├── server.ts             Entry point - connects DB and listens
│   ├── config/
│   │   └── db.ts             MongoDB connection
│   ├── controllers/          Request handlers
│   │   ├── authController.ts
│   │   ├── transactionController.ts
│   │   ├── categoryController.ts
│   │   ├── receiptController.ts
│   │   ├── accountController.ts
│   │   ├── budgetController.ts
│   │   ├── savingsGoalController.ts
│   │   ├── incomeController.ts      (legacy, deprecated)
│   │   ├── expenseController.ts     (legacy, deprecated)
│   │   ├── saverController.ts
│   │   └── pushoverController.ts
│   ├── models/               Mongoose schemas
│   │   ├── User.ts
│   │   ├── RefreshToken.ts
│   │   ├── Transaction.ts
│   │   ├── Category.ts
│   │   ├── Receipt.ts
│   │   ├── Account.ts
│   │   ├── Budget.ts
│   │   ├── SavingsGoal.ts
│   │   ├── SavingsGoalContribution.ts
│   │   ├── Income.ts                (legacy, deprecated)
│   │   ├── Expense.ts               (legacy, deprecated)
│   │   ├── Saver.ts
│   │   └── Pushover.ts
│   ├── routes/               Express routers
│   ├── middleware/           Auth, errors, rate limiting, receipt upload
│   ├── utils/                Balance engine, transaction helpers, shared utils
│   ├── scripts/              Migration CLI scripts
│   └── tests/                Vitest integration and unit tests
├── frontend/corvale/          React SPA
│   ├── src/
│   │   ├── App.tsx           Route definitions
│   │   ├── main.tsx          Entry point
│   │   ├── pages/            Page components
│   │   │   ├── auth/         Login, Signup, Forgot/Reset password
│   │   │   └── Dashboard/    Home, Transactions, Accounts, Categories, Budgets, SavingsGoals, Saver, Pushover
│   │   ├── components/       Layouts, UI, forms, pickers, receipts
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
- API calls go through a shared Axios instance with JWT interceptor and automatic token refresh
- Protected routes wrap the dashboard layout via `ProtectedRoute`
- UI states (loading, error, empty) use shared components: `AsyncContent`, `LoadingState`, `ErrorState`, `EmptyState`

## Data models

| Model | Collection | One per user? |
|-------|------------|---------------|
| User | users | - |
| Transaction | transactions | Many |
| Category | categories | Many (masters + user sub-categories) |
| Receipt | receipts | Many |
| Account | accounts | Many |
| Budget | budgets | Many |
| SavingsGoal | savingsgoals | Many |
| SavingsGoalContribution | savingsgoalcontributions | Many |
| RefreshToken | refreshtokens | Many (TTL index on expiresAt) |
| Income | incomes | Many (legacy, deprecated) |
| Expense | expenses | Many (legacy, deprecated) |
| Saver | savers | One (unique index on userId) |
| Pushover | pushovers | Many (history records) |

## Balance engine

The core balance logic lives in `backend/utils/balanceUtils.ts`:

- `computeUserBalances(userId)` - full balance summary
- `computeAccountTotals(userId)` - account aggregation
- `roundMoney(amount)` - two-decimal rounding

Transaction account updates live in `backend/utils/transactionUtils.ts`. Budget progress lives in `backend/utils/budgetUtils.ts`. Savings goal math lives in `backend/utils/savingsGoalUtils.ts`. This engine powers the saver details endpoint, which the dashboard and saver pages consume.

## Related pages

- [Developer Overview](./overview.md)
- [API Overview](./api-overview.md)
- [Data Migration](./data-migration.md)
