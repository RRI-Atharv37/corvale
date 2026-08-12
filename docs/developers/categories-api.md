---
title: Categories API
---

## Endpoints

All category routes are mounted at `/api/v1/categories`. All require authentication.

Master categories are seeded automatically on first access. They have `userId: null` and cannot be modified through the API.

## POST /categories

Create a user sub-category under a master.

### Request body

```json
{
  "masterCategoryId": "<master-id>",
  "name": "Coffee shops",
  "icon": "coffee",
  "color": "#EF4444",
  "isDefault": false,
  "sortOrder": 0
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `masterCategoryId` | Yes | ID of a master category |
| `name` | Yes | Unique within master group |
| `icon` | No | Icon key from preset library |
| `color` | No | Hex color string |
| `isDefault` | No | Unsets previous default when `true` |
| `sortOrder` | No | Auto-assigned if omitted |

## GET /categories

List all categories for the authenticated user.

### Response shape

Returns master categories and user sub-categories grouped for client use:

```json
{
  "success": true,
  "data": {
    "masters": [ /* master category objects */ ],
    "userCategories": [ /* user sub-category objects */ ]
  }
}
```

## GET /categories/:categoryId

Get a single category by ID. Ownership-checked for user categories.

## PUT /categories/:categoryId

Update a user sub-category. Master categories cannot be updated.

### Updatable fields

| Field | Notes |
|-------|-------|
| `name` | Must remain unique within master |
| `icon` | Icon key |
| `color` | Hex color |
| `isDefault` | Set to `true` to make default |

## PUT /categories/reorder

Reorder user sub-categories within a master group.

### Request body

```json
{
  "masterCategoryId": "<master-id>",
  "orderedCategoryIds": ["<id-1>", "<id-2>", "<id-3>"]
}
```

## DELETE /categories/:categoryId

Archive a user sub-category (soft delete). Clears default flag if set.

## Master categories

These master categories are seeded idempotently:

| Name | Icon |
|------|------|
| Food | utensils |
| Transport | car |
| Entertainment | film |
| Housing | home |
| Education | book |
| Health | heart |
| Shopping | shopping-bag |
| Income | trending-up |
| Other | more-horizontal |

## Related pages

- [API Overview](./api-overview.md)
- [Transactions API](./transactions-api.md)
