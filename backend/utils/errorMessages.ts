export const ERROR_MESSAGES = {
    AUTH: {
        FILL_ALL_FIELDS: 'Please fill in all fields',
        INVALID_CREDENTIALS: 'Invalid credentials',
        TOKEN_MISSING: 'Not authorized, no token',
        TOKEN_INVALID: 'Not authorized, token failed',
        NOT_AUTHORIZED: 'Not authorized to perform this action',
    },
    USER: {
        USER_ALREADY_EXISTS: 'User already exists',
        USER_NOT_FOUND: 'User not found',
    },
    GENERAL: {
        JWT_SECRET_MISSING: 'JWT_SECRET is not defined in environment variables',
    },
    INCOME: {
        FILL_ALL_FIELDS: 'Please fill in all fields',
        INCOME_NOT_FOUND: 'Income entry not found',
        INCOME_ALREADY_EXISTS: 'Income already exists',
    },
    EXPENSE: {
        FILL_ALL_FIELDS: 'Please fill in all fields',
        EXPENSE_NOT_FOUND: 'Expense entry not found',
        EXPENSE_ALREADY_EXISTS: 'Expense already exists',
    },
    SAVER: {
        FILL_ALL_FIELDS: 'Please fill in all fields',
        SAVER_NOT_FOUND: 'Saver account not found',
        INSUFFICIENT_FUNDS: 'Insufficient funds in saver account',

    },
}