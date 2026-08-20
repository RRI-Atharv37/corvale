export type {
    ForecastChangeType,
    ProjectedChange,
    LowBalanceWarning,
    RecurringLike,
    AutoContributionIntervalLike,
    ForecastAutoContributionLike,
} from '../../shared/src/forecast'
export {
    projectRecurringOccurrences,
    projectGoalContributionDates,
    computeDiscretionaryDailyAverage,
} from '../../shared/src/forecast'
