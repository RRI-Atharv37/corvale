---
title: Managing Transactions
---

## Search, filter, sort, and edit your ledger

The Transactions page gives you full control over your recorded activity.

## Searching

Use the **search bar** at the top of the list to find transactions by text. Corvale searches titles, descriptions, and related fields. Results replace the main list while a search is active.

Clear the search field to return to the full paginated list.

## Date range filter

Use the **start date** and **end date** fields to narrow transactions to a specific period. Corvale normalizes dates using your account timezone, so day boundaries match your local calendar.

## Sorting

Choose how to order the list:

| Sort by | Options |
|---------|---------|
| **Date** | Most recent or oldest first |
| **Amount** | Highest or lowest first |
| **Category** | Alphabetical by category name |

## Pagination

Transactions display **10 per page**. Use the pagination controls at the bottom to move between pages.

## Editing a transaction

1. Find the transaction in the list.
2. Click the **edit** (pencil) icon.
3. Update any fields in the modal.
4. Click **Save**.

Editing a transaction recalculates the linked account balance to reflect the change.

## Deleting a transaction

1. Click the **delete** (trash) icon on a transaction row.
2. Confirm in the dialog.

Deleting removes the entry and reverses its effect on the account balance.

### Transfer deletions

Deleting a transfer removes **both legs** of the linked pair and restores both account balances. Corvale warns you before deleting a transfer.

## Duplicating a transaction

From the API, you can duplicate an existing transaction to pre-fill a new entry. The web UI focuses on create/edit/delete; duplication is available for integrations via the [Transactions API](../developers/transactions-api.md).

## CSV export

Export your transactions as a CSV file through the API (`GET /transactions/download`). The web UI does not include an export button yet, but the backend supports filtered exports for developers and scripts.

## Related pages

- [Transactions Overview](./overview.md)
- [Adding Transactions](./adding-transactions.md)
- [Transfers and Splits](./transfers-and-splits.md)
- [Receipts and Bulk Actions](./receipts-and-bulk-actions.md)
