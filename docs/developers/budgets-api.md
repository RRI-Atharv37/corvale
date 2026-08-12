---
title: Budgets API
---

## Endpoints

All budget routes are mounted at `/api/v1/budgets` and require authentication.

## POST /budgets

Create a budget.

### Request body

```json
{
  "name": "Groceries",
  "periodType": "monthly",
  "year": 2026,
  "month": 8,
  "amount": 500,
  "currency": "USD",
  "categoryId": "<category-id-or-null>",
  "rollover": false,
  "accountIds": []
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `periodType` | Yes | `monthly` or `custom` |
| `amount` | Yes | Budget limit in major units (for example, `500` = $500.00) |
| `year`, `month` | For monthly | Calendar month resolved in the user's timezone |
| `periodStart`, `periodEnd` | For custom | `YYYY-MM-DD` date strings |
| `categoryId` | No | Omit or `null` for overall budgets |
| `currency` | No | Defaults to user preference |
| `rollover` | No | Boolean, default `false` |
| `accountIds` | No | Empty array = all accounts |
| `name` | No | Optional display label |

### Success response (201)

Returns the created budget with embedded `progress` (`spent`, `remaining`, `percentUsed`, `isOverBudget`, `budgetAmount`).

## GET /budgets

List budgets for the authenticated user.

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `includeArchived` | `true` to include archived budgets |

Sorted by `periodStart` descending.

## GET /budgets/:budgetId

Return a single budget with progress metrics.

## GET /budgets/:budgetId/progress

Return progress details for a budget (`spent`, `remaining`, `percentUsed`, `isOverBudget`).

## PUT /budgets/:budgetId

Update a budget. Period type cannot change. Same body fields as create (partial updates supported where applicable).

## DELETE /budgets/:budgetId

Archive a budget (soft delete). Sets `isArchived: true`.

## Progress calculation rules

- Counts **posted** expenses only (`status: draft` excluded)
- Excludes transfers
- Respects `accountIds` scoping (empty = all user accounts)
- Category budgets attribute split child lines; overall budgets count parent totals without double-counting children
- Period boundaries use the user's timezone

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Invalid amount, period, category, or account ids |
| 403 | Budget belongs to another user |
| 404 | Budget not found |

## Related pages

- [API Overview](./api-overview.md)
- [Budgets Overview](../budgets/overview.md)
- [Tracking Budget Progress](../budgets/tracking-budget-progress.md)
