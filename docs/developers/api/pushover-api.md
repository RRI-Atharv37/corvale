---
title: Pushover API
---

## Endpoints

All pushover routes are mounted at `/api/v1/pushover`. All require authentication.

## POST /pushover/pushover

Perform a month-end rollover - snapshot the saver balance into history and reset the saver to zero.

### Request body

No request body required.

### Behavior

1. Reads the current saver balance for the authenticated user
2. Creates a new Pushover history record with the amount and timestamp
3. Adds the amount to the cumulative `pushoverAmount` on the Saver document
4. Resets `saverAmount` to zero
5. Returns updated balance summary

### Validation

- Saver balance must be greater than zero
- Returns **400** if saver is empty or does not exist

### Success response (200)

```json
{
  "success": true,
  "data": {
    "message": "Pushover to next month successful",
    "data": {
      "pushoverAmount": 450.00,
      "pushoverBaseline": 1200.00,
      "totalIncome": 5000.00,
      "totalExpenses": 3200.00,
      "saverBalance": 0,
      "spendableBalance": 1800.00,
      "netWorth": 1800.00,
      "remainingBalance": 1800.00
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `pushoverAmount` | Amount rolled over in this action |
| `pushoverBaseline` | Cumulative total of all rollovers |
| `spendableBalance` | Recomputed after the reset - rises by `pushoverAmount`, since spendable is derived as liquid balance minus the (now zero) saver earmark |
| `netWorth` | Unchanged by a rollover - no money moves and no account balance is touched |

## GET /pushover/history

Retrieve all pushover history records for the authenticated user.

### Success response (200)

Returns an array of pushover snapshots, sorted by most recent first:

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "userId": "...",
      "pushoverAmount": 450.00,
      "pushoverDate": "2026-08-12T10:30:00.000Z",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

History records are immutable - there are no update or delete endpoints.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Pushover Overview](../../pushover/overview.md)
- [Performing a Rollover](../../pushover/performing-a-rollover.md)
