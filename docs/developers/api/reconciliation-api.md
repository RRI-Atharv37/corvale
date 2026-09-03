---
title: Reconciliation API
---

## Endpoints

Require authentication.

## PATCH /api/v1/transactions/:transactionId/cleared-status

Update a single transaction's cleared state.

### Request body

```json
{ "clearedStatus": "cleared", "reconciledAt": null }
```

`clearedStatus` is required and must be one of `pending`, `cleared`, `reconciled`. If `reconciledAt` isn't supplied and the new status isn't `reconciled`, `reconciledAt` is cleared to `null`. Requires edit access to the transaction's account (workspace editor, or personal ownership).

## POST /api/v1/reconciliation-sessions

Compare an account's cleared transactions to a bank statement.

### Request body

```json
{ "accountId": "<account-id>", "statementEndDate": "2026-08-19", "statementBalance": 1450.32 }
```

All fields required. Transfers are excluded from the comparison (a single transfer leg can't be sign-resolved on its own). Transactions dated on or before `statementEndDate` are split into settled (`cleared`/`reconciled`) and pending groups:

- `clearedBalance` = account opening balance + sum of settled transaction deltas
- `pendingBalance` = sum of pending transaction deltas
- `balanceDifferential` = `|statementBalance - clearedBalance|`

Creates and returns a `ReconciliationSession` (201).

## GET /api/v1/accounts/:accountId/reconciliation-sessions

List past reconciliation sessions for an account, most recent statement date first. Requires viewer access.

## Transaction filters

`GET /api/v1/transactions` and `/transactions/filter` accept `clearedStatus` and `accountId` query parameters to narrow results by reconciliation state.

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Invalid `clearedStatus`, missing session fields |
| 403 | Caller lacks edit/view access to the account |
| 404 | Transaction or account not found |

## Related pages

- [API Overview](../guides/api-overview.md)
- [Reconciling an Account](../../accounts/reconciling-an-account.md)
- [Transactions API](./transactions-api.md)
