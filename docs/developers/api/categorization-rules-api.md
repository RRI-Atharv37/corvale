---
title: Categorization Rules API
---

## Endpoints

All routes are mounted at `/api/v1/categorization-rules` and require authentication.

## POST /categorization-rules

Create a rule.

### Request body

```json
{
  "name": "Coffee shop",
  "matchType": "description_contains",
  "matchValue": "starbucks",
  "categoryId": "<category-id>",
  "tags": [],
  "priority": 0,
  "isActive": true
}
```

| `matchType` | Additional required fields |
|-------------|------------------------------|
| `description_contains` | `matchValue` (string, up to 200 characters) |
| `description_equals` | `matchValue` |
| `amount_range` | At least one of `amountMin`/`amountMax` (min must be ≤ max) |
| `account_id` | `accountId` (must belong to the user) |

`categoryId` is always required.

## GET /categorization-rules

List the user's rules.

## GET /categorization-rules/:ruleId

## PUT /categorization-rules/:ruleId

Same validation as create.

## DELETE /categorization-rules/:ruleId

## POST /categorization-rules/test

Dry-run a rule set against a hypothetical transaction without creating anything.

### Request body

```json
{ "title": "Starbucks", "description": "Coffee", "amount": 5.5, "accountId": "<account-id>" }
```

Response is either `{ "matched": false }` or `{ "matched": true, "ruleId", "ruleName", "categoryId", "tags" }`.

## POST /categorization-rules/bulk-apply

Re-evaluates every existing non-transfer transaction against active rules. Only updates a transaction when its category or tags would actually change (merging, not replacing, existing tags). Returns `{ message, updated, skipped }`.

## Matching behavior

- Rules are evaluated in `priority` descending, then `createdAt` ascending order; the **first match wins**.
- Inactive rules and transfer transactions are never matched.
- **Rule application on transaction create is automatic**, not opt-in: creating a non-split, non-transfer transaction runs the matching rules and, on a match, overwrites the submitted `categoryId` and merges in the rule's tags.

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing required field for the chosen `matchType`, invalid amount range |
| 403 | Rule belongs to another user |
| 404 | Rule not found |

## Related pages

- [API Overview](../guides/api-overview.md)
- [Auto-Categorization Rules](../../categories/categorization-rules.md)
- [Tags API](./tags-api.md)
