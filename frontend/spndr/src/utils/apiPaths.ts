export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1'

export const API_PATHS = {
    AUTH: {
        LOGIN: '/auth/login',
        REGISTER: '/auth/register',
        USER: '/auth/user',
    },
    INCOME: {
        CREATE: '/income/create',
        DOWNLOAD: '/income/download',
        GET_ALL: '/income',
        FILTER: '/income/filter',
        GROUP_BY_CATEGORY: '/income/group-by-category',
        SEARCH: '/income/search',
        DUPLICATE: (incomeId: string) => `/income/duplicate/${incomeId}`,
        GET_BY_ID: (incomeId: string) => `/income/${incomeId}`,
        DELETE: (incomeId: string) => `/income/${incomeId}`,
        UPDATE: (incomeId: string) => `/income/${incomeId}`,
    },
    EXPENSE: {
        CREATE: '/expense/create',
        GET_ALL: '/expense',
        GET_BY_ID: (expenseId: string) => `/expense/${expenseId}`,
        UPDATE: (expenseId: string) => `/expense/${expenseId}`,
        DELETE: (expenseId: string) => `/expense/${expenseId}`,
        FILTER: '/expense/filter',
        SEARCH: '/expense/search',
        GROUP_BY_CATEGORY: '/expense/group-by-category',
        GROUP_BY_PAYMENT_METHOD: '/expense/group-by-payment-method',
        DOWNLOAD: '/expense/download',
        REPORT: '/expense/report',
        DUPLICATE: (expenseId: string) => `/expense/duplicate/${expenseId}`,
    },
    SAVER: {
        ADD: '/saver/add',
        WITHDRAW: '/saver/withdraw',
        DETAILS: '/saver/details',
    },
    PUSHOVER: {
        PUSHOVER: '/pushover/pushover',
        HISTORY: '/pushover/history',
    },
    ACCOUNTS: {
        CREATE: '/accounts',
        GET_ALL: '/accounts',
        GET_BY_ID: (accountId: string) => `/accounts/${accountId}`,
        UPDATE: (accountId: string) => `/accounts/${accountId}`,
        DELETE: (accountId: string) => `/accounts/${accountId}`,
    },
    CATEGORIES: {
        CREATE: '/categories',
        GET_ALL: '/categories',
        GET_BY_ID: (categoryId: string) => `/categories/${categoryId}`,
        UPDATE: (categoryId: string) => `/categories/${categoryId}`,
        DELETE: (categoryId: string) => `/categories/${categoryId}`,
        REORDER: '/categories/reorder',
    },
} as const
