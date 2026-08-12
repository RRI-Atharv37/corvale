---
title: Accounts API
---

## Endpoints

All account routes are mounted at `/api/v1/accounts`. All require authentication.

## POST /accounts

Create a new account.

### Request body

```json
{
  "name": "Main checking",
  "type": "checking",
  "currency": "USD",
  "openingBalance": 2500.00,
  "isDefault": false
}
```

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `name` | Yes | string | Display name |
| `type` | Yes | string | `checking`, `cash`, `credit`, or `savings` |
| `currency` | No | string | Defaults to `USD`; uppercased |
| `openingBalance` | No | number | Defaults to `0`; sets `currentBalance` |
| `isDefault` | No | boolean | First account auto-defaults |

`currentBalance` cannot be set directly - the server derives it from `openingBalance`.

### Success response (201)

Returns the created account object.

## GET /accounts

List all accounts for the authenticated user.

### Query parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeArchived` | `false` | Set to `true` to include archived accounts |

Accounts sort with default first, then alphabetically by name.

## GET /accounts/:accountId

Get a single account by ID. Ownership-checked.

## PUT /accounts/:accountId

Update an account. Supports partial updates.

### Updatable fields

| Field | Notes |
|-------|-------|
| `name` | Must not be empty |
| `type` | Must be a valid account type |
| `currency` | Uppercased automatically |
| `isDefault` | Set to `true` to make default; cannot set to `false` on current default |

`openingBalance` and `currentBalance` cannot be updated.

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Archived account, invalid type, empty name, or attempting to unset default |
| 403 | Account belongs to another user |
| 404 | Account not found |

## DELETE /accounts/:accountId

Archive an account (soft delete).

Sets `isArchived: true` and clears `isDefault`. The account record remains in the database.

## Account type enum

```
checking | cash | credit | savings
```

## Default account constraint

A partial unique index ensures only one active default account per user:

```
{ userId, isDefault: true } where isArchived: false
```

## Related pages

- [API Overview](./api-overview.md)
- [Accounts Overview](../accounts/overview.md)
- [Account Types](../accounts/account-types.md)
