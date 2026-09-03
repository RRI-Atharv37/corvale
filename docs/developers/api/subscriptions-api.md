---
title: Subscriptions API
---

## GET /api/v1/subscriptions

Requires authentication. Lists active recurring expense rules whose interval qualifies as a subscription (weekly through yearly - one-off `daily`/`custom` rules aren't included) and totals their cost.

::: warning No frontend yet
This API is implemented and available today, but Corvale's web UI does not yet have a page for it. Use it directly if you're building against the API.
:::

### Query parameters

| Parameter | Description |
|-----------|-------------|
| `workspaceId` | Scope to a workspace instead of personal data |

### Response shape

```json
{
  "subscriptions": [
    {
      "ruleId": "...",
      "title": "Streaming service",
      "amount": 15.99,
      "currency": "USD",
      "interval": "monthly",
      "monthlyCost": 15.99,
      "annualCost": 191.88,
      "nextChargeDate": "2026-09-01",
      "categoryId": "...",
      "accountId": "...",
      "isCancelled": false
    }
  ],
  "totalMonthlyCost": 15.99,
  "totalAnnualCost": 191.88
}
```

`monthlyCost` and `annualCost` are normalized regardless of the rule's native interval (for example, a yearly rule's cost is divided down to a monthly figure). Rules marked `isCancelled` are still listed but excluded from the `totalMonthlyCost`/`totalAnnualCost` sums. Results are sorted by `nextChargeDate` ascending.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Recurring Rules API](./recurring-api.md)
