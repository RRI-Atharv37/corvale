---
title: Saver API
---

## Endpoints

All saver routes are mounted at `/api/v1/saver`. All require authentication.

## POST /saver/add

Deposit funds from spendable balance into the saver pool.

### Request body

Use one of the following approaches:

**Percentage deposit (default 30%):**

```json
{
  "percentage": 30
}
```

**Custom amount deposit:**

```json
{
  "customAmount": 250.00
}
```

When `customAmount` is provided, it takes precedence over percentage calculation.

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `percentage` | No | number | 0–100; default 30 |
| `customPercentage` | No | number | Alternative percentage field |
| `customAmount` | No | number | Fixed deposit amount |

### Validation

- Deposit amount must be greater than zero
- Deposit cannot exceed current spendable balance
- Percentage must be between 0 and 100

### Success response (200)

```json
{
  "success": true,
  "data": {
    "message": "Amount added to saver successfully",
    "data": {
      "totalIncome": 5000.00,
      "totalExpenses": 3200.00,
      "saverBalance": 300.00,
      "spendableBalance": 700.00,
      "netWorth": 1800.00,
      "totalAccountBalance": 0,
      "liquidBalance": 0,
      "accountCount": 0,
      "balanceSource": "legacy",
      "remainingBalance": 700.00,
      "saverDate": "2026-08-12T..."
    }
  }
}
```

Creates or updates the single saver document for the user (upsert).

## POST /saver/withdraw

Withdraw funds from the saver back to spendable balance.

### Request body

```json
{
  "amount": 100.00
}
```

| Field | Required | Type |
|-------|----------|------|
| `amount` | Yes | number |

### Validation

- Amount must be greater than zero
- Cannot exceed current saver balance

## GET /saver/details

Retrieve the full balance summary including saver state.

### Success response (200)

Returns the same balance summary shape as the add/withdraw responses, including:

| Field | Description |
|-------|-------------|
| `totalIncome` | Sum of all income entries |
| `totalExpenses` | Sum of all expense entries |
| `saverBalance` | Current saver pool amount |
| `spendableBalance` | Available to spend or allocate |
| `netWorth` | Overall financial position |
| `totalAccountBalance` | Net account balance (accounts mode) |
| `liquidBalance` | Checking + cash total |
| `accountCount` | Number of active accounts |
| `balanceSource` | `"legacy"` or `"accounts"` |
| `remainingBalance` | Same as spendableBalance |
| `saverDate` | Last saver modification date |

## Related pages

- [API Overview](../guides/api-overview.md)
- [Saver Overview](../../saver/overview.md)
- [How Balances Are Calculated](../../balances/how-balances-are-calculated.md)
