---
title: Creating an Account
---

## Add a new financial account

Follow these steps to create an account in spndr.

## Step-by-step

1. Navigate to **Accounts** from the sidebar.
2. Click the **Add account** button in the page header.
3. Fill in the creation form:
   - **Name** (required) - e.g., "Main checking", "Cash wallet"
   - **Type** (required) - choose from Checking, Cash, Credit, or Savings
   - **Currency** (required) - defaults to USD; options include USD, EUR, GBP, INR, CAD, AUD
   - **Opening balance** (required) - the starting balance, defaults to `0.00`
4. Click **Create account**.

On success, spndr creates the account, sets `currentBalance` equal to your opening balance, and refreshes the list.

## Default account behavior

- If this is your **first active account**, spndr automatically marks it as your default account.
- If you already have accounts, the new account is not set as default unless you change it later.

## What you cannot set manually

The server sets `currentBalance` based on your opening balance. You cannot directly set or edit balance fields after creation through the UI.

## Validation

- Account name must not be empty.
- Opening balance must be a valid number.
- Account type must be one of the four supported types.

## After creating an account

Once you have at least one active account:

- Your dashboard switches to accounts mode for balance calculations.
- An **In Accounts** summary card appears on the dashboard.
- Spendable balance derives from your checking and cash account balances.

## Related pages

- [Account Types](./account-types.md)
- [Default Accounts](./default-accounts.md)
- [Accounts Overview](./overview.md)
