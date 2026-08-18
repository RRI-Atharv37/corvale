---
title: Onboarding API
---

## Endpoints

All routes are mounted at `/api/v1/onboarding` and require authentication.

## Steps

`account → categories → budget → goal → tour`. `budget`, `goal`, and `tour` are optional/skippable at the step level.

## POST /onboarding/start

Starts onboarding if it hasn't been started: sets `onboardingCurrentStep` to `account` and clears prior progress. Calling it again while already started is a no-op that just returns current status.

## GET /onboarding/status

Returns the user's onboarding state, including `progressPercentage` (`stepsCompleted.length / 5 * 100`). 404 if onboarding was never started.

## POST /onboarding/step/:step

Advances the wizard by one step. `step` must match the user's current step (`onboardingCurrentStep`) or the request is rejected (400, `INVALID_STEP_ORDER`).

| Step | Body | Side effect |
|------|------|-------------|
| `account` | `{ accountName, accountType, openingBalance? }` | Creates an `Account`; the first personal account created is set as default |
| `categories` | `{ categoriesReviewed? }` | No writes - acknowledgement only |
| `budget` | `{ skipped }` or `{ budgetName, budgetAmount, categoryId? }` | Creates a monthly `Budget` unless skipped |
| `goal` | `{ skipped }` or `{ goalName, targetAmount }` | Creates a `SavingsGoal` unless skipped |
| `tour` | `{ tourCompleted? }` | No writes - marks the wizard complete |

After the last step (`tour`), `onboardingCurrentStep` is set to `null` and `onboardingCompleted` to `true`.

## PATCH /onboarding/skip

Ends onboarding early at any step: `onboardingCompleted = true`, `onboardingSkipped = true`, `onboardingCurrentStep = null`. 404 if onboarding was never started.

## POST /onboarding/replay

Resets onboarding back to the `account` step, regardless of whether it was previously completed or skipped. Unlike `/start`, this has no "not already started" precondition.

## Related pages

- [API Overview](./api-overview.md)
- [Onboarding Tour](../onboarding/overview.md)
