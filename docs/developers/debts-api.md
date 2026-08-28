---
title: Debt Payoff API
---

## POST /api/v1/debts/plan

Requires authentication. Generates a month-by-month payoff schedule for credit accounts with a negative balance.

::: warning No frontend yet
This API is implemented and available today, but Corvale's web UI does not yet have a page for it. Use it directly if you're building against the API.
:::

### Request body

```json
{
  "strategy": "avalanche",
  "extraPayment": 100,
  "accountIds": [],
  "workspaceId": null
}
```

| Field | Required | Description |
|-------|----------|--------------|
| `strategy` | Yes | `snowball` (smallest balance first) or `avalanche` (highest interest rate first) |
| `extraPayment` | Yes | Extra amount applied per month on top of minimum payments (0 or more) |
| `accountIds` | No | Limit the plan to specific accounts; omit to include every eligible credit account |
| `workspaceId` | No | Scope to a workspace instead of personal accounts |

An account is **eligible** if it's `type: 'credit'` with a negative `currentBalance`, and has both `interestRate` and `minimumPayment` set - set these on the account form before planning payoff, or the request returns 400.

### Response shape

```json
{
  "strategy": "avalanche",
  "extraPayment": 100,
  "order": ["<accountId>", "..."],
  "totalMonths": 14,
  "totalInterestPaid": 312.45,
  "months": [
    { "month": 1, "payments": [{ "accountId": "...", "amount": 250, "remainingBalance": 1950 }] }
  ]
}
```

`order` reflects the sequence debts are paid off in under the chosen strategy. If no eligible accounts are found, the response returns zeroed totals and empty `order`/`months` arrays rather than an error.

## Related pages

- [API Overview](./api-overview.md)
- [Accounts API](./accounts-api.md)
