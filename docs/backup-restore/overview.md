---
title: Backup and Restore Overview
---

## Take your data with you

spndr can export a full backup of your data and restore it later - useful for switching devices, keeping an offline copy, or moving data between a personal account and a workspace. Find this under **Settings** (the gear icon in the header), in the **Backup & restore** section.

## Exporting a backup

Choose one of two formats:

- **Export JSON** - a single file with all your accounts, categories, tags, budgets, savings goals, recurring rules, categorization rules, quick-add templates, and transactions. Receipt metadata is included, but not the receipt files themselves.
- **Export ZIP (+ receipts)** - the same data plus the actual receipt image and PDF files, bundled into one archive.

## Restoring a backup

1. Choose a `.json` or `.zip` file (up to 50 MB) to upload.
2. Click **Preview restore**. spndr checks the file without writing anything to your account, and shows you how many of each item it found, plus any warnings or errors.
3. If the preview looks right, click **Confirm restore**.

Restoring always **creates new records** - it never overwrites or deletes your existing data, and everything gets a fresh ID. If you restore the same backup twice, you'll end up with two copies of everything in it. Receipt files only come back on restore if you originally exported (and are now restoring from) a ZIP backup.

## Related pages

- [Import Overview](../import/overview.md)
- [Account Settings](../authentication/account-settings.md)
