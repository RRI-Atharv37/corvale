---
title: Calendar API
---

## GET /api/v1/calendar

Requires authentication. Returns a unified list of upcoming financial events across recurring rules, budgets, and savings goals.

::: warning No frontend yet
This API is implemented and available today, but spndr's web UI does not yet have a page for it. Use it directly if you're building against the API.
:::

### Query parameters

| Parameter | Required | Description |
|-----------|----------|--------------|
| `start`, `end` | Yes | `YYYY-MM-DD` range, resolved in the user's timezone |
| `workspaceId` | No | Scope to a workspace instead of personal data |

### Event types

| `type` | Source | `date` is |
|--------|--------|-----------|
| `recurring` | Active, non-archived recurring rules | Each projected occurrence in the range |
| `budget_end` | Active budgets whose period ends in the range | The budget's `periodEnd` |
| `goal_deadline` | Active/paused savings goals with a target date in the range | The goal's `targetDate` |

### Response shape

```json
[
  {
    "id": "recurring-<ruleId>-2026-08-20",
    "type": "recurring",
    "date": "2026-08-20",
    "title": "Internet bill",
    "amount": 45.0,
    "refId": "<ruleId>",
    "accountId": "<accountId>",
    "categoryId": "<categoryId>"
  }
]
```

Events are sorted by date ascending. `amount`, `accountId`, and `categoryId` are present or absent depending on event type.

## Related pages

- [API Overview](./api-overview.md)
- [Forecast API](./forecast-api.md)
- [Recurring Rules API](./recurring-api.md)
