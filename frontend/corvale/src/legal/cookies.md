**Effective date:** [[EFFECTIVE_DATE]] · **Version:** 2026-08-28

## The short version

Corvale sets **one cookie**. It is the one that keeps you signed in, and the app cannot work
without it.

There are no analytics cookies, no advertising cookies, and no third-party trackers. That is why
you have never seen a cookie consent banner here — there is nothing to consent to.

This page covers the hosted Corvale service at [[PRODUCT_DOMAIN]]. Self-hosted installations are
run by whoever operates them.

## The cookie we set

| | |
| --- | --- |
| **Name** | `corvale_refresh` |
| **Purpose** | Keeps you signed in and lets the app renew your session |
| **Type** | Strictly necessary |
| **Lifetime** | 7 days by default |
| **Flags** | `HttpOnly`, `Secure` in production, `SameSite=Lax` |

`HttpOnly` prevents client-side JavaScript from reading the cookie, which reduces the risk of your
session token being stolen through script injection. It is not a defence against cross-site
scripting in general — a successful script injection may still be able to act through your
browser even without reading the cookie.

`SameSite=Lax` limits when the browser sends the cookie in cross-site contexts, which helps reduce
cross-site request forgery. It is a restriction, not a complete block: browsers still send a `Lax`
cookie on some top-level cross-site navigations.

If you signed up before Corvale was renamed, you may still have an old `spndr_refresh` cookie.
Corvale clears it when you sign out.

## What Corvale stores in your browser

These are not cookies — they are local storage, which stays on your device and is never sent to
our servers automatically. We list them because you deserve the whole picture.

| What is stored | Why | How long it lasts |
| --- | --- | --- |
| Which workspace you are currently viewing | So the app opens where you left off | Until you sign out or clear site data |
| Your name and preferences, cached | So the app can render while offline | Until you sign out or clear site data |
| A signed permission slip for offline use | Lets the app work without a connection for a limited time | Until it expires — 30 days by default — or you sign out |
| A verifier and a salt for your app PIN | Lets the app check your PIN without transmitting it anywhere | Until you remove the PIN or clear site data |
| A count of failed PIN attempts | Locks the local data after repeated wrong entries | Reset on a correct PIN; cleared with site data |
| Whether you have seen the PIN setup prompt | So you are not asked twice | Until you clear site data |

Corvale also sets one **session storage** key, which records that your timezone has already been
checked in this browser tab. It disappears when you close the tab.

**Your access token is held in memory only.** It is never written to local storage or to a
cookie, and it disappears when you close the tab.

### What browser storage does and does not protect

Browser storage is protected by your browser's own site isolation and origin controls, so another
website cannot read Corvale's storage. It should **not** be treated as equivalent to encrypted
storage against someone who already has access to your browser profile, your operating system
account, or your unlocked device.

Where a PIN is set, record contents are encrypted with a key derived from it (see
[The local database](#the-local-database)). The keys in the table above are not, and neither is
cached data when no PIN has been set.

## The local database

The desktop app and the offline-capable web app keep a copy of your records — transactions,
accounts, categories, budgets, goals and the rest — in a local database on your own device, so
everything is there without a connection. That copy reaches us only through the ordinary sync back
to your account.

- **On the desktop app** the database is a SQLCipher file, so the whole file is encrypted on disk.
- **In the browser** it lives in the browser's own private storage for this site, and the record
  contents are encrypted with a key derived from your app PIN. That protection exists once you
  have set a PIN. Without one, the data sits in browser storage unencrypted, the way browser
  storage normally does.
- **Offline access is time-limited.** The signed offline permission slip is issued by our server,
  and the app can only render your cached data while it is still valid — 30 days by default. The
  app cannot extend it on its own; it has to reach the server to renew it.

Clearing your browser's site data, signing out, or uninstalling the desktop app removes the local
copy. Nothing on the server changes.

## Third-party services

The only third party involved on this front is **hCaptcha** (operated by Intuition Machines,
Inc.), and only if the signup captcha is switched on for the instance you use. It runs on the
signup page to check that a new account is not being created by a bot.

When it is enabled, hCaptcha loads its own script, makes network requests to its own servers, and
may set its own cookies and browser storage under its own terms. That processing is described in
[hCaptcha's Privacy Policy](https://www.hcaptcha.com/privacy) and
[Terms of Service](https://www.hcaptcha.com/terms). hCaptcha is also listed as a sub-processor in
our [Privacy Policy](./privacy.md).

If the captcha is switched off, no third-party cookies or browser storage are set by Corvale.

## What we will never do

Corvale does not use cookies or local storage for analytics, advertising, profiling, or
cross-site tracking.

If we ever add product analytics, it will be a self-hosted, privacy-respecting tool, and this
page will say so before it ships. Putting a third-party tracker into a personal finance app would
contradict the whole point of the product.

## Clearing them

You can delete cookies and local storage at any time through your browser's settings.

If you do, you will be signed out, your PIN setup will be forgotten, and any data cached for
offline use will be cleared. Nothing on the server is affected — sign in again and everything is
still there.

## Technical appendix — current storage keys

These are the exact keys as they exist today, for anyone who wants to inspect them. **Key names
are implementation detail and may change without this page being a formal notice of it** — the
table above is the part that describes what is actually stored and why.

| Key | Corresponds to |
| --- | --- |
| `corvale_active_workspace_id` | Current workspace |
| `corvale_cached_user` | Cached name and preferences |
| `corvale_offline_grant` | Signed offline permission slip |
| `corvale_pin_salt`, `corvale_pin_verifier` | PIN verifier and salt |
| `corvale_pin_attempts` | Failed PIN attempt count |
| `corvale_pin_prompt_seen` | PIN setup prompt already shown |
| `spndr_pin_salt`, `spndr_pin_verifier`, `spndr_pin_attempts` | The same PIN values under their pre-rename names. Corvale copies them to the `corvale_` keys the first time it sees them |
| `corvale:timezone-synced` (session storage) | Timezone already checked this tab |

## Changes and contact

If this page changes materially we will update the version at the top and ask you to review it
next time you sign in.

Questions: [[PRIVACY_EMAIL]]. See also the [Privacy Policy](./privacy.md).
