---
title: Receipts and Bulk Actions
---

## Attach proof and manage multiple entries at once

spndr lets you attach receipt files to transactions and perform bulk actions on selected rows.

## Receipt attachments

### Supported file types

| Type | Formats |
|------|---------|
| Images | JPEG, PNG, WebP |
| Documents | PDF |

Maximum file size: **5 MB** per file.

### Uploading a receipt

When creating or editing a transaction:

1. Use the **Receipt attachments** section in the modal.
2. Click to select a file from your device.
3. The file uploads when you save the transaction (or immediately on edit).

Receipts are stored securely per user. Only you can access your uploaded files.

### Previewing receipts

Attached receipts show as thumbnails in the transaction modal:

- **Images** display an inline preview
- **PDFs** show a document icon with a link to open the file

### Removing a receipt

Detach a receipt from a transaction using the remove control in the attachments section. Deleting a receipt file entirely removes it from storage and unlinks it from any transactions.

## Bulk actions

Select multiple transactions using the checkboxes on the left side of the list. When at least one row is selected, a **bulk action bar** appears.

### Bulk delete

1. Select the transactions you want to remove.
2. Click **Delete selected**.
3. Confirm in the dialog.

spndr reverses account balance changes for each deleted transaction. When you select both legs of a transfer pair, spndr deduplicates the delete so each pair is removed once.

### Bulk category change

1. Select one or more **income** or **expense** transactions.
2. Click **Change category**.
3. Pick the new category and confirm.

Bulk category change does **not** apply to transfers. Select only income or expense rows when changing categories.

## Related pages

- [Transactions Overview](./overview.md)
- [Managing Transactions](./managing-transactions.md)
- [Receipts API](../developers/receipts-api.md)
