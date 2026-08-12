---
title: Data Migration
---

## Migrate legacy income and expense data to transactions

If you used spndr before Phase 1c, your income and expense entries may still live in the legacy collections. The migration script copies that data into the unified **Transaction** collection and maps string categories to Category foreign keys.

## When to run migration

Run migration when:

- You upgraded from a version that used separate Income and Expense pages
- You have existing income/expense data that does not appear on the Transactions page
- You want account balances to reflect historical activity

The script is **idempotent** - re-running it skips records that were already migrated.

## Commands

From the `backend/` folder:

```bash
# Preview changes without writing
npm run migrate:transactions:dry-run

# Run migration
npm run migrate:transactions
```

## What the script does

1. Reads all **Income** records for each user and creates matching `type: income` transactions
2. Reads all **Expense** records and creates matching `type: expense` transactions
3. Maps legacy string `category` fields to Category FK refs (creates sub-categories when needed)
4. Creates a default **Primary** checking account for users who have none
5. Applies account balance deltas for migrated transactions
6. Preserves legacy `_id` values on migrated transactions for idempotency

## Category mapping

During migration, spndr attempts to match legacy category strings to existing sub-categories under the appropriate master. Unmatched strings create new sub-categories or fall back to **Other**.

## After migration

- Use the **Transactions** page and API for all new entries
- Legacy `/income` and `/expense` API routes remain available but return `Deprecation` headers
- The frontend redirects `/income` and `/expense` to `/transactions`

## Related pages

- [Transactions API](./transactions-api.md)
- [Transactions Overview](../transactions/overview.md)
- [Project Structure](./project-structure.md)
