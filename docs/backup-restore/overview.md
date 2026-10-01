---
title: Backup and Restore Overview
---

## Take your data with you

Corvale can export a full backup of your data and restore it later - useful for switching devices, keeping an offline copy, or moving data between a personal account and a workspace. Find this under **Settings** (the gear icon in the header), in the **Backup & restore** section.

## Exporting a backup

Choose one of two formats:

- **Export JSON** - a single file with all your accounts, categories, tags, budgets, savings goals, recurring rules, categorization rules, quick-add templates, and transactions. It also includes your reconciliation sessions, saved reports, saver and rollover history, profile and preferences, the devices you sync from, and your workspace memberships. Receipt metadata is included, but not the receipt files themselves.
- **Export ZIP (+ receipts)** - the same data plus the actual receipt image and PDF files, bundled into one archive.

The desktop app builds its export from the copy of your data on your device and adds your reconciliation sessions, saved reports, saver history, profile, devices and workspace memberships from your account on our servers. If you are offline, it still exports everything it has and tells you which of those it left out. Export again when you are online to include them.

A workspace export contains that workspace's reconciliation sessions and saved reports only. Your saver history, profile, devices and memberships belong to you, so they are in your personal export.

## Restoring a backup

1. Choose a `.json` or `.zip` file (up to 50 MB) to upload.
2. Click **Preview restore**. Corvale checks the file without writing anything to your account, and shows you how many of each item it found, plus any warnings or errors.
3. If the preview looks right, click **Confirm restore**.

Restoring brings back your accounts, transactions and the other data you entered. The reconciliation sessions, saved reports, saver history, profile, devices and memberships stay in the file for your records and are not restored. Restoring always **creates new records** - it never overwrites or deletes your existing data, and everything gets a fresh ID. If you restore the same backup twice, you'll end up with two copies of everything in it. Receipt files only come back on restore if you originally exported (and are now restoring from) a ZIP backup.

## Related pages

- [Import Overview](../import/overview.md)
- [Account Settings](../authentication/account-settings.md)
