---
title: Transactions API
---

## Endpoints

All transaction routes are mounted at `/api/v1/transactions`. All require authentication.

Amounts are stored internally as integer minor units (cents). The API accepts and returns major-unit decimals (for example, `25.50`) for client convenience.

## POST /transactions

Create an income or expense transaction.

### Request body

```json
{
  "type": "expense",
  "title": "Groceries",
  "amount": 85.40,
  "date": "2026-08-01",
  "accountId": "<account-id>",
  "categoryId": "<category-id>",
  "description": "Weekly shop",
  "paymentMethod": "Debit card",
  "tags": ["food", "weekly"]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | Yes | `income` or `expense` |
| `title` | Yes | Display label |
| `amount` | Yes | Major-unit decimal |
| `date` | Yes | ISO date string |
| `accountId` | Yes | Must belong to authenticated user |
| `categoryId` | Yes | Required unless using `splits` |
| `description` | No | Free text |
| `source` | No | Income source |
| `paymentMethod` | No | Expense payment method |
| `tags` | No | String array |
| `status` | No | `posted` (default) or `draft` |
| `splits` | No | Expense only — array of `{ categoryId, amount }` |

Creating a transaction updates the linked account balance.

### Split create example

```json
{
  "type": "expense",
  "title": "Mixed grocery run",
  "amount": 100.00,
  "date": "2026-08-01",
  "accountId": "<account-id>",
  "splits": [
    { "categoryId": "<food-category-id>", "amount": 70.00 },
    { "categoryId": "<household-category-id>", "amount": 30.00 }
  ]
}
```

Split line amounts must sum to the parent amount.

## POST /transactions/transfer

Create a linked transfer pair between two accounts.

### Request body

```json
{
  "title": "Move to savings",
  "amount": 500.00,
  "date": "2026-08-01",
  "fromAccountId": "<checking-id>",
  "toAccountId": "<savings-id>",
  "description": "Monthly savings"
}
```

Both accounts must share the same currency. `fromAccountId` and `toAccountId` must differ.

## GET /transactions

List transactions with pagination.

### Query parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number |
| `limit` | `10` | Items per page |
| `type` | — | Filter: `income`, `expense`, or `transfer` |

Split children are excluded from list results.

## GET /transactions/:transactionId

Get a single transaction by ID. Ownership-checked. Includes split children when applicable.

## PUT /transactions/:transactionId

Update a transaction. Recalculates account balance deltas.

Transfer legs and split children have edit restrictions — see error responses for unsupported updates.

## DELETE /transactions/:transactionId

Delete a transaction and reverse its account balance effect. Deleting a transfer removes both linked legs.

## GET /transactions/search

Search transactions by text.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search term (regex-escaped, length-capped) |
| `page` | No | Page number |
| `limit` | No | Items per page |

## GET /transactions/filter

Filter by date range using the authenticated user's timezone for day boundaries.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `startDate` | Yes | Start date (inclusive) |
| `endDate` | Yes | End date (inclusive) |
| `type` | No | Type filter |
| `page` | No | Page number |
| `limit` | No | Items per page |

## GET /transactions/download

Export transactions as CSV. Supports the same filters as list/search endpoints via query parameters.

## POST /transactions/duplicate/:transactionId

Duplicate an existing transaction. Creates a new entry with the same field values.

## POST /transactions/bulk/delete

Delete multiple transactions in one request.

### Request body

```json
{
  "transactionIds": ["<id-1>", "<id-2>"]
}
```

Transfer-pair legs are deduplicated when both are selected.

## PATCH /transactions/bulk/category

Change category on multiple transactions.

### Request body

```json
{
  "transactionIds": ["<id-1>", "<id-2>"],
  "categoryId": "<new-category-id>"
}
```

Rejects requests that include transfer transactions.

## POST /transactions/:transactionId/receipts

Attach an uploaded receipt to a transaction. See [Receipts API](./receipts-api.md).

## DELETE /transactions/:transactionId/receipts/:receiptId

Detach a receipt from a transaction.

## Related pages

- [API Overview](./api-overview.md)
- [Categories API](./categories-api.md)
- [Accounts API](./accounts-api.md)
- [Receipts API](./receipts-api.md)
