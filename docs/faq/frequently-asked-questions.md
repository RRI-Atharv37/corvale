---
title: Frequently Asked Questions
---

## General

### What is Corvale?

Corvale is a personal finance web application for tracking transactions, account balances, categories, and savings. It is built for students and young adults who want a clear picture of their money without complexity.

### Is Corvale free to use?

Yes, both ways. The hosted service is free: there are no paid plans, no trial that turns into a charge, and no payment details to give. If paid plans ever launch, Corvale will publish subscription terms and ask you to accept them before any charge is made - see the [Terms of Service](../legal/terms.md).

Corvale is also open source under the GNU AGPL v3.0 License, so you can run it locally or deploy it on your own infrastructure at no cost. If you modify it and offer it to others over a network, the AGPL requires you to publish your changes.

### Do I need to create an account?

Yes. Corvale requires registration to keep your financial data private and scoped to your user account.

### Does Corvale connect to my bank?

No. Corvale has no bank connection of any kind. It never asks for your banking credentials, never retrieves your balances, and never sees a transaction you did not enter or import yourself. Every number in Corvale comes from you - by typing it in, or by uploading a statement file you exported from your bank. See the [Privacy Policy](../legal/privacy.md).

## Transactions and categories

### Where do I add income and expenses?

Use the **Transactions** page (`/transactions`). The old separate Income and Expense pages redirect there. You can filter by type using the tabs or query parameter (`?type=income` or `?type=expense`).

### Are categories predefined?

Corvale provides nine master categories (Food, Transport, Entertainment, Housing, Education, Health, Shopping, Income, Other). You create your own sub-categories under each master with custom names, icons, and colors.

### Does adding a transaction update my account balance?

Yes. Every transaction links to an account. Creating, editing, or deleting a transaction updates that account's balance automatically.

### Can I move money between accounts?

Yes. Use **Transfers** on the Transactions page. Transfers create a linked pair of entries and move money between two accounts without changing your net worth.

### Can I split one expense across categories?

Yes. Enable **Split expense** when creating an expense. Each split line needs a category and amount, and the lines must sum to the total.

### Can I attach receipts?

Yes. Upload JPEG, PNG, WebP, or PDF files up to 5 MB per receipt. Attach them when creating or editing a transaction.

### Do I have to be 18 to use Corvale?

Yes. The hosted Corvale service is for adults only, and you confirm your age when you sign up.
India's data protection law requires verified parental consent for anyone under 18, which Corvale
cannot reliably do. Corvale stores only your answer, never your date of birth. See the
[Privacy Policy](../legal/privacy.md).

### Can I export my data?

Yes, and export is never restricted. Open **Settings → Backup and Restore** to download everything as JSON, or as a ZIP that includes your receipt files. You can also export transactions as CSV from the Transactions page. See [Backup and Restore](../backup-restore/overview.md).

## Budgets and savings goals

### How do budgets work?

Create a budget on the **Budgets** page (`/budgets`). Corvale compares your limit against **posted expense** transactions in the budget period. Draft transactions and transfers do not count. See [Budgets Overview](../budgets/overview.md).

### What is the difference between saver and savings goals?

The **Saver** is a discretionary pool you fund from spendable balance during the month. **Savings Goals** are named targets with progress bars, optional deadlines, and contribution history. They serve different purposes - see [Savings Goals Overview](../savings-goals/overview.md) and [Saver Overview](../saver/overview.md).

### Can savings goals automatically save for me?

You can enable **automatic contributions** on a goal (weekly or monthly). When due, process the contribution from the goal card. Corvale does not pull money from bank accounts - contributions track progress toward a target you define.

## Accounts

### What happens when I archive an account?

The account is hidden from your list and excluded from balance calculations. It is not permanently deleted. The default flag is cleared if the archived account was the default.

### Can I have multiple default accounts?

No. Only one active account can be default at a time.

### Why does my savings account not affect spendable balance?

Corvale treats savings as set-aside money. Spendable balance only includes checking and cash account balances, minus any saver allocation.

## Saver and pushover

### What is the difference between saver and pushover?

The **saver** is your active savings pool - money you set aside during the current period. **Pushover** is the month-end action that snapshots your saver balance into history and resets the saver to zero.

### Does the saver move money out of my bank account?

