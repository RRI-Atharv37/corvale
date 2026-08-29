---
title: API Overview
---

## Base URL

All API routes are prefixed with:

```
/api/v1
```

In local development, the full base URL is typically:

```
http://localhost:5000/api/v1
```

## Authentication

Most routes require a valid JWT token. Include it in the request header:

```
Authorization: Bearer <token>
```

Obtain a token from the auth endpoints documented in [Authentication API](./authentication-api.md).

Auth routes (`/auth/register`, `/auth/login`) are public but rate-limited.

## Response format

### Success

```json
{
  "success": true,
  "data": <payload>
}
```

The `data` field shape varies by endpoint.

### Error

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Error description"
}
```

## Route map

| Prefix | Domain | Auth required |
|--------|--------|---------------|
| `/auth` | Authentication | Partial (see auth docs) |
| `/onboarding` | First-run onboarding wizard | Yes |
| `/transactions` | Unified transaction ledger | Yes |
| `/categories` | Category management | Yes |
| `/categorization-rules` | Auto-categorization rules | Yes |
| `/tags` | Structured tags | Yes |
| `/transaction-templates` | Quick-add templates | Yes |
| `/recurring-rules` | Recurring transactions and drafts | Yes |
| `/imports` | Bank CSV/OFX import | Yes |
| `/backup` | JSON/ZIP backup export and restore | Yes |
| `/receipts` | Receipt upload and download | Yes |
| `/accounts` | Account management | Yes |
| `/reconciliation-sessions` | Account reconciliation sessions | Yes |
| `/exchange-rates` | Manual currency exchange rates | Yes |
| `/budgets` | Budget CRUD and progress | Yes |
| `/savings-goals` | Savings goal CRUD, contributions, lifecycle | Yes |
| `/saver` | Saver deposits and withdrawals | Yes |
| `/pushover` | Rollover and history | Yes |
| `/dashboard` | Dashboard totals and time series | Yes |
| `/dashboard/reports` | Analytics reports, custom queries, saved reports | Yes |
| `/notifications` | In-app notifications | Yes |
| `/workspaces` | Shared workspaces, members, invites | Yes |
| `/forecast` | Cash flow forecast (no frontend yet) | Yes |
| `/calendar` | Unified financial calendar (no frontend yet) | Yes |
| `/subscriptions` | Subscription tracker (no frontend yet) | Yes |
| `/debts` | Debt payoff planner (no frontend yet) | Yes |
| `/desktop` | Desktop release manifest for the download page | No |
| `/income` | Legacy income CRUD (deprecated) | Yes |
| `/expense` | Legacy expense CRUD (deprecated) | Yes |

Legacy `/income` and `/expense` routes return `Deprecation` and `Link` headers pointing to `/transactions`. Prefer the [Transactions API](./transactions-api.md) for all new integrations.

## HTTP methods

Corvale uses standard REST conventions:

| Method | Usage |
|--------|-------|
| `GET` | Read data |
| `POST` | Create resources or trigger actions |
| `PUT` | Update resources |
| `PATCH` | Partial bulk updates |
| `DELETE` | Delete or archive resources |

## Ownership and security

- All resource queries filter by the authenticated user's `userId`
- Cross-user access attempts return **403 Forbidden**
- Missing resources return **404 Not Found**
- Validation errors return **400 Bad Request**

## CORS

The backend allows requests from the origin specified in `CLIENT_URL` with credentials support. Allowed methods: GET, POST, PUT, PATCH, DELETE.

## Pagination

List endpoints for transactions support pagination query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number (1-indexed) |
| `limit` | `10` | Items per page |

Paginated responses include a `meta` object with page number, total pages, and total count.

## Money format

Transaction amounts are stored as integer minor units (cents) in the database. API request and response bodies use major-unit decimals (for example, `42.99`) for client ergonomics.

## Related pages

- [Authentication API](./authentication-api.md)
- [Onboarding API](./onboarding-api.md)
- [Transactions API](./transactions-api.md)
- [Categories API](./categories-api.md)
- [Categorization Rules API](./categorization-rules-api.md)
- [Tags API](./tags-api.md)
- [Transaction Templates API](./transaction-templates-api.md)
- [Recurring Rules API](./recurring-api.md)
- [Import API](./import-api.md)
- [Backup and Restore API](./backup-restore-api.md)
- [Receipts API](./receipts-api.md)
- [Accounts API](./accounts-api.md)
- [Reconciliation API](./reconciliation-api.md)
- [Exchange Rates API](./exchange-rates-api.md)
- [Budgets API](./budgets-api.md)
- [Savings Goals API](./savings-goals-api.md)
- [Data Migration](./data-migration.md)
- [Saver API](./saver-api.md)
- [Pushover API](./pushover-api.md)
- [Dashboard API](./dashboard-api.md)
- [Reports API](./reports-api.md)
- [Notifications API](./notifications-api.md)
- [Workspaces API](./workspaces-api.md)
- [Forecast API](./forecast-api.md)
- [Calendar API](./calendar-api.md)
- [Subscriptions API](./subscriptions-api.md)
- [Debt Payoff API](./debts-api.md)
- [Desktop API](./desktop-api.md)
