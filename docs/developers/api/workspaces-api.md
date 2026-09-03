---
title: Workspaces API
---

## Endpoints

All routes are mounted at `/api/v1/workspaces` and require authentication.

## POST /workspaces

Create a workspace. Body: `{ "name": "Household" }`. The creator is added as `owner`.

## GET /workspaces

List workspaces the authenticated user belongs to.

## GET /workspaces/:workspaceId

## PATCH /workspaces/:workspaceId

Rename a workspace. Body: `{ "name": "New name" }`.

## GET /workspaces/:workspaceId/invites

Pending invites for the workspace. Owner only.

## POST /workspaces/:workspaceId/members

Invite a member by email. Body: `{ "email": "...", "role": "editor" }`. `role` must be `editor` or `viewer`. Owner only. Rejects self-invites, invites to existing members, and a second pending invite to the same person.

## PATCH /workspaces/:workspaceId/members/:memberUserId

Change a member's role. Body: `{ "role": "viewer" }`. Owner only; the owner's own role cannot be changed.

## DELETE /workspaces/:workspaceId/members/:memberUserId

Remove a member. The owner can remove anyone else; a member can remove themselves (leave) but the owner cannot leave.

## GET /workspaces/invites/received

Invites sent to the authenticated user.

## POST /workspaces/invites/:inviteId/accept

## POST /workspaces/invites/:inviteId/decline

Both require the invite to belong to the caller and be pending.

## Roles

| Role | Rank |
|------|------|
| `viewer` | Read-only |
| `editor` | Read/write |
| `owner` | Read/write + member management |

`assertWorkspaceMembership(workspaceId, userId, minRole)` gates every workspace-scoped endpoint elsewhere in the API (accounts, transactions, budgets, and so on) against this hierarchy.

## Scoping

Workspace-aware list endpoints accept a `workspaceId` query parameter (or body field on mutations). Omitting it scopes to the caller's personal data (`workspaceId: null`); a resource can belong to exactly one scope.

## Errors

| Status | Condition |
|--------|-----------|
| 400 | Invalid role, self-invite, duplicate invite, owner attempting to leave |
| 403 | Caller isn't a member, or lacks the required role |
| 404 | Workspace, member, or invite not found |

## Related pages

- [API Overview](../guides/api-overview.md)
- [Workspaces Overview](../../workspaces/overview.md)
- [Roles and Permissions](../../workspaces/roles-and-permissions.md)