No. Nothing about the saver or pushover moves real money. Adding to the saver creates no transaction and changes no account balance - it only lowers the spendable balance Corvale displays, as a reminder that you have earmarked that amount. A pushover rollover resets the saver to zero, which returns that amount to your displayed spendable balance. Your bank account and net worth never change. See [Saver Overview](../saver/overview.md#what-the-saver-is).

### Can I undo a pushover rollover?

No. Rollover history records are permanent. Once you roll over, the saver resets to zero and a history entry is created.

### What is the default deposit percentage?

30% of your spendable balance. You can change this value before each deposit.

## Balances

### Why does my net worth differ from total income minus expenses?

If you have active accounts, Corvale calculates net worth from account balances, not from income and expense totals. Income and expenses become activity metrics only.

### Why is my spendable balance zero?

Your spendable balance may be zero if:

- Your liquid account balances (checking + cash) are zero
- Your saver balance equals or exceeds your liquid balance
- In legacy mode, your net worth equals your saver balance

## Authentication

### Can I change my password?

Use **Forgot password?** on the login page to request a reset link. See [Resetting Your Password](../authentication/resetting-your-password.md). There is no in-app password change form while signed in.

### Can I change my email or name?

Corvale does not currently provide UI to edit your email or full name after registration.

### Do I have to verify my email?

Corvale emails you a verification link when you sign up. You can use Corvale without clicking it, but verifying confirms the address is really yours - and that address is where a password reset gets sent. To send a new link, open `/verify-email` and click **Resend verification email**. See [Creating an Account](../authentication/creating-an-account.md#verifying-your-email).

### How do I delete my account?

Open **Settings** and scroll to **Delete my account** at the bottom. You confirm with your password. Deletion immediately and irreversibly removes your account from the live service: it erases your records and your uploaded receipt files outright, rather than hiding them behind a flag. Backup copies are overwritten on the retention schedule in the [Privacy Policy](../legal/privacy.md). Export first if you want a copy - export is never restricted. See [Your Data and Privacy](../legal/your-data-and-privacy.md).

### How long does my session last?

Your access token expires after a short interval (default **15 minutes**). Corvale refreshes it automatically using a longer-lived refresh token cookie (default **7 days**). See [Sessions and Logout](../authentication/sessions-and-logout.md).

### What happens if I log out?

Corvale revokes your refresh token, clears local storage, and redirects you to the login page. Use **Logout all devices** in Settings to invalidate every session. Your data remains in the database.

## Recurring transactions

### How do I set up a repeating bill or paycheck?

Create a rule on the **Recurring** page (`/recurring`) with an amount, account, category, and interval. Corvale doesn't post anything automatically - it generates a draft transaction for each due date, which you confirm or dismiss from your draft inbox. See [Recurring Overview](../recurring/overview.md).

### Why didn't my recurring rule post a transaction?

Recurring rules only generate **drafts**, not posted transactions. Click **Sync drafts** on the Recurring page, then confirm the draft to post it and update your account balance.

## Tags, rules, and templates

### What's the difference between a tag and a category?

Every transaction needs exactly one category, used for budgeting and reports. Tags are optional and a transaction can have several - use them for cross-cutting labels like a trip or project. See [Tags Overview](../tags/overview.md).

### Can Corvale categorize transactions for me automatically?

Yes. Create an auto-categorization rule on `/categories/rules` that matches on description, amount range, or account. Matching rules apply automatically the moment a transaction is created, and you can also run them against your existing transactions with **Apply to existing**. See [Auto-Categorization Rules](../categories/categorization-rules.md).

### How do quick-add templates work?

Create a template in Settings under **Quick-add templates**, then apply it from the **Quick add** dropdown on Home or Transactions to instantly create a posted transaction with the template's saved details. See [Templates Overview](../templates/overview.md).

## Reports and notifications

### What's the difference between Dashboard and Reports?

**Dashboard** (Home) shows a handful of summary stat cards for a quick glance. **Reports** (`/reports`) has the full set of charts, a custom report builder, and saved reports for deeper analysis. See [Reports Overview](../reports/overview.md).

### What triggers a notification?

Four events: a budget going over its limit, a recurring bill due soon, a savings goal crossing a milestone, and a workspace invite. Click the bell icon in the header to view them. See [Notifications Overview](../notifications/overview.md).

## Workspaces

### Can I share my finances with someone else?

Yes. Create a workspace on `/workspaces` and invite people by email as an editor or viewer. Switching to a workspace in the sidebar switcher scopes your accounts, transactions, budgets, and more to that shared space - it never mixes with your personal data. See [Workspaces Overview](../workspaces/overview.md).

### What can a viewer do in a workspace?

Viewers can see everything in the workspace but can't create, edit, or delete anything. Corvale shows a banner reminding you when you're in a view-only workspace. See [Roles and Permissions](../workspaces/roles-and-permissions.md).

## Reconciliation and multi-currency

### How do I check my account against my bank statement?

Click the reconcile icon on an account on the **Accounts** page, enter your statement's end date and balance, and mark transactions cleared as you check them against your statement. See [Reconciling an Account](../accounts/reconciling-an-account.md).

### I have accounts in different currencies - can Corvale show one total?

Yes, if you set exchange rates in Settings. Once a rate exists for a currency pair, Corvale shows a converted balance next to any account not already in your preferred currency. See [Multi-Currency Balances](../accounts/multi-currency-balances.md).

## Import and backup

### Can I import transactions from my bank?

Yes. Click **Import** on the Transactions page and upload a CSV, OFX, or QFX file. Corvale detects likely duplicates against your existing transactions and lets you skip, import, or merge each one. See [Import Overview](../import/overview.md).

### How do I back up my data or move it to a new device?

Open **Settings** and use **Backup & restore** to export a JSON or ZIP file, or upload one to restore. Restoring always creates new records rather than overwriting existing ones. See [Backup and Restore Overview](../backup-restore/overview.md).

## Technical

### What technologies does Corvale use?

- **Backend:** TypeScript, Node.js, Express, MongoDB, JWT
- **Frontend:** React, Vite, TypeScript, Tailwind CSS, Axios

See the [Developers](../developers/guides/overview.md) section for more details.

### I upgraded from an older version. Where is my data?

Run the migration script from `backend/`: `npm run migrate:transactions`. See [Data Migration](../developers/guides/data-migration.md) for details.

### Where can I report bugs?

Open an issue on the [GitHub repository](https://github.com/RRI-Atharv37/corvale/issues). Please don't report security vulnerabilities there - use the repository's **Security** tab instead, and see [Contact](../legal/contact.md) for privacy and data-rights requests.
