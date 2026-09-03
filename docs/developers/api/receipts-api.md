---
title: Receipts API
---

## Endpoints

Receipt routes are mounted at `/api/v1/receipts`. All require authentication.

Files are stored on disk under `uploads/receipts/{userId}/` with per-user isolation.

## POST /receipts

Upload a receipt file.

### Request

`multipart/form-data` with a single field:

| Field | Required | Description |
|-------|----------|-------------|
| `receipt` | Yes | The file to upload |

### Allowed types

| MIME type | Extension |
|-----------|-----------|
| `image/jpeg` | `.jpg`, `.jpeg` |
| `image/png` | `.png` |
| `image/webp` | `.webp` |
| `application/pdf` | `.pdf` |

Maximum file size: **5 MB**.

### Success response (201)

Returns the created receipt object with `_id`, `originalFilename`, `mimeType`, `size`, and `createdAt`.

## GET /receipts/:receiptId

Download the receipt file. Ownership-checked. Returns the file with the correct content type.

## DELETE /receipts/:receiptId

Delete a receipt file and unlink it from any attached transactions. Ownership-checked.

## Attaching receipts to transactions

After upload, attach a receipt to a transaction:

```
POST /api/v1/transactions/:transactionId/receipts
```

### Request body

```json
{
  "receiptId": "<receipt-id>"
}
```

Detach with:

```
DELETE /api/v1/transactions/:transactionId/receipts/:receiptId
```

## Related pages

- [Transactions API](./transactions-api.md)
- [Receipts and Bulk Actions](../../transactions/receipts-and-bulk-actions.md)
