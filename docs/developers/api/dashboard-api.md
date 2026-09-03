---
title: Dashboard API
---

## Endpoints

All routes are mounted at `/api/v1/dashboard` and require authentication.

## GET /dashboard

Overview totals: `netWorth`, `totalAccountBalance`, `liquidBalance`, `spendableBalance`, `accountCount`, `balanceSource` (`accounts` or `legacy`).

## GET /dashboard/summary

Period totals used by the Home page stat cards - income, expenses, net savings, net worth, saver balance.

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `startDate`, `endDate` | Explicit `YYYY-MM-DD` range |
| `period` | Preset shortcut (this month, last 3/6/12 months, year to date) when explicit dates aren't given |
| `workspaceId` | Scope to a workspace instead of personal data |

## GET /dashboard/cash-flow

Time-series income/expense totals. Query param `groupBy`: `day`, `week`, or `month`.

## GET /dashboard/category-breakdown

Per-category totals. Query param `type`: `income` or `expense`.

## GET /dashboard/net-worth-trend

Net worth over time.

## GET /dashboard/budget-overview

Summary of active budgets and their progress.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Reports API](./reports-api.md)
- [Dashboard Overview](../../dashboard/overview.md)
