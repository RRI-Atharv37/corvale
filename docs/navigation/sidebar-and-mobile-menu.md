---
title: Sidebar and Mobile Menu
---

## Navigating spndr

spndr uses a persistent sidebar on desktop and a slide-out menu on mobile. Both provide access to every section of the app.

## Sidebar navigation items

| Label | Route | Icon |
|-------|-------|------|
| Dashboard | `/dashboard` | Home |
| Transactions | `/transactions` | List |
| Accounts | `/accounts` | Credit card |
| Categories | `/categories` | Grid |
| Budgets | `/budgets` | Pie chart |
| Savings Goals | `/savings-goals` | Flag |
| Saver | `/saver` | Dollar sign |
| Pushover | `/pushover` | Repeat |
| Docs | `http://localhost:5174` | Book (opens docs site) |

The currently active page is highlighted with a cyan accent border and background.

## Desktop layout

On screens **1024px and wider** (the `lg` breakpoint):

- The sidebar is fixed on the left side (256px wide)
- Main content fills the remaining space with a left padding offset
- A sticky header shows a welcome message: "Welcome, [first name]"

## Mobile layout

On smaller screens:

- The sidebar is hidden by default
- A **menu button** (hamburger icon) in the header opens the sidebar as an overlay
- Tapping outside the sidebar or the close button dismisses it
- Selecting a navigation item automatically closes the menu

## Sidebar footer

The bottom of the sidebar shows:

- Your **full name**
- Your **email address**
- A **Settings** button (gear icon) - opens preferences and logout actions

Logout actions live inside the Settings modal, not as standalone sidebar buttons. See [Account Settings](../authentication/account-settings.md).

## Branding

The sidebar header displays the **spndr** logo text in cyan with the subtitle "Personal finance".

## Authentication pages

Login and signup pages use a separate auth layout without the sidebar. After signing in, you enter the dashboard layout with full navigation.

## Legacy routes

The old `/income` and `/expense` routes redirect to `/transactions`. Use the Transactions page for all income and expense activity.

## Related pages

- [Dashboard Overview](../dashboard/overview.md)
- [Transactions Overview](../transactions/overview.md)
- [Budgets Overview](../budgets/overview.md)
- [Savings Goals Overview](../savings-goals/overview.md)
- [Account Settings](../authentication/account-settings.md)
- [Sessions and Logout](../authentication/sessions-and-logout.md)
