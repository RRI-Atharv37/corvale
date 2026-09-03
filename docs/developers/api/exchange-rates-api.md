---
title: Exchange Rates API
---

## Endpoints

All routes are mounted at `/api/v1/exchange-rates` and require authentication. Rates are stored per user as a map keyed like `"USD_EUR"`.

## GET /exchange-rates

Returns the authenticated user's exchange rate map.

## POST /exchange-rates

Add a rate. Body: `{ "pair": "USD/EUR", "rate": 0.92 }`. `pair` is normalized to `FROM_TO` (uppercased, must match two 3-letter currency codes). `rate` must be greater than 0. Returns the full updated map (201).

## PATCH /exchange-rates/:pair

Update an existing rate. Body: `{ "rate": 0.94 }`. 404 if the pair doesn't exist yet.

## DELETE /exchange-rates/:pair

Remove a rate. 404 if it doesn't exist. Returns the remaining map.

## Conversion behavior

`convertAmount(amount, from, to, rates)` is used wherever balances are converted (account list/detail, dashboard/net-worth totals):

1. Same currency - returns the amount unchanged.
2. Direct rate found (`FROM_TO`) - applies it.
3. Inverse rate found (`TO_FROM`) - applies `1 / rate`.
4. No rate in either direction - falls back to a 1:1 conversion and flags `rateConfigured: false` in the response rather than throwing.

Account responses include `convertedBalance`, `exchangeRateApplied`, and `hasExchangeRate` alongside the native balance.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Multi-Currency Balances](../../accounts/multi-currency-balances.md)
- [Accounts API](./accounts-api.md)
