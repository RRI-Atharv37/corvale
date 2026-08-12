---
title: Expense API
---

## Endpoints

All expense routes are mounted at `/api/v1/expense`. All require authentication.

## POST /expense/create

Create a new expense entry.

### Request body

```json
{
  "title": "Weekly groceries",
  "amount": 85.50,
  "category": "Food",
  "date": "2026-08-10",
  "description": "Supermarket run",
  "paymentMethod": "Debit card",
  "recurring": "Weekly",
  "tags": ["essential", "food"]
}
```

| Field | Required | Type |
|-------|----------|------|
| `title` | Yes | string |
| `amount` | Yes | number |
| `category` | Yes | string |
| `date` | Yes | date string |
| `description` | No | string |
| `paymentMethod` | No | string |
| `recurring` | No | string |
| `tags` | No | string array |

## GET /expense

List expense entries with pagination.

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
    "data": [ /* expense entries */ ],
    "meta": {
      "pageNumber": 1,
      "totalPages": 5,
      "totalExpenses": 42
    }
  }
}
```

## GET /expense/:expenseId

Get a single expense entry by ID. Ownership-checked.

## PUT /expense/:expenseId

Update an expense entry. Supports partial updates.

## DELETE /expense/:expenseId

Delete an expense entry permanently. Ownership-checked.

## GET /expense/filter

Filter expenses by date range.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `startDate` | Yes | Start of range (ISO date) |
| `endDate` | Yes | End of range (ISO date) |

## GET /expense/search

Search expense entries by keyword across title, description, category, and tags.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `keyword` | Yes | Search term |

## GET /expense/group-by-category

Aggregate expense totals grouped by category.

## GET /expense/group-by-payment-method

Aggregate expense totals grouped by payment method.

## GET /expense/download

Download all expense entries as a CSV file.

## GET /expense/report

Generate a filtered expense report with total amount.

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `startDate` | Yes | Start of range |
| `endDate` | Yes | End of range |

Response includes filtered entries and a `totalAmount` in the meta object.

## POST /expense/duplicate/:expenseId

Duplicate an existing expense entry with today's date.

## Related pages

- [API Overview](./api-overview.md)
- [Expense Overview](../expense/overview.md)
