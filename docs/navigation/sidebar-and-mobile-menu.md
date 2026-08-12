---
title: Sidebar and Mobile Menu
---

## Navigating spndr

spndr uses a persistent sidebar on desktop and a slide-out menu on mobile. Both provide access to every section of the app.

## Sidebar navigation items

| Label | Route | Icon |
|-------|-------|------|
| Dashboard | `/dashboard` | Home |
| Income | `/income` | Trending up |
| Expense | `/expense` | Trending down |
| Accounts | `/accounts` | Credit card |
| Saver | `/saver` | Dollar sign |
| Pushover | `/pushover` | Repeat |

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
- A **Logout** button

This is the only place in the app where your account information is displayed. There is no separate settings or profile page.

## Branding

The sidebar header displays the **spndr** logo text in cyan with the subtitle "Personal finance".

## Authentication pages

Login and signup pages use a separate auth layout without the sidebar. After signing in, you enter the dashboard layout with full navigation.

## Related pages

- [Dashboard Overview](../dashboard/overview.md)
- [Sessions and Logout](../authentication/sessions-and-logout.md)
