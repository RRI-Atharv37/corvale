---
title: Savings Goals API
---

## Endpoints

All savings goal routes are mounted at `/api/v1/savings-goals` and require authentication.

## POST /savings-goals

Create a savings goal.

### Request body

```json
{
  "name": "Emergency fund",
  "targetAmount": 5000,
  "currency": "USD",
  "targetDate": "2027-06-01",
  "accountId": "<account-id-or-null>",
  "autoContribution": {
    "enabled": true,
    "amount": 200,
    "interval": "monthly",
    "dayOfMonth": 1
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Goal display name |
| `targetAmount` | Yes | Target in major units |
| `currency` | No | Defaults to user preference |
| `targetDate` | No | Optional deadline (`YYYY-MM-DD`) |
| `accountId` | No | Optional linked account |
| `autoContribution` | No | Schedule settings (see below) |

### Auto contribution object

| Field | Description |
|-------|-------------|
| `enabled` | `true` to enable scheduled contributions |
| `amount` | Contribution amount in major units |
| `interval` | `weekly` or `monthly` |
| `dayOfMonth` | Required for monthly (1–28) |

### Success response (201)

Returns the goal with `progress` metrics and `autoContribution.isDue` when applicable.

## GET /savings-goals

List goals for the authenticated user.

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `status` | Filter by `active`, `paused`, `completed`, or `archived` |
| `includeArchived` | `true` to include archived goals in unfiltered lists |

## GET /savings-goals/:goalId

Return a single goal with progress metrics.

## GET /savings-goals/:goalId/progress

Return progress-only payload (`remaining`, `percentComplete`, `isComplete`, `requiredMonthlyContribution`, `projectedCompletionDate`, `monthsRemaining`).

## PUT /savings-goals/:goalId

Update goal fields. Increasing `targetAmount` above `currentAmount` may reopen a completed goal.

## DELETE /savings-goals/:goalId

Archive a goal (`status: archived`).

## POST /savings-goals/:goalId/contribute

Record a manual contribution.

### Request body

```json
{
  "amount": 150,
  "note": "Paycheck allocation"
}
```

Auto-completes the goal when `currentAmount` reaches `targetAmount`.

## POST /savings-goals/:goalId/auto-contribute

Process a scheduled automatic contribution when `isDue` is true. Blocked for paused, completed, or archived goals.

## GET /savings-goals/:goalId/contributions

Return contribution history (newest first). Each entry includes `type` (`manual` or `automatic`), `amount`, `note`, and `contributedAt`.

## POST /savings-goals/:goalId/pause

Set status to `paused`.

## POST /savings-goals/:goalId/resume

Set status to `active` from `paused`.

## POST /savings-goals/:goalId/complete

Manually mark the goal complete.

## Progress metrics

| Field | Description |
|-------|-------------|
| `remaining` | Target minus current amount |
| `percentComplete` | Progress toward target (0–100) |
| `isComplete` | Whether target is met |
| `requiredMonthlyContribution` | Suggested monthly amount to hit `targetDate` |
| `projectedCompletionDate` | Estimated finish date at current pace |
| `monthsRemaining` | Months until `targetDate` |

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Invalid amount, date, account, or state transition |
| 403 | Goal belongs to another user |
| 404 | Goal not found |

## Related pages

- [API Overview](./api-overview.md)
- [Savings Goals Overview](../savings-goals/overview.md)
- [Contributing to Goals](../savings-goals/contributing-to-goals.md)
