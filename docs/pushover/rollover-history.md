---
title: Rollover History
---

## Review your past rollovers

The Pushover page displays a chronological list of every rollover you have performed.

## What each history entry shows

Each row in the history list includes:

| Field | Example | Description |
|-------|---------|-------------|
| **Period label** | "August 2026 rollover" | The month and year of the rollover |
| **Timestamp** | "Aug 12, 2026 10:30 AM" | Exact date and time of the rollover |
| **Amount** | $450.00 | The saver balance that was rolled over |

Entries sort by most recent first.

## Empty state

If you have never performed a rollover, spndr shows:

- **Title:** No pushover history yet
- **Description:** When you roll over savings at month-end, snapshots will appear here.

## Cumulative tracking

Behind the scenes, spndr also tracks a cumulative `pushoverAmount` on your saver document - the running total of all rollovers. This value is maintained server-side and included in API responses but is not displayed as a separate card in the UI.

## History is permanent

Rollover history records cannot be edited or deleted through the UI. Each snapshot is an immutable record of what you saved during that period.

## Related pages

- [Pushover Overview](./overview.md)
- [Performing a Rollover](./performing-a-rollover.md)
