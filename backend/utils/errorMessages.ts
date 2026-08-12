export const ERROR_MESSAGES = {
    AUTH: {
        FILL_ALL_FIELDS: 'Please fill in all fields',
        INVALID_CREDENTIALS: 'Invalid credentials',
        TOKEN_MISSING: 'Not authorized, no token',
        TOKEN_INVALID: 'Not authorized, token failed',
        TOKEN_EXPIRED: 'Not authorized, token expired',
        NOT_AUTHORIZED: 'Not authorized to perform this action',
        TOO_MANY_REQUESTS: 'Too many authentication attempts, please try again later',
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
        INSUFFICIENT_SPENDABLE: 'Deposit amount exceeds spendable balance',
    },
    PUSHOVER: {
        ZERO_BALANCE: 'No saver balance to roll over',
    },
    ACCOUNT: {
        ACCOUNT_NOT_FOUND: 'Account not found',
        ACCOUNT_ARCHIVED: 'Cannot update an archived account',
        ACCOUNT_ALREADY_ARCHIVED: 'Account is already archived',
        CANNOT_UNSET_DEFAULT: 'Cannot unset default account; set another account as default instead',
    },
    CATEGORY: {
        CATEGORY_NOT_FOUND: 'Category not found',
        MASTER_NOT_FOUND: 'Master category not found',
        CATEGORY_ALREADY_EXISTS: 'A category with this name already exists under this master category',
        CATEGORY_ARCHIVED: 'Cannot update an archived category',
        CATEGORY_ALREADY_ARCHIVED: 'Category is already archived',
        CANNOT_MODIFY_MASTER: 'Master categories cannot be modified',
        CANNOT_UNSET_DEFAULT: 'Cannot unset default category; set another category as default instead',
        INVALID_REORDER: 'One or more categories are invalid or not owned by you',
    },
}