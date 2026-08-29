---
title: Creating an Account
---

## Add a new financial account

Follow these steps to create an account in Corvale.

## Step-by-step

1. Navigate to **Accounts** from the sidebar.
2. Click the **Add account** button in the page header.
3. Fill in the creation form:
   - **Name** (required) - e.g., "Main checking", "Cash wallet"
   - **Type** (required) - choose from Checking, Cash, Credit, or Savings
   - **Currency** (required) - defaults to USD; options include USD, EUR, GBP, INR, CAD, AUD
   - **Current balance** (required) - what's in the account right now, defaults to `0.00`
   - **Balance as of** - the date that balance is accurate for, defaults to today
4. Click **Create account**.

On success, Corvale creates the account, sets `currentBalance` equal to the balance you entered, and refreshes the list.

## Balance as of a date

The **Balance as of** date tells Corvale the day your entered balance is correct for. Only transactions dated on or after that date change the running balance - anything dated earlier is treated as already included in the figure you gave.

This is what lets you enter today's balance now and safely import or back-fill older history later without the number drifting. If you plan to enter the account's *entire* history from the day it was opened, set this date to that opening day (and set the balance to what the account started with, often `0.00`) so every transaction counts.

Leaving the date empty tells Corvale there is no cutoff: every transaction on the account, regardless of date, contributes to the balance.

## Default account behavior

- If this is your **first active account**, Corvale automatically marks it as your default account.
- If you already have accounts, the new account is not set as default unless you change it later.

## What you cannot set manually

The server always derives `currentBalance` from your opening balance plus transaction activity. You can adjust the opening balance and its "as of" date later from the edit form (Corvale recalculates the current balance when you do), but you can never set the current balance directly.

## Validation

- Account name must not be empty.
- Opening balance must be a valid number.
- Balance-as-of date, if given, must be a valid date.
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
