**Effective date:** [[EFFECTIVE_DATE]] · **Version:** 2026-08-28

## Scope — what this policy covers

This policy covers **the hosted Corvale service** operated by [[OPERATOR_LEGAL_NAME]] at
[[PRODUCT_DOMAIN]].

It does **not** cover self-hosted installations. Corvale is free and open-source software under
the GNU AGPL v3.0, and anyone may run their own copy. If you use a Corvale instance that someone
else operates, that operator decides how your data is handled, and this policy does not apply to
them. Ask them for their own policy.

## The short version

We collect very little **about** you — a name, an email address, a few preferences. There is no
bank connection, no analytics, no advertising, and no profiling.

But the information you choose to **put into** Corvale is your financial life: what you earn, what
you owe, what you spend it on, and the receipts to go with it. That is sensitive by nature, whoever
holds it. We treat it that way, and the sections below tell you exactly what we hold, why, how it
is protected, and what you can do about it.

## Who we are

The hosted service is operated by [[OPERATOR_LEGAL_NAME]], [[OPERATOR_TYPE]].

Under India's Digital Personal Data Protection Act 2023 we act as the **data fiduciary** for the
personal data described below. That is the framework this policy is built on.

The service is operated from India and your data is stored there, wherever you are. You are
welcome to use Corvale from anywhere, with one exception: **we do not offer it in the European
Economic Area or the UK, and we have not appointed a representative there** — see
[If you are in the EEA or the UK](#if-you-are-in-the-eea-or-the-uk) for what that means and what
you can still ask of us.

- **Grievance Officer:** Atharv Dewangan
- **Email:** [[PRIVACY_EMAIL]]
- **Address:** [[POSTAL_ADDRESS]]
- **Response window for data-rights requests and complaints:** 30 days

## What we collect

### Your account

- Your name and email address
- Your password. It is transmitted to our service over an encrypted connection so we can
  authenticate you, and it is stored only as a one-way bcrypt-derived hash. We do not store it in
  plaintext, and we cannot read it back or recover it for you
- Your preferred currency, date format, and page-size preference
- Your timezone. Corvale reads this from your device when you sign up and re-checks it once per
  browser session, updating your profile automatically if it has changed. It keeps date filters,
  due dates and reminders aligned with where you actually are. There is no field to type it into,
  and we do not use it to locate you
- Your notification preferences
- Progress flags for the onboarding tour

### Account, terms and age records

When you create an account we store:

- Which version of the Terms of Service you were shown and accepted, and when
- Which version of this Privacy Policy you were shown, and when
- Your attestation that you are 18 or older, and when you made it

We keep these to administer your account and to have a record of the terms and the notice under
which it was created, and of the age attestation the Terms require. We also use them to know when
a document has changed materially enough to ask you to read it again.

These are **not** consent records for optional processing, and we do not treat them as one. Where
something we do actually depends on your consent, that is described where the consent is asked
for, and it can be withdrawn separately — see [Your rights](#your-rights).

### The financial information you enter

Everything you record in Corvale: transactions, accounts and balances, budgets, savings goals,
categories, tags, automation rules, templates, saver and rollover state, reconciliation sessions,
saved reports, and workspaces you create or join.

**You enter all of this yourself.** Corvale has no bank connection and never retrieves data from
your bank or any other financial institution.

This is the most sensitive category of information in the service. It is not "just numbers" — a
transaction history describes where you go, what you buy, who you pay and what you owe.

### People you invite to a workspace

If you invite someone to a workspace, you give us their email address. We use it to find their
Corvale account and to create the invitation, and we keep the invitation until it is accepted,
declined, or withdrawn.

An invitation can only reach an address that already has a Corvale account, so sending one tells
you whether that address is registered here. Invite only people who are expecting it.

**What happens to records you add to a shared workspace depends on how you leave.** If you leave
the workspace, or an owner removes you, the records you added stay there and stay visible to the
remaining members, and you lose access to them.

If you **delete your account**, those records are kept but the link to you is severed: they remain
in the workspace so the other members' balances and history stay correct, and they stop being
connected to your account or attributed to you. We do this because a shared ledger is not only
your data — the other members relied on those entries — while severing the link means the record
no longer identifies you. If no other member is left in the workspace, the records are erased with
the rest of your account. Receipts are always deleted outright, wherever they were attached,
because a receipt image can carry personal information that anonymising a record would not remove.

We notify the remaining members that a member has left and their entries are now unattributed. We
do not name you in that notice.

Records created by other members are not touched while a workspace carries on. The one exception
is a workspace that ends up with nobody in it at all: everything inside is erased, including
anything left behind by members who had already gone, because at that point no one can reach it
any more. The workspace itself is deleted too. Copies other members have already exported are
beyond our reach in every case.

### Receipts you upload

If you attach a receipt to a transaction we store the file along with its original filename, its
file type, and its size. Receipts may be JPEG, PNG, WebP or PDF, up to 5 MB each.

**A receipt is a photograph of a document, and it can contain more than the amount.** Names,
addresses, phone numbers, card fragments, merchant and loyalty details, and information about
other people can all appear on one. We store the file as you uploaded it; we do not read it,
index its contents, or extract text from it. Upload only what you actually need for your own
records, and avoid uploading information about other people that serves no purpose in your ledger.

### Operational data

- Your IP address is used **only** as a counter key for rate limiting, to stop brute-force and
  spam attacks. It expires automatically and is never linked to your account.
- Server logs record the fact that a request happened and any errors it caused. They do not
  record your IP address or your browser's user-agent string.
- When server error reporting is switched on, an unexpected server failure is sent to our
  error-tracking provider as the error message, its stack trace, and the request's method and
  path. We do not attach your IP address, your request body, or your records to those reports.
  Ordinary errors — a validation failure, a wrong password, a page that does not exist — are
  never reported. A stack trace is produced by the failure itself, so we cannot rule out that an
  identifier such as a record ID appears inside one; we configure the reporting to send as little
  as it can, and we do not use these reports to look at anyone's data.

### The desktop app and offline use

Corvale also runs as an installable desktop app and as an offline-capable web app. Both keep a
copy of your records in a local database on your own device so they work without a connection.
That copy stays on your device; it reaches us only through the ordinary sync back to your account.
The [Cookie Policy](./cookies.md) describes what is stored there and how to clear it.

The desktop app checks for updates against the release host it was built to use. Like any software
updater, that check discloses your IP address and the version you are running to whoever serves
those releases. It sends nothing about you or your records.

## What we do not collect

We think this list matters as much as the one above.

- **No bank connections.** Corvale never links to your bank, so we never see your bank
  credentials, your real balances, or any transaction you did not type in yourself.
- **No analytics.** No page-view tracking, no product analytics, no session recording.
- **No advertising or third-party trackers.** Corvale does not carry any.
- **No device fingerprinting.**
- **No externally hosted fonts, and no third-party scripts** — with one exception: when the signup
  captcha is switched on, hCaptcha's script loads on the signup page only. Everything else the app
  loads comes from our own servers, so no third party learns that you visited.
- **No date of birth.** We ask only whether you are 18 or older, and store just that answer.
- **We do not keep your IP address or device details as part of your account profile or your
  login-session records.** IP addresses are processed briefly for rate limiting and security, as
  described above, and then expire.

## Why we use your data, and on what basis

Different laws describe the same processing in different vocabulary, so this is split by
jurisdiction rather than blended into one table.

In every case: we collect only what the features you use actually require, and use it only for
the purposes listed here. **We do not sell your data. We do not share it for advertising. We do
not use it to train machine learning models. We do not profile you.**

### India — under the DPDP Act 2023

Under the DPDP Act we process personal data for lawful purposes, on the basis of your consent or
of a legitimate use permitted by the Act, and only for the purpose the data was given for.

| What we use it for | Basis |
| --- | --- |
| Creating your account and running the service — storing and showing you your own records | The purpose for which you gave us the data when you signed up and as you use the app |
| Signing you in and keeping your session alive | Same |
| Sending password-reset and email-verification messages | Same |
| Rate limiting, abuse prevention, and security monitoring | Necessary to operate the service securely and to prevent misuse |
| Diagnosing server errors | Necessary to keep the service working |
| Keeping the account, terms and age records described above | Necessary to administer your account and to evidence the terms it was created under |

You can withdraw at any time by deleting your account, which stops all of it — see
[Your rights](#your-rights) for what withdrawal means in practice and what happens to processing
we are separately required to carry out.

### If the GDPR or UK GDPR applies to you

We do not offer the service in the EEA or the UK, so we do not expect the GDPR to apply. We
publish this table anyway, because a reader is entitled to know what the analysis would be, and
because we would rather over-disclose than leave someone guessing. If the GDPR did apply to your
use of the service, these are the lawful bases we would rely on.

| What we use it for | Lawful basis |
| --- | --- |
| Running the service — storing and showing you your own records | Performance of our contract with you (Art. 6(1)(b)) |
| Signing you in and keeping your session alive | Performance of our contract |
| Sending password-reset and email-verification messages | Performance of our contract |
| Rate limiting, abuse prevention, and security monitoring | Our legitimate interests in keeping the service safe (Art. 6(1)(f)) |
| Diagnosing server errors | Our legitimate interests in a working service |
| Keeping the account, terms and age records described above | Our legitimate interests in administering the account and evidencing its terms; and, where we must keep them, compliance with a legal obligation (Art. 6(1)(c)) |
| Anything we ask you to opt in to | Your consent (Art. 6(1)(a)), withdrawable at any time |

Because the financial records you enter can reveal a lot about you, we apply the safeguards in
[How we protect it](#how-we-protect-it) to all of it, regardless of which basis applies.

## Cookies and local storage

Corvale sets **one cookie**, and it is the one that keeps you signed in. There are no analytics
or advertising cookies, and therefore no cookie consent banner.

See the [Cookie Policy](./cookies.md) for the full detail, including what Corvale stores in your
browser's local storage.

## Who else processes your data

These are our sub-processors. Several are optional and may not be switched on for the instance
you use.

| Sub-processor | What they do | Where they process | Always on? |
| --- | --- | --- | --- |
| MongoDB | Stores the database | [[MONGODB_REGION]] | Yes |
| [[HOSTING_PROVIDER]] | Runs the application servers | [[HOSTING_REGION]] | Yes |
| [[EMAIL_PROVIDER]] | Sends password-reset and verification email only | [[EMAIL_PROVIDER_REGION]] | Yes |
| [[OBJECT_STORAGE_PROVIDER]] | Stores uploaded receipt files | [[OBJECT_STORAGE_REGION]] | Only when receipt storage is enabled |
| [[UPDATE_HOST]] | Serves desktop app updates | [[UPDATE_HOST_REGION]] | Only for the desktop app |
| Sentry | Reports unexpected server errors so we can fix them | United States / European Union, depending on the project region | Only when error reporting is enabled |
| hCaptcha (Intuition Machines, Inc.) | Checks that a signup is not automated | United States | Only when the signup captcha is enabled |

We do not add a sub-processor without updating this list. Each of them processes data only on our
instructions and under a written agreement, and none of them is permitted to use it for their own
purposes.

## Where your data goes

The service is operated from India, and that is where your account and your records live.

**If you are outside India, read that sentence twice.** Signing up means your personal and
financial data is stored and processed in India, under Indian law, by an operator based there. It
is not held in your own country, and the protections that apply to it are the ones described in
this policy rather than the ones your local law would impose on a local provider. That is a real
trade-off, and you should make it deliberately.

Some of the sub-processors above store or process data outside India, including in the United
States and the European Union — the table says which, and where. In each case the transfer happens
because we use that provider to deliver the service, and it is covered by the data processing
agreement we have with them, including that provider's standard contractual clauses or equivalent
transfer terms where those apply.

India's DPDP Act permits transfers outside India except to a country the Government restricts. If
a restriction is notified that affects a provider we use, we will move the processing or stop
using them.

## If you are in the EEA or the UK

**We do not offer the Corvale service in the European Economic Area or the UK, and we have not
appointed a representative under Article 27 of the EU GDPR or the UK GDPR.**

We say this plainly rather than leaving it to be inferred. Corvale is operated from India and is
generally available elsewhere, but being reachable from a place is not the same as being offered
there. We do not target the EEA or the UK: there is no local pricing, no local currency default,
no localised language, no marketing directed at those markets, and no support offered in them. On
that basis we do not consider the service to fall within Article 3(2) of either regulation, which
is what would require a representative.

Nothing here is an attempt to contract out of a law that applies. If the GDPR does apply to you
despite the above, it applies whatever this page says, and we would rather tell you where we stand
than quietly leave the question open.

**What you can ask of us regardless.** The rights in [Your rights](#your-rights) — export,
correction, deletion, and the rest — are not conditional on where you live. Everyone gets the same
in-app tools and the same grievance route, and we answer requests from anywhere within the window
stated above. If you believe a supervisory authority in your country has jurisdiction over us, you
are free to complain to it.

If you would rather not use a service with no representative in your region, that is a fair call,
and you can export everything and delete your account at any time.

## How long we keep it

- **Your account and everything in it:** for as long as your account exists. When you delete your
  account it is erased from the live service immediately — see below.
- **Login sessions:** refresh tokens expire on their own, by default after 7 days.
- **Rate-limit counters:** expire automatically, within minutes.
- **Deleted records:** Corvale keeps a short-lived marker so the deletion syncs to your other
  devices, and then purges the marker.
- **Error reports:** retained by our error-tracking provider for their standard retention period
  and then deleted.
- **Our backups:** kept for 30 days, then overwritten. A deleted account disappears from the live
  database immediately, but a backup copy can persist for that long. We do not restore an
  individual account from a backup.

## How we protect it

- Passwords are stored only as bcrypt-derived hashes, never in readable form, and are transmitted
  only over encrypted connections.
- Every database query is scoped to your user account at the data layer, so one account's queries
  cannot reach another's records.
- Sessions use short-lived access tokens plus rotating refresh tokens, and every session you hold
  can be revoked at once.
- The app sends a strict Content Security Policy, which blocks external scripts.
- Uploaded receipts can be virus-scanned before they are accepted.
- When receipts are held in object storage, they are encrypted at rest there and served through
  links that expire after a few minutes and are not guessable.
- Login, signup, password reset and write operations are all rate limited.

No system is perfectly secure, and we do not claim otherwise. What we can tell you is exactly
which controls are in place, which is what this section is for. Our security policy and how to
report a vulnerability are published in the repository's `SECURITY.md`.

## Your rights

You can:

- **Get a copy of your data.** Settings → Backup and Restore exports everything as JSON, or as a
  ZIP including your receipts. **Export is never restricted, in any circumstances.**
- **Correct your data.** Everything in Corvale is editable in the app.
- **Delete your data.** Settings → Delete Account erases your account and every private record
  attached to it, including all receipt files, from the live service. This is a real deletion, not
  a hidden flag. Records you contributed to a workspace you share with others are kept but
  unlinked from you, as described under
  [People you invite to a workspace](#people-you-invite-to-a-workspace); the app shows you exactly
  what that affects before you confirm. Backup copies are overwritten on the schedule above.
- **Withdraw consent.** Where something we do depends on your consent, you can withdraw it by the
  method described where that consent was asked for, and withdrawing is as easy as giving it.
  Withdrawal does not affect processing carried out before you withdrew, and we may continue
  processing where another lawful basis applies or where the law requires us to. Withdrawing
  consent for the account itself means deleting the account, because there is no service left to
  provide without it.
- **Object or restrict.** Where we rely on an interest of our own rather than on running the
  service for you, you can object to that processing, and you can ask us to pause it while an
  objection or a correction request is being resolved. This is a GDPR-shaped right and we do not
  operate in the EEA or the UK, but we offer it to everyone rather than gate it by geography.
- **Nominate someone** (India): under section 14 of the DPDP Act you may nominate another
  individual to exercise your rights under the Act on your behalf if you die or become unable to
  do so yourself. Email [[PRIVACY_EMAIL]] to record a nomination.
- **Complain.** Contact our Grievance Officer using the details above. In India, if you are not
  satisfied with our response, you may complain to the Data Protection Board of India. If a data
  protection authority elsewhere has jurisdiction over you, you are free to complain to it — see
  [If you are in the EEA or the UK](#if-you-are-in-the-eea-or-the-uk) for our position on that.

Use the in-app tools first — they are immediate and need no request. If you would rather we
handled it, email [[PRIVACY_EMAIL]] and we will respond within 30 days.

We may need to confirm who you are before acting on a request, so that nobody else can use these
rights against your account.

## If you are in the United States

You are welcome to use Corvale. Note that we are not a US business and your data is stored in
India — see [Where your data goes](#where-your-data-goes).

We do not sell your personal information, and we do not share it for cross-context behavioural
advertising or targeted advertising. We have never done either, and there is nothing to opt out
of — no "Do Not Sell or Share My Personal Information" mechanism is required, because no such
sale or sharing happens.

We do not use your information for automated decision-making or profiling. State privacy laws
such as California's CCPA/CPRA also give rights of access, correction, deletion and portability;
the tools in [Your rights](#your-rights) provide all of them to everyone, whatever state you are
in, and we do not discriminate against anyone for exercising them.

Corvale is not a bank, lender, broker, or payment service, and it has no connection to your
financial accounts — see [Corvale never moves money](./terms.md) in the Terms.

## Age requirement

**You must be 18 or older to use the hosted Corvale service.**

India's DPDP Act treats anyone under 18 as a child and requires verifiable parental consent
before their data can be processed. We are not able to verify parental consent reliably, so
rather than do it badly we limit the service to adults. We require you to attest at signup that
you are 18 or older.

If we learn that an account was created by someone under 18, we will take appropriate steps to
stop processing their personal data and delete the account, subject to anything the law requires
us to retain.

This age requirement applies to **the hosted service we operate**. It says nothing about who may
obtain, study, modify or run the AGPL-licensed Corvale software, and it does not modify the rights
that licence grants.

## If something goes wrong

If we become aware of a personal data breach, we will assess it and respond in accordance with
applicable law — including notifying the Data Protection Board of India and affected Data
Principals where required, and, where the GDPR applies, the relevant supervisory authority and
affected individuals within the timeframes it sets.

Where we notify you, we will tell you what happened, what data was involved, what we have done
about it, and what you can do.

## Changes to this policy

If we make a material change, we will update the version at the top of this page and ask you to
review and accept the new version the next time you sign in. Minor corrections that do not change
your rights will not interrupt you.

## Contact

- **Grievance Officer:** Atharv Dewangan
- **Email:** [[PRIVACY_EMAIL]]
- **Address:** [[POSTAL_ADDRESS]]
- **Response window:** 30 days

See also the [Contact page](./contact.md) for support and security routes.
