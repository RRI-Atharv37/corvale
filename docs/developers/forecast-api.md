---
title: Forecast API
---

## GET /api/v1/forecast

Requires authentication. Projects each of the caller's accounts forward and flags days where the projected balance would go negative.

::: warning No frontend yet
This API is implemented and available today, but Corvale's web UI does not yet have a page for it. Use it directly if you're building against the API.
:::

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `days` | `30`, `60`, or `90` (default `30`) |
| `accountId` | Limit the forecast to one account; omit to forecast every active account |
| `workspaceId` | Scope to a workspace instead of personal accounts |

### What's projected

For each account, over the requested window:

- **Recurring occurrences** - every active recurring rule on the account, projected forward by its schedule
- **Goal contributions** - active savings goals with auto-contribution enabled on the account
- **Discretionary spending** - a projected daily average based on the account's non-recurring posted expenses over the trailing 90 days

### Response shape

```json
{
  "days": 30,
  "startDate": "2026-08-19",
  "endDate": "2026-09-18",
  "accounts": [
    {
      "accountId": "...",
      "accountName": "Checking",
      "currency": "USD",
      "startingBalance": 1200.5,
      "projectedEndingBalance": 940.1,
      "projectedChanges": [
        { "date": "2026-08-20", "type": "recurring", "amount": -45.0, "label": "Internet bill", "refId": "..." }
      ],
      "lowBalanceWarnings": [{ "date": "2026-09-02", "projectedBalance": -32.4 }]
    }
  ]
}
```

A `lowBalanceWarnings` entry appears for any date where the running projected balance dips below zero.

## Related pages

- [API Overview](./api-overview.md)
- [Calendar API](./calendar-api.md)
- [Recurring Rules API](./recurring-api.md)
