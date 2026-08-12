---
title: Income API
---

## Endpoints

All income routes are mounted at `/api/v1/income`. All require authentication.

## POST /income/create

Create a new income entry.

### Request body

```json
{
  "title": "Monthly salary",
  "amount": 3500.00,
  "date": "2026-08-01",
  "source": "Acme Corp",
  "category": "Salary",
  "description": "August paycheck",
  "icon": "💰"
}
```

| Field | Required | Type |
|-------|----------|------|
| `title` | Yes | string |
| `amount` | Yes | number |
| `date` | Yes | date string |
| `source` | No | string |
| `category` | No | string |
| `description` | No | string |
| `icon` | No | string |

## GET /income

List income entries with pagination.

### Query parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number |
| `limit` | `10` | Items per page |

### Response

```json
{
  "success": true,
  "data": {
    "data": [ /* income entries */ ],
    "meta": {
      "pageNumber": 1,
      "totalPages": 3,
      "totalIncomes": 25
    }
  }
}
```

## GET /income/:incomeId

Get a single income entry by ID. Ownership-checked.

## PUT /income/:incomeId

Update an income entry. Supports partial updates — send only the fields you want to change.

## DELETE /income/:incomeId

Delete an income entry permanently. Ownership-checked.

## GET /income/filter

Filter income by date range.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `startDate` | Yes | Start of range (ISO date) |
| `endDate` | Yes | End of range (ISO date) |

## GET /income/search

Search income entries by keyword.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `keyword` | Yes | Search term |

Searches across title, source, description, category, amount, and date fields.

## GET /income/group-by-category

Aggregate income totals grouped by category.

## GET /income/download

Download all income entries as a CSV file.

## POST /income/duplicate/:incomeId

Duplicate an existing income entry. The copy uses today's date and retains all other fields.

## Related pages

- [API Overview](./api-overview.md)
- [Income Overview](../income/overview.md)
