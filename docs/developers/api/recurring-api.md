---
title: Recurring Rules API
---

## Endpoints

All routes are mounted at `/api/v1/recurring-rules` and require authentication.

## POST /recurring-rules

Create a recurring rule.

### Request body

```json
{
  "title": "Rent",
  "type": "expense",
  "amount": 1200,
  "currency": "USD",
  "accountId": "<account-id>",
  "categoryId": "<category-id>",
  "interval": "monthly",
  "customIntervalDays": null,
  "nextDueDate": "2026-09-01",
  "description": "",
  "paymentMethod": "",
  "tags": []
}
```

| Field | Required | Description |
|-------|----------|--------------|
| `title`, `type`, `amount`, `accountId`, `categoryId`, `interval`, `nextDueDate` | Yes | `type` is `income` or `expense`; transfers not supported |
| `interval` | Yes | One of `daily, weekly, biweekly, monthly, quarterly, yearly, custom` |
| `customIntervalDays` | Only if `interval='custom'` | Number of days between occurrences |
| `currency`, `description`, `paymentMethod`, `tags` | No | `tags` is a string array |

Amount must be greater than 0. `nextDueDate` is parsed as `YYYY-MM-DD` in the user's timezone.

## GET /recurring-rules

List rules. Query params: `includeArchived`, `isActive`, `workspaceId`.

## GET /recurring-rules/:ruleId

## PUT /recurring-rules/:ruleId

Same body fields as create. Editing an archived rule returns 400. Also accepts `isCancelled`/`isActive` toggles.

## DELETE /recurring-rules/:ruleId

Archives the rule (`isArchived: true`, `isActive: false`). Archiving an already-archived rule returns 400.

## POST /recurring-rules/generate-drafts

Generates draft transactions for every due, active rule owned by the user.

## POST /recurring-rules/:ruleId/generate-drafts

Same, scoped to a single rule.

Draft generation is capped at 52 catch-up drafts per rule per call, to avoid flooding the inbox for a long-neglected rule. A due date that already has a draft is skipped.

## GET /recurring-rules/drafts

List draft transactions generated from rules. Query param: `ruleId`.

## POST /recurring-rules/drafts/:transactionId/confirm

Posts a draft: flips its status to `posted` and applies it to the linked account's balance.

## POST /recurring-rules/drafts/:transactionId/dismiss

Deletes a draft transaction without posting it.

Both confirm and dismiss require the target transaction to have `status: 'draft'` and a `recurringPaymentId` - otherwise 400.

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Invalid amount, interval, missing custom interval days, editing an archived rule, non-draft target for confirm/dismiss |
| 403 | Rule or draft belongs to another user/workspace |
| 404 | Rule or draft not found |

## Related pages

- [API Overview](../guides/api-overview.md)
- [Recurring Overview](../../recurring/overview.md)
- [Notifications API](./notifications-api.md)
