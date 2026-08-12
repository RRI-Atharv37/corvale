---
title: Frequently Asked Questions
---

## General

### What is spndr?

spndr is a personal finance web application for tracking income, expenses, account balances, and savings. It is built for students and young adults who want a clear picture of their money without complexity.

### Is spndr free to use?

spndr is open source under the Apache-2.0 License. You can run it locally or deploy it on your own infrastructure at no cost.

### Do I need to create an account?

Yes. spndr requires registration to keep your financial data private and scoped to your user account.

## Income and expenses

### Are categories predefined?

No. Both income and expense categories are free-text fields. You type whatever category name makes sense to you.

### Does adding income or expenses update my account balances?

No. Income and expense entries are activity logs. They do not automatically change account balances. Account balances reflect the opening balance set at account creation.

### Can I export my data?

The backend supports CSV export for income and expense data via API endpoints. The web UI does not currently include export buttons.

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

### Where can I report bugs?

Open an issue on the [GitHub repository](https://github.com/RRI-Atharv37/spndr/issues).
