---
title: Frequently Asked Questions
---

## General

### What is spndr?

spndr is a personal finance web application for tracking transactions, account balances, categories, and savings. It is built for students and young adults who want a clear picture of their money without complexity.

### Is spndr free to use?

spndr is open source under the Apache-2.0 License. You can run it locally or deploy it on your own infrastructure at no cost.

### Do I need to create an account?

Yes. spndr requires registration to keep your financial data private and scoped to your user account.

## Transactions and categories

### Where do I add income and expenses?

Use the **Transactions** page (`/transactions`). The old separate Income and Expense pages redirect there. You can filter by type using the tabs or query parameter (`?type=income` or `?type=expense`).

### Are categories predefined?

spndr provides nine master categories (Food, Transport, Entertainment, Housing, Education, Health, Shopping, Income, Other). You create your own sub-categories under each master with custom names, icons, and colors.

### Does adding a transaction update my account balance?

Yes. Every transaction links to an account. Creating, editing, or deleting a transaction updates that account's balance automatically.

### Can I move money between accounts?

Yes. Use **Transfers** on the Transactions page. Transfers create a linked pair of entries and move money between two accounts without changing your net worth.

### Can I split one expense across categories?

Yes. Enable **Split expense** when creating an expense. Each split line needs a category and amount, and the lines must sum to the total.

### Can I attach receipts?

Yes. Upload JPEG, PNG, WebP, or PDF files up to 5 MB per receipt. Attach them when creating or editing a transaction.

### Can I export my data?

The backend supports CSV export for transactions via `GET /transactions/download`. The web UI does not currently include an export button.

## Accounts

### What happens when I archive an account?

The account is hidden from your list and excluded from balance calculations. It is not permanently deleted. The default flag is cleared if the archived account was the default.

### Can I have multiple default accounts?

No. Only one active account can be default at a time.

### Why does my savings account not affect spendable balance?

spndr treats savings as set-aside money. Spendable balance only includes checking and cash account balances, minus any saver allocation.

## Saver and pushover

### What is the difference between saver and pushover?

The **saver** is your active savings pool - money you set aside during the current period. **Pushover** is the month-end action that snapshots your saver balance into history and resets the saver to zero.

### Can I undo a pushover rollover?

No. Rollover history records are permanent. Once you roll over, the saver resets to zero and a history entry is created.

### What is the default deposit percentage?

30% of your spendable balance. You can change this value before each deposit.

## Balances

### Why does my net worth differ from total income minus expenses?

If you have active accounts, spndr calculates net worth from account balances, not from income and expense totals. Income and expenses become activity metrics only.

### Why is my spendable balance zero?

Your spendable balance may be zero if:

- Your liquid account balances (checking + cash) are zero
- Your saver balance equals or exceeds your liquid balance
- In legacy mode, your net worth equals your saver balance

## Authentication

### Can I change my password or email?

spndr does not currently provide a profile or settings page for changing account details.

### How long does my session last?

Sessions last as long as your JWT token is valid. The default expiry is 7 days, configured on the server.

### What happens if I log out?

spndr clears your token from local storage and redirects you to the login page. Your data remains in the database.

## Technical

### What technologies does spndr use?

- **Backend:** TypeScript, Node.js, Express, MongoDB, JWT
- **Frontend:** React, Vite, TypeScript, Tailwind CSS, Axios

See the [Developers](../developers/overview.md) section for more details.

### I upgraded from an older version. Where is my data?

Run the migration script from `backend/`: `npm run migrate:transactions`. See [Data Migration](../developers/data-migration.md) for details.

### Where can I report bugs?

Open an issue on the [GitHub repository](https://github.com/RRI-Atharv37/spndr/issues).
