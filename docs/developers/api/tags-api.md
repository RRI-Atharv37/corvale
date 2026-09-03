---
title: Tags API
---

## Endpoints

All routes are mounted at `/api/v1/tags` and require authentication.

## POST /tags

Create a tag. Body: `{ "name": "Trip", "color": "#3b82f6" }`. `color` is optional - Corvale assigns a default color if omitted. Tag names are unique per user (case-insensitive).

## GET /tags

List the authenticated user's tags.

## GET /tags/:tagId

## PUT /tags/:tagId

Update a tag's name or color. Renaming cascades: every transaction currently carrying the old tag name is updated to the new name.

## DELETE /tags/:tagId

Deletes the tag document. Existing transactions that reference the deleted tag's name are not modified.

## POST /tags/dedupe

Scans the user's transactions for free-text tag strings that don't yet have a matching `Tag` document and creates one for each. Returns `{ created, skipped, tags }`.

## Notes

Transactions store tags as a plain string array (`tags: string[]`), not references to `Tag` documents - the `Tag` model exists to give those strings a color and a management UI, and to power the tag picker's suggestions.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Tags Overview](../../tags/overview.md)
- [Transactions API](./transactions-api.md)
