import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'spndr',
  titleTemplate: ':title · spndr',
  description: 'Personal finance, simplified - documentation for spndr.',
  cleanUrls: true,
  lastUpdated: true,

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'spndr',

    nav: [
      { text: 'Getting Started', link: '/getting-started/introduction' },
      { text: 'Guide', link: '/dashboard/overview' },
      { text: 'API', link: '/developers/api-overview' },
      { text: 'FAQ', link: '/faq/frequently-asked-questions' },
    ],

    search: {
      provider: 'local',
    },

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Introduction', link: '/getting-started/introduction' },
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Running Locally', link: '/getting-started/running-locally' },
        ],
      },
      {
        text: 'Authentication',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/authentication/overview' },
          { text: 'Creating an Account', link: '/authentication/creating-an-account' },
          { text: 'Signing In', link: '/authentication/signing-in' },
          { text: 'Resetting Your Password', link: '/authentication/resetting-your-password' },
          { text: 'Sessions and Logout', link: '/authentication/sessions-and-logout' },
          { text: 'Account Settings', link: '/authentication/account-settings' },
        ],
      },
      {
        text: 'Onboarding',
        collapsed: false,
        items: [
          { text: 'Onboarding Tour', link: '/onboarding/overview' },
        ],
      },
      {
        text: 'Dashboard',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/dashboard/overview' },
          { text: 'Summary Cards', link: '/dashboard/summary-cards' },
          { text: 'Quick Links', link: '/dashboard/quick-links' },
        ],
      },
      {
        text: 'Navigation',
        collapsed: false,
        items: [
          { text: 'Sidebar and Mobile Menu', link: '/navigation/sidebar-and-mobile-menu' },
        ],
      },
      {
        text: 'Accounts',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/accounts/overview' },
          { text: 'Account Types', link: '/accounts/account-types' },
          { text: 'Creating an Account', link: '/accounts/creating-an-account' },
          { text: 'Default Accounts', link: '/accounts/default-accounts' },
          { text: 'Editing and Archiving Accounts', link: '/accounts/editing-and-archiving-accounts' },
          { text: 'Reconciling an Account', link: '/accounts/reconciling-an-account' },
          { text: 'Multi-Currency Balances', link: '/accounts/multi-currency-balances' },
        ],
      },
      {
        text: 'Transactions',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/transactions/overview' },
          { text: 'Adding Transactions', link: '/transactions/adding-transactions' },
          { text: 'Managing Transactions', link: '/transactions/managing-transactions' },
          { text: 'Transfers and Splits', link: '/transactions/transfers-and-splits' },
          { text: 'Receipts and Bulk Actions', link: '/transactions/receipts-and-bulk-actions' },
        ],
      },
      {
        text: 'Recurring',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/recurring/overview' },
          { text: 'Creating a Recurring Rule', link: '/recurring/creating-a-recurring-rule' },
          { text: 'Managing Drafts', link: '/recurring/managing-drafts' },
        ],
      },
      {
        text: 'Import',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/import/overview' },
          { text: 'Importing a Bank File', link: '/import/importing-a-bank-file' },
        ],
      },
      {
        text: 'Backup and Restore',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/backup-restore/overview' },
        ],
      },
      {
        text: 'Desktop App',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/desktop/overview' },
          { text: 'Getting the Desktop App', link: '/desktop/download' },
          { text: 'Automatic Updates', link: '/desktop/auto-updates' },
        ],
      },
      {
        text: 'Income (legacy)',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/income/overview' },
          { text: 'Adding Income', link: '/income/adding-income' },
          { text: 'Managing Income Entries', link: '/income/managing-income-entries' },
        ],
      },
      {
        text: 'Expense (legacy)',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/expense/overview' },
          { text: 'Adding Expenses', link: '/expense/adding-expenses' },
          { text: 'Managing Expense Entries', link: '/expense/managing-expense-entries' },
        ],
      },
      {
        text: 'Categories',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/categories/overview' },
          { text: 'Creating Categories', link: '/categories/creating-categories' },
          { text: 'Managing Categories', link: '/categories/managing-categories' },
          { text: 'Auto-Categorization Rules', link: '/categories/categorization-rules' },
        ],
      },
      {
        text: 'Tags',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/tags/overview' },
          { text: 'Using Tags', link: '/tags/using-tags' },
        ],
      },
      {
        text: 'Templates',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/templates/overview' },
        ],
      },
      {
        text: 'Balances',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/balances/overview' },
          { text: 'How Balances Are Calculated', link: '/balances/how-balances-are-calculated' },
          { text: 'Spendable Balance and Net Worth', link: '/balances/spendable-balance-and-net-worth' },
        ],
      },
      {
        text: 'Budgets',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/budgets/overview' },
          { text: 'Creating a Budget', link: '/budgets/creating-a-budget' },
          { text: 'Tracking Budget Progress', link: '/budgets/tracking-budget-progress' },
        ],
      },
      {
        text: 'Savings Goals',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/savings-goals/overview' },
          { text: 'Creating a Savings Goal', link: '/savings-goals/creating-a-savings-goal' },
          { text: 'Contributing to Goals', link: '/savings-goals/contributing-to-goals' },
          { text: 'Goal Lifecycle', link: '/savings-goals/goal-lifecycle' },
        ],
      },
      {
        text: 'Saver',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/saver/overview' },
          { text: 'Depositing to Saver', link: '/saver/depositing-to-saver' },
          { text: 'Withdrawing from Saver', link: '/saver/withdrawing-from-saver' },
        ],
      },
      {
        text: 'Pushover',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/pushover/overview' },
          { text: 'Performing a Rollover', link: '/pushover/performing-a-rollover' },
          { text: 'Rollover History', link: '/pushover/rollover-history' },
        ],
      },
      {
        text: 'Reports',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/reports/overview' },
          { text: 'Custom Reports and Saved Reports', link: '/reports/custom-reports-and-saved-reports' },
        ],
      },
      {
        text: 'Notifications',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/notifications/overview' },
        ],
      },
      {
        text: 'Workspaces',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/workspaces/overview' },
          { text: 'Creating and Inviting', link: '/workspaces/creating-and-inviting' },
          { text: 'Roles and Permissions', link: '/workspaces/roles-and-permissions' },
        ],
      },
      {
        text: 'FAQ',
        collapsed: false,
        items: [
          { text: 'Frequently Asked Questions', link: '/faq/frequently-asked-questions' },
        ],
      },
      {
        text: 'Developers',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/developers/overview' },
          { text: 'Project Structure', link: '/developers/project-structure' },
          { text: 'Environment Variables', link: '/developers/environment-variables' },
          { text: 'Deployment Guide', link: '/developers/deployment' },
          { text: 'Desktop App (Tauri)', link: '/developers/desktop-app' },
          { text: 'API Overview', link: '/developers/api-overview' },
          { text: 'Authentication API', link: '/developers/authentication-api' },
          { text: 'Accounts API', link: '/developers/accounts-api' },
          { text: 'Transactions API', link: '/developers/transactions-api' },
          { text: 'Income API', link: '/developers/income-api' },
          { text: 'Expense API', link: '/developers/expense-api' },
          { text: 'Categories API', link: '/developers/categories-api' },
          { text: 'Categorization Rules API', link: '/developers/categorization-rules-api' },
          { text: 'Tags API', link: '/developers/tags-api' },
          { text: 'Transaction Templates API', link: '/developers/transaction-templates-api' },
          { text: 'Recurring Rules API', link: '/developers/recurring-api' },
          { text: 'Import API', link: '/developers/import-api' },
          { text: 'Backup and Restore API', link: '/developers/backup-restore-api' },
          { text: 'Budgets API', link: '/developers/budgets-api' },
          { text: 'Savings Goals API', link: '/developers/savings-goals-api' },
          { text: 'Saver API', link: '/developers/saver-api' },
          { text: 'Pushover API', link: '/developers/pushover-api' },
          { text: 'Reconciliation API', link: '/developers/reconciliation-api' },
          { text: 'Exchange Rates API', link: '/developers/exchange-rates-api' },
          { text: 'Dashboard API', link: '/developers/dashboard-api' },
          { text: 'Reports API', link: '/developers/reports-api' },
          { text: 'Notifications API', link: '/developers/notifications-api' },
          { text: 'Workspaces API', link: '/developers/workspaces-api' },
          { text: 'Onboarding API', link: '/developers/onboarding-api' },
          { text: 'Forecast API', link: '/developers/forecast-api' },
          { text: 'Calendar API', link: '/developers/calendar-api' },
          { text: 'Subscriptions API', link: '/developers/subscriptions-api' },
          { text: 'Debt Payoff API', link: '/developers/debts-api' },
          { text: 'Receipts API', link: '/developers/receipts-api' },
          { text: 'Data Migration', link: '/developers/data-migration' },
          { text: 'Backup & Restore Runbook', link: '/developers/backup-restore-runbook' },
          { text: 'Incident Response Runbook', link: '/developers/incident-response-runbook' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/RRI-Atharv37/spndr' },
    ],

    footer: {
      message: 'Released under the GNU AGPL v3.0 License.',
      copyright: 'Copyright © spndr',
    },

    outline: {
      level: [2, 3],
      label: 'On this page',
    },

    docFooter: {
      prev: 'Previous page',
      next: 'Next page',
    },
  },
})
