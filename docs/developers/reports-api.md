---
title: Reports API
---

## Endpoints

All routes are mounted at `/api/v1/dashboard/reports` and require authentication. Most accept the same period parameters as the [Dashboard API](./dashboard-api.md) (`startDate`/`endDate`, or `period`, or `workspaceId`).

## GET /dashboard/reports/averages

Average income and spending over the period.

## GET /dashboard/reports/largest-expenses

Query param `limit` (default `10`). Returns the largest expense transactions in the period.

## GET /dashboard/reports/spending-trends

## GET /dashboard/reports/income-vs-expense

## GET /dashboard/reports/savings-rate

## GET /dashboard/reports/recurring-totals

Aggregate totals contributed by active recurring rules.

## GET /dashboard/reports/budget-analysis

## GET /dashboard/reports/spending-analysis

## GET /dashboard/reports/crossover-point

The point where the savings trend and spending trend intersect.

## POST /dashboard/reports/query

Custom report builder.

### Request body

```json
{
  "splitBy": "category",
  "chartType": "bar",
  "dataType": "expense",
  "groupBy": "month",
  "startDate": "2026-01-01",
  "endDate": "2026-08-01"
}
```

| Field | Description |
|-------|-------------|
| `splitBy` | `total`, `time`, `category`, or `paymentMethod` |
| `chartType` | `table`, `bar`, `line`, `area`, or `donut` |
| `dataType` | `income`, `expense`, or `both` |
| `groupBy` | `day`, `week`, or `month` (for time-based splits) |

## POST /dashboard/reports/generate

Same body as `/query`, plus `metrics` (array of metric keys) and optional `format` (for example `csv`). When `format` is supplied, the response streams a file download instead of JSON.

## Saved reports

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/reports/saved` | List saved report configs |
| `POST` | `/dashboard/reports/saved` | Save a report config (`name` + the query fields above) |
| `PUT` | `/dashboard/reports/saved/:reportId` | Update a saved report |
| `DELETE` | `/dashboard/reports/saved/:reportId` | Delete a saved report |
| `GET` | `/dashboard/reports/saved/:reportId/run` | Re-run a saved config against live data |

Saved reports store only the configuration - running one recalculates results from current transactions each time.

## Related pages

- [API Overview](./api-overview.md)
- [Dashboard API](./dashboard-api.md)
- [Custom Reports and Saved Reports](../reports/custom-reports-and-saved-reports.md)
