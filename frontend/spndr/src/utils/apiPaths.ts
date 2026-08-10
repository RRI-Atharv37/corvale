interface ImportMetaWithEnv extends ImportMeta {
    env: {
        VITE_API_URL?: string;
    };
}

export const BASE_URL = (import.meta as ImportMetaWithEnv).env.VITE_API_URL || 'http://localhost:8000/api/v1/';
console.log('BASE_URL:', BASE_URL);

export const API_PATHS = {
    AUTH: {
        LOGIN: '/auth/login',
        REGISTER: '/auth/register',
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
}