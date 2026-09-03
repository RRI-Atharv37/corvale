---
title: Transaction Templates API
---

## Endpoints

All routes are mounted at `/api/v1/transaction-templates` and require authentication.

## POST /transaction-templates

Create a template.

### Request body

```json
{
  "name": "Morning coffee",
  "type": "expense",
  "amount": 5,
  "accountId": "<account-id>",
  "categoryId": "<category-id>",
  "tags": [],
  "description": ""
}
```

`type` is `income` or `expense` (transfers aren't supported). `accountId`/`categoryId` must belong to the requesting user.

## GET /transaction-templates

## GET /transaction-templates/:templateId

## PUT /transaction-templates/:templateId

## DELETE /transaction-templates/:templateId

## POST /transaction-templates/:templateId/apply

Creates a real, posted transaction from the template.

### Request body

```json
{ "date": "2026-08-19", "workspaceId": null }
```

Both fields are optional - `date` defaults to now. If `workspaceId` is supplied, the caller needs at least `editor` access to that workspace, and the template's account must belong to the same workspace.

The created transaction uses the template's account, category, type, amount, tags, and description (`title` is set to the template's name), updates the linked account's balance, and triggers a budget-over-limit notification check. Returns the created transaction (201).

## Related pages

- [API Overview](../guides/api-overview.md)
- [Templates Overview](../../templates/overview.md)
- [Transactions API](./transactions-api.md)
