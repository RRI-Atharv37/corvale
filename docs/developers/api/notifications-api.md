---
title: Notifications API
---

## Endpoints

All routes are mounted at `/api/v1/notifications` and require authentication.

## GET /notifications

Returns `{ notifications, unreadCount }`. Limited to the 50 most recent non-dismissed notifications, newest first. This call also lazily checks for newly-due bill reminders for the requesting user before returning results.

## PATCH /notifications/:notificationId/read

Marks a single notification as read.

## PATCH /notifications/:notificationId/dismiss

Marks a notification dismissed (and read, if it wasn't already). Dismissed notifications no longer appear in `GET /notifications`.

## PATCH /notifications/read-all

Marks every unread notification read.

## Notification types

| `type` | `referenceType` | Trigger |
|--------|------------------|---------|
| `budget_over_limit` | `budget` | A posted expense pushes a budget's spending past its limit for the current period |
| `bill_due` | `recurring_rule` | An active recurring expense rule's due date falls within the reminder window (default 3 days) |
| `savings_milestone` | `savings_goal` | A contribution crosses the 25%, 50%, 75%, or 100% mark for a goal |
| `workspace_invite` | `workspace` | Another user invites you to a workspace |

Each notification carries a `dedupeKey` unique per user, so the same event (for example, the same budget going over in the same period) only ever creates one notification.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Notifications Overview](../../notifications/overview.md)
- [Budgets API](./budgets-api.md)
- [Recurring Rules API](./recurring-api.md)
